import { TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { createSimplex3 } from '../random';

/**
 * Sleeve top edge Htop(φ) (sleeve-spec §4.8, GEOMETRY.md §13a), tabulated over the world angle φ about the bore axis:
 *   u = |sin(N·φ'/2)|, φ' = φ + phase jitter       (u = 0 at the peaks, 1 in the valleys)
 *   Htop = max( H − A_local · ((1 − s)·u² + s·u),  min(minTubeCoverage, H) )
 * s = sharpness (u is a cusp at the peaks, u² a soft wave); irregularity jitters each peak's phase and amplitude
 * (seeded, periodic). `slope` is dHtop/dφ, for the distance correction 1 / sqrt(1 + (Htop'/ρ)²).
 */
export interface TopEdge {
  /** Flat top at H (no peaks): the S2a sharp cut. */
  flat: boolean;
  n: number;
  h: Float64Array;
  slope: Float64Array;
  min: number;
  max: number;
  /** Rim blend radius of the smooth intersection (0 = sharp). */
  k: number;
  at(phi: number): number;
  /** dHtop/dφ (nearest table entry). */
  slopeAt(phi: number): number;
}

const TABLE = 2048;
const RIM_BLEND = 1;

export function buildTopEdge(params: VaseParams, H: number): TopEdge {
  const e = params.sleeve.topEdge;
  const n = TABLE;
  const h = new Float64Array(n);
  const slope = new Float64Array(n);
  const flat = e.peakCount === 0 || e.amplitude === 0;
  const floor = Math.min(e.minTubeCoverage, H);
  if (flat) h.fill(H);
  else {
    const N = e.peakCount;
    const s = e.sharpness / 100;
    const irr = e.irregularity / 100;
    const noise = createSimplex3((params.random.seed ^ 0x51ed27) >>> 0);
    const c = Math.max(1, N / 2);
    for (let i = 0; i < n; i++) {
      const phi = (TAU * i) / n;
      const x = Math.cos(phi) * c;
      const y = Math.sin(phi) * c;
      const ph = phi + irr * 0.35 * (Math.PI / N) * noise(x, y, 0.37);
      const amp = e.amplitude * Math.max(0, 1 + 0.5 * irr * noise(x, y, 5.11));
      const u = Math.abs(Math.sin((N * ph) / 2));
      h[i] = Math.max(floor, H - amp * ((1 - s) * u * u + s * u));
    }
  }
  const d = TAU / n;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    slope[i] = (h[(i + 1) % n] - h[(i + n - 1) % n]) / (2 * d);
    if (h[i] < min) min = h[i];
    if (h[i] > max) max = h[i];
  }
  const wrap = (phi: number) => {
    const u = (phi / TAU) * n;
    return u - n * Math.floor(u / n);
  };
  const at = (phi: number) => {
    const u = wrap(phi);
    const i0 = Math.floor(u) % n;
    const f = u - Math.floor(u);
    return h[i0] + (h[(i0 + 1) % n] - h[i0]) * f;
  };
  const slopeAt = (phi: number) => slope[Math.round(wrap(phi)) % n];
  return { flat, n, h, slope, min, max, k: flat ? 0 : RIM_BLEND, at, slopeAt };
}
