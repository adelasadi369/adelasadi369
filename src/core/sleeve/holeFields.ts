import { compileField, R_MIN } from '../geometry/field';
import { buildMotifMap } from '../motif/map';
import { DEG, TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { createSimplex3, mulberry32 } from '../random';

/**
 * Hole fields for every hole mode (sleeve-spec §4.7, GEOMETRY.md §13b). Each fills `field` on the allowed cells of the
 * (φ, z) hole map; lower = more open. The coverage search thresholds it at a quantile, so only the ordering matters,
 * and the rest of the pipeline (teardrop, islands, bridges, merge guard, finisher, fine coverage) is shared.
 * Surface coordinates: arc u = (φ − z·shear)·r_ref (periodic, sheared by the hole angle) and v = z / verticalStretch.
 *   organicNoise  one-octave simplex (+ a low-frequency size-variation term)
 *   ellipses      seeded Poisson-disk centres (spacing 1.6 × size in (u, v)); field = min_i |p − c_i| / a_i
 *   voronoi       seeded Poisson-disk sites (spacing = size); field = −(F2 − F1): cell centres open first, so the
 *                 holes are shrunken cells and the bridges follow the cell edges
 *   foldGaps      the skin's valleys: (r − row mean) / row spread from the field (about the slice centre) plus a
 *                 0.6 × noise term that breaks each valley into separate slits
 */
export interface HoleFieldGrid {
  nx: number;
  nz: number;
  dphi: number;
  dz: number;
  rRef: number;
  /** Bore radius: bridges are measured there. */
  R?: number;
  allowed: Uint8Array;
}

/** Hole size → noise wavelength at ≈ 15 % coverage. */
export const SIZE_K = 2.0;

export function holeField(params: VaseParams, g: HoleFieldGrid): Float64Array {
  const hp = params.sleeve.holes;
  const { nx, nz, dphi, dz, rRef, allowed } = g;
  const field = new Float64Array(nx * nz);
  const noise = createSimplex3((params.random.seed ^ 0x6a09e667) >>> 0);
  const f = 1 / (hp.size * SIZE_K);
  const shear = Math.tan(hp.angle * DEG) / rRef;
  const vari = hp.sizeVariation / 100;
  const st = hp.verticalStretch;
  const period = TAU * rRef;

  if (hp.mode === 'pattern') {
    // the Motif block (motif/map.ts) at this map's radius: SVG / text shapes open inside, Persian cells open
    // outside the straps; open where the field is < 0 (holes.ts uses a fixed threshold for this mode)
    const H = (nz - 1) * dz;
    const prof = compileField(params).profile;
    // straps are bridges, measured at the bore radius: widen them by r_ref / R so they hold minBridgeWidth there
    const map = buildMotifMap(
      params,
      H,
      rRef,
      3,
      (z) => prof.R(Math.min(1, Math.max(0, z / H))),
      Math.max(1, rRef / (g.R ?? rRef)),
    );
    if (!map) return field.fill(1);
    const sgn = map.holesAreCells ? -1 : 1;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (allowed[c]) field[c] = sgn * map.at(i * dphi, j * dz);
      }
    return field;
  }

  if (hp.mode === 'organicNoise' || hp.mode === 'foldGaps') {
    const fold = hp.mode === 'foldGaps' ? foldMap(params, g) : null;
    for (let j = 0; j < nz; j++) {
      const z = j * dz;
      const zs = (z / st) * f;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (!allowed[c]) continue;
        const p = i * dphi - z * shear;
        const x = rRef * Math.cos(p) * f;
        const y = rRef * Math.sin(p) * f;
        // one octave: a second one frays the hole outlines (S3: rounded ovals like the references)
        const n0 = noise(x, y, zs);
        field[c] = fold
          ? fold(i, j) + 0.6 * n0
          : n0 + 0.8 * vari * noise(0.35 * x + 17.3, 0.35 * y - 4.1, 0.35 * zs + 9.7);
      }
    }
    return field;
  }

  // ---- Poisson-disk sites in (u, v), periodic in u
  let vLo = Infinity;
  let vHi = -Infinity;
  for (let c = 0; c < nx * nz; c++)
    if (allowed[c]) {
      const v = (Math.floor(c / nx) * dz) / st;
      if (v < vLo) vLo = v;
      if (v > vHi) vHi = v;
    }
  if (vLo > vHi) return field;
  const ellipses = hp.mode === 'ellipses';
  const spacing = ellipses ? 1.6 * hp.size : hp.size;
  const pad = spacing;
  const sites = poisson(period, vLo - pad, vHi + pad, spacing, (params.random.seed ^ 0x3c6ef372) >>> 0);
  const rng = mulberry32((params.random.seed ^ 0x1f83d9ab) >>> 0);
  const scale = sites.map(() => (hp.size / 2) * (1 + vari * (rng() - 0.5)));
  // bucket grid of side `spacing` (periodic in u)
  const bu = Math.max(1, Math.floor(period / spacing));
  const cw = period / bu;
  const v0 = vLo - pad;
  const bv = Math.max(1, Math.ceil((vHi + pad - v0) / spacing));
  const buckets: number[][] = Array.from({ length: bu * bv }, () => []);
  sites.forEach(([u, v], k) => {
    const a = Math.min(bu - 1, Math.floor(u / cw));
    const b = Math.min(bv - 1, Math.max(0, Math.floor((v - v0) / spacing)));
    buckets[b * bu + a].push(k);
  });
  const reach = 2;
  for (let j = 0; j < nz; j++) {
    const z = j * dz;
    const v = z / st;
    const b0 = Math.floor((v - v0) / spacing);
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (!allowed[c]) continue;
      let u = (i * dphi - z * shear) * rRef;
      u -= period * Math.floor(u / period);
      const a0 = Math.floor(u / cw);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let db = -reach; db <= reach; db++) {
        const b = b0 + db;
        if (b < 0 || b >= bv) continue;
        for (let da = -reach; da <= reach; da++) {
          const a = (((a0 + da) % bu) + bu) % bu;
          for (const k of buckets[b * bu + a]) {
            let du = Math.abs(u - sites[k][0]);
            if (du > period / 2) du = period - du;
            const d = Math.hypot(du, v - sites[k][1]) / (ellipses ? scale[k] : 1);
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) f2 = d;
          }
        }
      }
      field[c] = ellipses ? Math.min(f1, 4) : -(Math.min(f2, 4 * spacing) - f1);
    }
  }
  return field;
}

