import type { Field } from '../geometry/field';
import { R_MIN } from '../geometry/field';
import { DEG, TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { mulberry32 } from '../random';
import { roundCone } from '../sdf';
import type { TopEdge } from './topEdge';

/**
 * Free-standing fingers and drips (sleeve-spec §4.4 free part, §4.5; GEOMETRY.md §13c). Both are polylines of round
 * cones (exact SDF) about the bore axis, smooth-unioned to the body:
 *   fingers rise from the bed at R + 0.6·ρ0 (so they always touch the core and the bore), follow the skin twist, and
 *   above z_body = lowest tip − freeLength (never below minTubeCoverage) the skin and core are capped, so the finger
 *   tops stand free. Lean (outward) and curl (sideways, growing toward the tip) act on the free part only; every
 *   lateral motion is scaled down together until the path's tilt stays within maxOverhang − 3°.
 *   drips hang on the skin (centreline 0.2·ρ outside it) from the rim, a finger tip (one per finger, the rest from the
 *   rim) or a seeded spot, and end in a
 *   bulb whose underside is a round cone widening upward at ≤ maxOverhang − 8° (no flat downward faces).
 * Thickness never drops below r_min = max(1.25, lineWidth) (radius), i.e. ≥ two print lines and ≥ 2.5 mm.
 * Ribbon fingers (S4, crossSection 'ribbon'): the round cone squashed radially by a = width:thickness (radial offsets
 * from the path are stretched by a, the distance divided by a: a 1-Lipschitz lower bound); a ≤ ρ_tip / r_min keeps the
 * half-thickness ≥ r_min. Their outer face follows the skin (centre at r_skin − ρ/a up to z_body, frozen above), so
 * they read as tongues of the draped shell rather than rods rooted on the core.
 */
export interface Strand {
  kind: 'finger' | 'drip';
  /** Polyline samples (x, y, z) and radii; segment k joins sample k and k + 1. */
  pts: Float64Array;
  rad: Float64Array;
  /** Bounding box of the whole strand (radii included). */
  box: Float64Array;
  /** Steepest axis tilt from vertical (degrees) and the lateral scale applied to reach it (fingers). */
  tilt: number;
  scale: number;
  /** Ribbon width:thickness (1 = round): the cross-section is squashed radially by this factor (S4). */
  ribbon: number;
}

export interface Strands {
  list: Strand[];
  /** Skin and core are capped at this height (H when there are no fingers). */
  zBody: number;
  /** Smooth-union radius with the body. */
  k: number;
  /** Minimum strand radius (mm). */
  rMin: number;
  /** No strand material beyond this radius about the axis. */
  reach: number;
  /**
   * Signed distance to the union of all strands (a lower bound far from them; Infinity when none). With `cap`,
   * strands farther than cap are skipped and the result is min(distance, cap): smin(a, s, k) only needs s below
   * a + k, so passing that cap leaves the composed field unchanged.
   */
  at(x: number, y: number, z: number, cap?: number): number;
  /** Rounded tip zones (drip bottoms, pointed tips): short downward patches that print like tiny bridges. */
  tip(x: number, y: number, z: number): boolean;
}

const SEGS = 28;
const DRIP_SEGS = 16;

/** Distance from p to an axis-aligned box [x0, y0, z0, x1, y1, z1] (0 inside). */
function boxDist(b: Float64Array, o: number, x: number, y: number, z: number): number {
  const dx = Math.max(b[o] - x, 0, x - b[o + 3]);
  const dy = Math.max(b[o + 1] - y, 0, y - b[o + 4]);
  const dz = Math.max(b[o + 2] - z, 0, z - b[o + 5]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function finish(kind: Strand['kind'], P: number[], Rr: number[], tilt: number, scale: number, ribbon = 1): Strand {
  const pts = Float64Array.from(P);
  const rad = Float64Array.from(Rr);
  const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
  for (let k = 0; k < rad.length; k++)
    for (let a = 0; a < 3; a++) {
      box[a] = Math.min(box[a], pts[k * 3 + a] - rad[k]);
      box[a + 3] = Math.max(box[a + 3], pts[k * 3 + a] + rad[k]);
    }
  return { kind, pts, rad, box, tilt, scale, ribbon };
}

/** Steepest segment tilt from vertical (degrees) of a polyline, from segment `from` on. */
function maxTilt(P: number[], from = 0): number {
  let m = 0;
  for (let k = from; k + 1 < P.length / 3; k++) {
    const dx = P[k * 3 + 3] - P[k * 3];
    const dy = P[k * 3 + 4] - P[k * 3 + 1];
    const dz = Math.abs(P[k * 3 + 5] - P[k * 3 + 2]);
    m = Math.max(m, Math.atan2(Math.hypot(dx, dy), dz) / DEG);
  }
  return m;
}

/** Skin radius about the slice centre at world angle φ and height z (voxel-independent, straight from the field). */
function skinAt(field: Field, phi: number, z: number) {
  const row = field.row(Math.min(field.H, Math.max(0, z)));
  let tw = phi - row.twist;
  tw -= TAU * Math.floor(tw / TAU);
  return { r: Math.max(R_MIN, field.outerRaw(tw, Math.cos(tw), Math.sin(tw), row)), cx: row.cx, cy: row.cy };
}

export interface StrandInputs {
  field: Field;
  H: number;
  /** Bore radius and core-tube radius. */
  R: number;
  Rc: number;
  top: TopEdge;
}

export function buildStrands(params: VaseParams, inp: StrandInputs): Strands {
  const { field, H, R, Rc, top } = inp;
  const fp = params.sleeve.fingers;
  const dp = params.sleeve.drips;
  const rMin = Math.max(1.25, params.print.lineWidth);
  const tiltMax = params.print.maxOverhang - 3;
  const list: Strand[] = [];
  const tips: number[] = [];

  // ---- fingers
  const N = fp.count;
  const rng = mulberry32((params.random.seed ^ 0x2545f491) >>> 0);
  const lo = Math.min(fp.heightMin, fp.heightMax) / 100;
  const hi = Math.max(fp.heightMin, fp.heightMax) / 100;
  const vari = fp.widthVariation / 100;
  const fingers: { tipZ: number; rho0: number; phi0: number; w: number }[] = [];
  for (let i = 0; i < N; i++) {
    const u = rng();
    const wv = rng();
    const pv = rng();
    fingers.push({
      tipZ: H * (lo + (hi - lo) * (N === 1 ? 1 : u)),
      rho0: Math.max(rMin, (fp.width / 2) * (1 + vari * (wv - 0.5))),
      phi0: (TAU * i) / Math.max(1, N) + vari * (pv - 0.5) * 0.3 * (TAU / Math.max(1, N)),
      w: fp.width,
    });
  }
  const minTip = fingers.length ? Math.min(...fingers.map((f) => f.tipZ)) : H;
  const floor = Math.min(params.sleeve.topEdge.minTubeCoverage, H);
  const zBody = N > 0 ? Math.min(H, Math.max(floor, minTip - fp.freeLength)) : H;
  const tanLean = Math.tan(fp.lean * DEG);
  const tanCurl = Math.tan(fp.curl * DEG);
  const extra = fp.twist * DEG;
  const taper = fp.taper / 100;
  const ribbonOn = fp.crossSection === 'ribbon';
  const fingerPaths: { P: number[]; Rr: number[]; a: number }[] = [];
  for (const f of fingers) {
    // tip extent above the last path sample, so the finished tip ends at tipZ (below the top cut at H)
    const rhoEnd = Math.max(rMin, f.rho0 * (1 - taper));
    const a = ribbonOn ? Math.max(1, Math.min(fp.ribbonRatio, rhoEnd / rMin)) : 1;
    const ext = fp.tipShape === 'pointed' ? 3 * rhoEnd : fp.tipShape === 'dripBulb' ? 4 * rhoEnd : rhoEnd;
    const zEnd = Math.max(zBody * 0.5, f.tipZ - ext);
    const rc = R + (0.6 * f.rho0) / a;
    const path = (s: number) => {
      const P: number[] = [];
      const Rr: number[] = [];
      const Lf = Math.max(1e-6, zEnd - zBody);
      for (let k = 0; k <= SEGS; k++) {
        const z = (zEnd * k) / SEGS;
        const free = Math.max(0, z - zBody);
        const phi = f.phi0 + s * (field.row(z).twist + extra * (z / zEnd));
        const rad = Math.max(rMin, f.rho0 * (1 - taper * (z / zEnd)));
        // ribbons hug the skin (outer face on it, never inside the core), round fingers root on the core
        const base = ribbonOn
          ? Math.max(rc, skinAt(field, f.phi0 + field.row(Math.min(z, zBody)).twist, Math.min(z, zBody)).r - rad / a)
          : rc;
        const r = base + s * free * tanLean;
        const side = (s * tanCurl * free * free) / (2 * Lf);
        P.push(r * Math.cos(phi) - side * Math.sin(phi), r * Math.sin(phi) + side * Math.cos(phi), z);
        Rr.push(rad);
      }
      return { P, Rr };
    };
    // a ribbon follows the skin (and merges with it) below z_body, so only its free part is tilt-limited
    const from = ribbonOn ? Math.min(SEGS - 1, Math.floor((zBody / Math.max(zEnd, 1e-6)) * SEGS)) : 0;
    let s = 1;
    let pr = path(1);
    if (maxTilt(pr.P, from) > tiltMax) {
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 14; it++) {
        const m = (lo + hi) / 2;
        if (maxTilt(path(m).P, from) > tiltMax) hi = m;
        else lo = m;
      }
      s = lo;
      pr = path(s);
    }
    const { P, Rr } = pr;
    const n = Rr.length - 1;
    const ax = P[n * 3] - P[n * 3 - 3];
    const ay = P[n * 3 + 1] - P[n * 3 - 2];
    const az = P[n * 3 + 2] - P[n * 3 - 1];
    const al = Math.hypot(ax, ay, az) || 1;
    const tTip = Math.atan2(Math.hypot(ax, ay), az) / DEG;
    const re = Rr[n];
    const along = (len: number, r: number) => {
      P.push(P[n * 3] + (ax / al) * len, P[n * 3 + 1] + (ay / al) * len, P[n * 3 + 2] + (az / al) * len);
      Rr.push(r);
    };
    if (fp.tipShape === 'pointed' && re > rMin * 1.05) {
      along(2 * re, rMin);
      tips.push(P[P.length - 3], P[P.length - 2], P[P.length - 1], rMin + 1.5);
    } else if (fp.tipShape === 'dripBulb') {
      // bulb widening upward along the path: side angle β ≤ tiltMax − tilt − 2° (≥ 8°), length ≤ 3·ρ_b
      const beta = Math.max(8, tiltMax - tTip - 2) * DEG;
      let rb = Math.max(1.6 * re, re + 2);
      let len = (rb - re) / Math.sin(beta);
      if (len > 3 * re) {
        len = 3 * re;
        rb = re + len * Math.sin(beta);
      }
      along(len, rb);
    }
    fingerPaths.push({ P, Rr, a });
    list.push(finish('finger', P, Rr, maxTilt(P, from), s, a));
  }

  // ---- drips: a strand on the skin with a self-supporting bulb at its bottom end
  const rng2 = mulberry32((params.random.seed ^ 0x7f4a7c15) >>> 0);
  const D = dp.count;
  const rb = Math.max(1.2 * rMin, dp.bulbSize / 2);
  const rs = Math.max(rMin, 0.45 * rb);
  const rt = rMin;
  const beta = Math.max(10, params.print.maxOverhang - 8) * DEG;
  const bulbLen = (rb - rt) / Math.sin(beta);
  const zLo = rt + 1;
  for (let d = 0; d < D; d++) {
    const u1 = rng2();
    const u2 = rng2();
    let phi = (TAU * (d + 0.5 + 0.6 * (u1 - 0.5))) / D;
    let zTop: number;
    let finger: { P: number[]; Rr: number[]; a: number } | null = null;
    // on fingers: one drip per finger tip, the rest hang from the rim
    if (dp.placement === 'fingers' && d < fingerPaths.length) {
      finger = fingerPaths[d];
      const n = finger.Rr.length - 1;
      zTop = finger.P[n * 3 + 2] - finger.Rr[n];
      phi = Math.atan2(finger.P[n * 3 + 1], finger.P[n * 3]);
    } else if (dp.placement === 'random') {
      const ceil = Math.min(top.at(phi), zBody) - rs - 2;
      zTop = zLo + bulbLen + (ceil - zLo - bulbLen) * (0.35 + 0.65 * u2);
    } else zTop = Math.min(top.at(phi), zBody) - 0.5 * rs;
    const zBot = Math.max(zLo, zTop - dp.length);
    if (zTop - zBot < 2 * rt) continue;
    // centreline: on the finger's outer side, or 0.2·ρ outside the skin (never inside the core tube)
    const centre = (z: number, rad: number): [number, number] => {
      if (finger) {
        const k = Math.min(
          finger.Rr.length - 1,
          Math.max(0, Math.round((z / (finger.P[finger.P.length - 1] || 1)) * SEGS)),
        );
        const fx = finger.P[k * 3];
        const fy = finger.P[k * 3 + 1];
        const fr = Math.hypot(fx, fy) || 1;
        const off = finger.Rr[k] / finger.a + 0.2 * rad;
        return [fx + (fx / fr) * off, fy + (fy / fr) * off];
      }
      const sk = skinAt(field, phi, z);
      const r = Math.max(sk.r, Rc) + 0.2 * rad;
      return [sk.cx + r * Math.cos(phi), sk.cy + r * Math.sin(phi)];
    };
    // a short drip gets a smaller bulb, never a steeper one
    const lb = Math.min(bulbLen, zTop - zBot);
    const rbd = rt + lb * Math.sin(beta);
    const rsd = Math.min(rs, rbd);
    const P: number[] = [];
    const Rr: number[] = [];
    // bottom tip, then the bulb top, then the strand up to zTop
    const [tx, ty] = centre(zBot, rt);
    P.push(tx, ty, zBot);
    Rr.push(rt);
    const zb = zBot + lb;
    const [bx, by] = centre(zb, rbd);
    P.push(bx, by, zb);
    Rr.push(rbd);
    for (let k = 1; k <= DRIP_SEGS; k++) {
      const z = zb + ((zTop - zb) * k) / DRIP_SEGS;
      if (z - P[P.length - 1] < 1e-3) continue;
      const [x, y] = centre(z, rsd);
      P.push(x, y, z);
      Rr.push(rsd);
    }
    tips.push(tx, ty, zBot, rt + 1.5);
    list.push(finish('drip', P, Rr, maxTilt(P), 1));
  }

  let reach = 0;
  for (const s of list)
    for (const [x, y] of [
      [s.box[0], s.box[1]],
      [s.box[3], s.box[4]],
      [s.box[0], s.box[4]],
      [s.box[3], s.box[1]],
    ])
      reach = Math.max(reach, Math.hypot(x, y));

  // flat segment table for the evaluator: per segment a, b, r1, r2 and its box
  const segs: number[] = [];
  const sbox: number[] = [];
  const first: number[] = [];
  for (const s of list) {
    first.push(segs.length / 8);
    const n = s.rad.length;
    for (let k = 0; k + 1 < n; k++) {
      const a = k * 3;
      const b = a + 3;
      const r1 = s.rad[k];
      const r2 = s.rad[k + 1];
      const L = Math.hypot(s.pts[b] - s.pts[a], s.pts[b + 1] - s.pts[a + 1], s.pts[b + 2] - s.pts[a + 2]);
      // a round cone needs |r1 − r2| < L; a shorter segment is the bigger sphere alone
      const big = Math.abs(r1 - r2) >= L * 0.999;
      segs.push(s.pts[a], s.pts[a + 1], s.pts[a + 2], s.pts[b], s.pts[b + 1], s.pts[b + 2], r1, big ? -r2 : r2);
      for (let c = 0; c < 3; c++) sbox.push(Math.min(s.pts[a + c] - r1, s.pts[b + c] - r2));
      for (let c = 0; c < 3; c++) sbox.push(Math.max(s.pts[a + c] + r1, s.pts[b + c] + r2));
    }
  }
  first.push(segs.length / 8);
  const S = Float64Array.from(segs);
  const SB = Float64Array.from(sbox);
  const boxes = new Float64Array(list.length * 6);
  list.forEach((s, i) => boxes.set(s.box, i * 6));
  // ribbons: path radius about the axis per sample (samples rise in z), for the radial squash
  const ribbonR = list.map((st) => {
    if (st.ribbon <= 1) return null;
    const n = st.rad.length;
    const zs = new Float64Array(n);
    const rs = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      zs[k] = st.pts[k * 3 + 2];
      rs[k] = Math.hypot(st.pts[k * 3], st.pts[k * 3 + 1]);
    }
    return { zs, rs };
  });
  const pathRadius = (zs: Float64Array, rs: Float64Array, z: number) => {
    if (z <= zs[0]) return rs[0];
    const n = zs.length;
    if (z >= zs[n - 1]) return rs[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (zs[m] <= z) lo = m;
      else hi = m;
    }
    const t = (z - zs[lo]) / Math.max(1e-9, zs[hi] - zs[lo]);
    return rs[lo] + (rs[hi] - rs[lo]) * t;
  };

  // per strand, over its segments: lowUp[g] = min box z0 of segments ≥ g, highDown[g] = max box z1 of segments ≤ g
  const nSeg = SB.length / 6;
  const lowUp = new Float64Array(nSeg);
  const highDown = new Float64Array(nSeg);
  for (let i = 0; i < list.length; i++) {
    let m = Infinity;
    for (let g = first[i + 1] - 1; g >= first[i]; g--) lowUp[g] = m = Math.min(m, SB[g * 6 + 2]);
    m = -Infinity;
    for (let g = first[i]; g < first[i + 1]; g++) highDown[g] = m = Math.max(m, SB[g * 6 + 5]);
  }
  const order = new Int32Array(list.length);
  const orderD = new Float64Array(list.length);
  /** Exact distance of one segment (squashed coordinates for ribbons; the caller divides by a). */
  const segDist = (g: number, x: number, y: number, z: number) => {
    const o = g * 8;
    if (S[o + 7] < 0) {
      // degenerate cone: the bigger end sphere
      const r1 = S[o + 6];
      const r2 = -S[o + 7];
      const e = r1 >= r2 ? 0 : 3;
      return Math.hypot(x - S[o + e], y - S[o + e + 1], z - S[o + e + 2]) - Math.max(r1, r2);
    }
    return roundCone(x, y, z, S[o], S[o + 1], S[o + 2], S[o + 3], S[o + 4], S[o + 5], S[o + 6], S[o + 7]);
  };
  const at = (x0: number, y0: number, z: number, cap = Infinity) => {
    let best = cap;
    // strands whose box is within reach, nearest box first (insertion sort of ≤ 24): the nearest strand sets
    // `best` and the boxes of the others usually skip them
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      // the box of the round strand bounds its ribbon too (a ribbon only loses material radially)
      const d = boxDist(boxes, i * 6, x0, y0, z);
      if (d >= best) continue;
      let k = n++;
      while (k > 0 && orderD[k - 1] > d) {
        orderD[k] = orderD[k - 1];
        order[k] = order[k - 1];
        k--;
      }
      orderD[k] = d;
      order[k] = i;
    }
    for (let q = 0; q < n; q++) {
      if (orderD[q] >= best) break;
      const i = order[q];
      let x = x0;
      let y = y0;
      const rb = ribbonR[i];
      const a = list[i].ribbon;
      if (rb) {
        // squash: stretch the radial offset from the path by a, measure, divide by a (1-Lipschitz lower bound)
        const rho = Math.hypot(x0, y0);
        const rp = pathRadius(rb.zs, rb.rs, z);
        const r2 = Math.max(0, rp + (rho - rp) * a);
        const f = rho > 1e-9 ? r2 / rho : 0;
        x = x0 * f;
        y = y0 * f;
      }
      // segments rise in z: start at the first segment whose box reaches z, walk up and down, and stop each way
      // once the boxes beyond are farther in z alone than `best` (lowUp / highDown are monotone bounds)
      const f0 = first[i];
      const f1 = first[i + 1];
      let lo = f0;
      let hi = f1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (highDown[m] < z) lo = m + 1;
        else hi = m;
      }
      const g0 = Math.min(lo, f1 - 1);
      for (let g = g0; g < f1; g++) {
        if ((lowUp[g] - z) / a >= best) break;
        if (boxDist(SB, g * 6, x, y, z) / a >= best) continue;
        const d = segDist(g, x, y, z) / a;
        if (d < best) best = d;
      }
      for (let g = g0 - 1; g >= f0; g--) {
        if ((z - highDown[g]) / a >= best) break;
        if (boxDist(SB, g * 6, x, y, z) / a >= best) continue;
        const d = segDist(g, x, y, z) / a;
        if (d < best) best = d;
      }
    }
    return best;
  };
  const T = Float64Array.from(tips);
  const tip = (x: number, y: number, z: number) => {
    for (let k = 0; k < T.length; k += 4)
      if ((x - T[k]) ** 2 + (y - T[k + 1]) ** 2 + (z - T[k + 2]) ** 2 < T[k + 3] ** 2) return true;
    return false;
  };
  return { list, zBody, k: fp.blend, rMin, reach, at, tip };
}
