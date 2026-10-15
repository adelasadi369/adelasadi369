import { lerp } from '../math';
import type { ProfilePreset, VaseParams } from '../params/schema';
import { monotoneSpline, type Knot, type Spline } from './spline';

type Sigma = 1 | -1 | 0;
interface Primary {
  knots: [number, number][];
  sigma: Sigma[];
  fullness?: number;
}

/** Primary knots (t, r mm) and per-segment bulge sign for each named preset. See docs/GEOMETRY.md §1. */
function primaries(preset: Exclude<ProfilePreset, 'custom'>, d: VaseParams['dimensions']): Primary {
  const rb = d.baseDiameter / 2;
  const rm = d.maxDiameter / 2;
  const rn = d.neckDiameter / 2;
  const rt = d.topDiameter / 2;
  const tb = d.bellyPosition / 100;
  const tn = d.neckPosition / 100;
  switch (preset) {
    case 'straight':
      return { knots: [[0, rb], [1, rb]], sigma: [0] };
    case 'taper':
      return { knots: [[0, rb], [1, rt]], sigma: [0] };
    case 'convex':
      return { knots: [[0, rb], [tb, rm], [1, rt]], sigma: [1, 1] };
    case 'concave':
      return { knots: [[0, rb], [tb, rn], [1, rt]], sigma: [-1, -1] };
    case 'teardrop':
      return { knots: [[0, rb], [Math.min(tb, 0.4), rm], [1, rt]], sigma: [1, -1] };
    case 'sphere':
      return { knots: [[0, rb], [0.5, rm], [1, rt]], sigma: [1, 1], fullness: 1 };
    case 'jar':
      return { knots: [[0, rb], [tb, rm], [tn, rn], [1, rt]], sigma: [1, 1, 0] };
    case 'tulip':
      return { knots: [[0, rb], [tb, rm], [tn, lerp(rm, rn, 0.5)], [1, rt]], sigma: [1, -1, 1] };
    case 'hourglass':
      return { knots: [[0, rb], [0.5, rn], [1, rt]], sigma: [1, 1] };
    case 'sCurve':
      return { knots: [[0, rb], [tb, rm], [tn, rn], [1, rt]], sigma: [1, -1, -1] };
    case 'amphora':
      return { knots: [[0, rb], [tb, rm], [tn, rn], [0.93, rn], [1, rt]], sigma: [1, 1, 0, 1] };
    case 'urn':
      return { knots: [[0, rb], [0.12, lerp(rn, rb, 0.4)], [tb, rm], [tn, rn], [1, rt]], sigma: [-1, 1, 1, 1] };
    case 'bottle':
      return { knots: [[0, rb], [0.06, rm], [tb, rm], [tn, rn], [1, rt]], sigma: [1, 0, 1, 0] };
    case 'doubleBulge':
      return {
        knots: [[0, rb], [0.6 * tb, rm], [(tb + tn) / 2, rn], [tn, 0.85 * rm], [1, rt]],
        sigma: [1, -1, -1, 1],
      };
    case 'flaredTrumpet':
      return { knots: [[0, rb], [tb, rn], [1, rt]], sigma: [-1, -1] };
    case 'goblet':
      return { knots: [[0, rb], [0.1, rn * 0.5], [0.3, rn * 0.5], [tb, rm], [1, rt]], sigma: [-1, 0, 1, 1] };
    case 'onionDome':
      return { knots: [[0, rb], [tb, rm], [tn, rn], [1, rt]], sigma: [1, 1, -1] };
  }
}

const MIN_GAP = 0.02;

/** Knots for the profile, including fullness shoulders. Custom presets return the user knots. */
export function profileKnots(params: Pick<VaseParams, 'dimensions' | 'profile'>): Knot[] {
  const { profile, dimensions } = params;
  if (profile.preset === 'custom') {
    const rm = dimensions.maxDiameter / 2;
    return profile.controlPoints.map((p) => ({ t: p.t / 100, r: p.r * rm, sharp: p.sharp }));
  }
  const prim = primaries(profile.preset, dimensions);
  // Enforce strictly increasing t (keep endpoints).
  const ks: [number, number][] = [];
  const sig: Sigma[] = [];
  prim.knots.forEach(([t, r], i) => {
    const last = i === prim.knots.length - 1;
    if (ks.length && t - ks[ks.length - 1][0] < MIN_GAP) {
      if (!last) return;
      if (ks.length > 1) {
        ks.pop();
        sig.pop();
      }
    }
    if (i > 0) sig.push(prim.sigma[i - 1] ?? 0);
    ks.push([t, r]);
  });

  const phi = prim.fullness ?? profile.strength / 100;
  const out: Knot[] = [];
  for (let k = 0; k < ks.length; k++) {
    out.push({ t: ks[k][0], r: ks[k][1] });
    if (k === ks.length - 1) break;
    const [tA, rA] = ks[k];
    const [tB, rB] = ks[k + 1];
    const s = sig[k];
    if (s === 0 || rA === rB) continue;
    const w = 0.5 + 0.4 * phi;
    // σ=+1 → shoulder pushed toward the larger radius, σ=−1 toward the smaller.
    const towardLarger = s === 1;
    const big = Math.max(rA, rB);
    const small = Math.min(rA, rB);
    const r = towardLarger ? lerp(small, big, w) : lerp(big, small, w);
    out.push({ t: (tA + tB) / 2, r });
  }
  return out;
}

export interface Profile {
  /** Radius in mm at t ∈ [0,1], before rim/base modifiers. */
  R: (t: number) => number;
  spline: Spline;
}

export function buildProfile(params: Pick<VaseParams, 'dimensions' | 'profile'>, rMin: number): Profile {
  const spline = monotoneSpline(profileKnots(params));
  const { waveCycles, waveAmplitude } = params.profile;
  const wave = waveCycles > 0 && waveAmplitude > 0;
  const R = (t: number) => {
    let r = spline(t);
    if (wave) r += waveAmplitude * Math.sin(2 * Math.PI * waveCycles * t);
    return r < rMin ? rMin : r;
  };
  return { R, spline };
}