/** Seeded dart throwing with minimum spacing d over [0, P) × [v0, v1], periodic in the first coordinate. */
function poisson(P: number, v0: number, v1: number, d: number, seed: number): [number, number][] {
  const rng = mulberry32(seed);
  const cell = d / Math.SQRT2;
  const gu = Math.max(1, Math.floor(P / cell));
  const cu = P / gu;
  const gv = Math.max(1, Math.ceil((v1 - v0) / cell));
  const grid = new Int32Array(gu * gv).fill(-1);
  const out: [number, number][] = [];
  const target = Math.ceil((P * (v1 - v0)) / (d * d));
  const tries = 60 * target + 100;
  const r = Math.ceil(d / Math.min(cu, cell));
  for (let t = 0; t < tries; t++) {
    const u = rng() * P;
    const v = v0 + rng() * (v1 - v0);
    const a = Math.min(gu - 1, Math.floor(u / cu));
    const b = Math.min(gv - 1, Math.floor((v - v0) / cell));
    let ok = true;
    for (let db = -r; db <= r && ok; db++) {
      const bb = b + db;
      if (bb < 0 || bb >= gv) continue;
      for (let da = -r; da <= r && ok; da++) {
        const k = grid[bb * gu + ((((a + da) % gu) + gu) % gu)];
        if (k < 0) continue;
        let du = Math.abs(u - out[k][0]);
        if (du > P / 2) du = P - du;
        if (du * du + (v - out[k][1]) ** 2 < d * d) ok = false;
      }
    }
    if (!ok || grid[b * gu + a] >= 0) continue;
    grid[b * gu + a] = out.length;
    out.push([u, v]);
  }
  return out;
}

/** Normalised skin depth on a coarse (256 × ≤ 160) grid, bilinear on the hole map: < 0 in the valleys. */
function foldMap(params: VaseParams, g: HoleFieldGrid): (i: number, j: number) => number {
  const field = compileField(params);
  const H = field.H;
  const mx = 256;
  const mz = Math.min(g.nz, 160);
  const m = new Float64Array(mx * mz);
  for (let b = 0; b < mz; b++) {
    const row = field.row((H * b) / (mz - 1));
    let sum = 0;
    let sq = 0;
    for (let a = 0; a < mx; a++) {
      let tw = (TAU * a) / mx - row.twist;
      tw -= TAU * Math.floor(tw / TAU);
      const r = Math.max(R_MIN, field.outerRaw(tw, Math.cos(tw), Math.sin(tw), row));
      m[b * mx + a] = r;
      sum += r;
      sq += r * r;
    }
    const mean = sum / mx;
    const sd = Math.max(0.25, Math.sqrt(Math.max(0, sq / mx - mean * mean)));
    for (let a = 0; a < mx; a++) m[b * mx + a] = (m[b * mx + a] - mean) / sd;
  }
  return (i, j) => {
    let u = ((i * g.dphi) / TAU) * mx;
    u -= mx * Math.floor(u / mx);
    const a0 = Math.floor(u) % mx;
    const a1 = (a0 + 1) % mx;
    const fu = u - Math.floor(u);
    const v = Math.min(mz - 1, ((j * g.dz) / H) * (mz - 1));
    const b0 = Math.min(mz - 2, Math.floor(v));
    const fv = v - b0;
    const r0 = m[b0 * mx + a0] + (m[b0 * mx + a1] - m[b0 * mx + a0]) * fu;
    const r1 = m[(b0 + 1) * mx + a0] + (m[(b0 + 1) * mx + a1] - m[(b0 + 1) * mx + a0]) * fu;
    return r0 + (r1 - r0) * fv;
  };
}
