import { TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { decodeShapes } from './blob';
import { persianProto } from '../persian';
import { shapeSource, type MotifSource } from './source';

export type { MotifSource } from './source';

/**
 * Motif sources and their periodic (φ, z) distance map (GEOMETRY.md §14).
 *
 * A source answers "signed distance to the motif" in its own units: < 0 inside a filled shape or a strap. The map
 * places it on the body: x = φ·r_ref (arc length at the reference radius, mm) and z, with
 *   repeat   N (integer) copies around, so the map is exactly periodic in φ, × repeatsUp rows inside the band;
 *            each copy scaled to `fill` % of its cell, rotated about the cell centre;
 *   single   one copy centred at (angle, height), its longest side = size mm.
 * Persian patterns (persian/) are sources with a native x period instead (§15). The map stores the distance in mm
 * on a grid of ≈ PITCH, capped at ±cap (only the band near the outline matters), and is sampled bilinearly.
 */
export interface MotifMap {
  nx: number;
  nz: number;
  H: number;
  rRef: number;
  /** Signed distance (mm), row-major [j·nx + i], column i at φ = 2πi/nx, row j at z = H·j/(nz − 1). */
  d: Float32Array;
  /** Interlace level per cell (1 when the source has none). */
  lvl: Float32Array | null;
  holesAreCells: boolean;
  cap: number;
  at(phi: number, z: number): number;
  levelAt(phi: number, z: number): number;
}

/** Map pitch (mm) along the arc and the height; cells per axis are capped. */
const PITCH = 0.4;
const MAX_NX = 2048;
const MAX_NZ = 1200;

/** Cap of the relief map (mm): the motif effect and its printability checks share one cached map. */
export const reliefCap = (softness: number) => Math.max(1.5, softness * 2 + 0.5);

const smooth = (u: number) => {
  const v = u < 0 ? 0 : u > 1 ? 1 : u;
  return v * v * (3 - 2 * v);
};

/** Everything the map depends on (the cache key). */
const mapKey = (p: VaseParams, H: number, rRef: number, cap: number) =>
  JSON.stringify([
    p.motif,
    p.print.lineWidth,
    p.print.outputMode,
    p.sleeve.holes.mode,
    p.sleeve.holes.minBridgeWidth,
    H,
    Math.round(rRef * 100) / 100,
    cap,
    p.motif.source === 'persian' && p.motif.persian.sizing === 'cellSize' ? [p.dimensions, p.profile] : 0,
  ]);
/** A few recent maps: the relief (at maxDiameter / 2) and the sleeve hole map (at the mean skin radius) differ. */
const cache: { key: string; map: MotifMap | null }[] = [];

/**
 * A motif kind before placement: its bounds (and native x period for strips), the stroke half-width it wants in mm,
 * and a builder that takes that half-width in source units (known once the placement fixes the scale).
 */
export interface MotifProto {
  w: number;
  h: number;
  /** Native period along x in source units (Persian strips); 0 / absent = a bounded motif. */
  period?: number;
  halfMm: number;
  /** `win`: the y range (source units) the map needs, for strips generated on demand. */
  make(strokeHalf: number, win: { y0: number; y1: number }): MotifSource;
}
export type ProtoFactory = (p: VaseParams) => MotifProto | null;
const factories: Partial<Record<VaseParams['motif']['source'], ProtoFactory>> = {
  svg: (p) => {
    const set = decodeShapes(p.motif.svg.data);
    if (!set.shapes.length) return null;
    return {
      w: set.w,
      h: set.h,
      halfMm: Math.max(p.print.lineWidth, p.motif.strokeWidth / 2),
      make: (half) => shapeSource(set, half),
    };
  },
  persian: persianProto,
};
/** Register a motif kind (persian/, text) without a circular import. */
export function registerMotifSource(kind: VaseParams['motif']['source'], f: ProtoFactory) {
  factories[kind] = f;
}

/**
 * The motif distance map for the current params on a body of height H at reference radius rRef, or null. Cached
 * (one entry): relief effects and the hole map ask for the same map.
 */
export function buildMotifMap(
  p: VaseParams,
  H: number,
  rRef: number,
  cap = 3,
  radiusAt?: (z: number) => number,
  strapScale = 1,
): MotifMap | null {
  const key = mapKey(p, H, rRef, cap) + strapScale.toFixed(4);
  const hit = cache.find((c) => c.key === key);
  if (hit) return hit.map;
  const map = rasterise(p, H, rRef, cap, radiusAt, strapScale);
  cache.unshift({ key, map });
  if (cache.length > 4) cache.pop();
  return map;
}

function rasterise(
  p: VaseParams,
  H: number,
  rRef: number,
  cap: number,
  radiusAt?: (z: number) => number,
  strapScale = 1,
): MotifMap | null {
  const m = p.motif;
  if (m.source === 'none') return null;
  const proto = factories[m.source]?.(p) ?? null;
  if (!proto || !(proto.w > 0 || proto.h > 0)) return null;
  const circ = TAU * rRef;
  // repeats: a whole number of map columns per copy, so the map is exactly periodic (no seam, no drift)
  const reps = m.placement === 'repeat' || (proto.period ?? 0) > 0 ? m.repeatsAround : 1;
  let nx = Math.min(MAX_NX, Math.max(64, Math.round(circ / PITCH)));
  nx = reps * Math.max(1, Math.round(nx / reps));
  const nz = Math.min(MAX_NZ, Math.max(16, Math.ceil(H / PITCH) + 1));
  const d = new Float32Array(nx * nz).fill(cap);
  const periodic = proto.period ?? 0;
  // scale (mm per source unit) from the placement, then the source with its stroke width in source units
  const N = m.repeatsAround;
  const z0 = (m.bandStart / 100) * H;
  const z1 = Math.max(z0 + 1, (m.bandEnd / 100) * H);
  const M = m.repeatsUp;
  const cwid = circ / N;
  const chgt = (z1 - z0) / M;
  const cellMode = periodic > 0 && p.motif.source === 'persian' && p.motif.persian.sizing === 'cellSize';
  const sc =
    periodic > 0
      ? cellMode
        ? p.motif.persian.cellSize / periodic
        : circ / (N * periodic)
      : m.placement === 'repeat'
        ? (m.fill / 100) * Math.min(cwid / Math.max(proto.w, 1e-9), chgt / Math.max(proto.h, 1e-9)) || 1
        : m.size / Math.max(proto.w, proto.h, 1e-9);
  const src = proto.make((proto.halfMm * strapScale) / sc, { y0: -cap / sc, y1: (H + cap) / sc });
  const lvl = src.level ? new Float32Array(nx * nz).fill(1) : null;
  const rot = (m.rotation * Math.PI) / 180;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const dz = H / (nz - 1);
  const phase = (m.angle / 360) * circ;

  // one evaluation in mm: local (lx, ly) about a copy's centre → source units
  const evalAt = (lx: number, ly: number, lv: { v: number }) => {
    const u = (cr * lx + sr * ly) / sc + src.w / 2;
    const v = (-sr * lx + cr * ly) / sc + src.h / 2;
    const dd = src.dist(u, v, cap / sc);
    if (src.level && dd < 0) lv.v = src.level(u, v);
    return dd * sc;
  };

  if (periodic > 0) {
    // Persian strips: N periods around (x = φ·N·P / 2π), y = z / sc. Constant cell size: N follows the radius,
    // N(z) = 2π r(z) / cell, and between whole counts the two strips are cross-faded over a band (Δν = 0.3)
    const evalRow = (j: number, n: number, wgt: number) => {
      const z = j * dz;
      const yu = z / sc;
      for (let i = 0; i < nx; i++) {
        let f = i / nx - m.angle / 360;
        f -= Math.floor(f);
        const xu = (f * n * periodic) % periodic;
        const dd = src.dist(xu, yu, cap / sc) * sc;
        const c = j * nx + i;
        d[c] = wgt >= 1 ? dd : d[c] * (1 - wgt) + dd * wgt;
        if (lvl && dd < 0 && wgt >= 0.5) lvl[c] = src.level!(xu, yu);
      }
    };
    for (let j = 0; j < nz; j++) {
      if (!cellMode) {
        evalRow(j, N, 1);
        continue;
      }
      const r = radiusAt ? radiusAt(j * dz) : rRef;
      const nu = Math.max(3, (TAU * r) / p.motif.persian.cellSize);
      const lo = Math.floor(nu);
      const fr = nu - lo;
      const w = smooth((fr - 0.35) / 0.3);
      evalRow(j, lo, 1);
      if (w > 0) evalRow(j, lo + 1, w);
    }
  } else if (m.placement === 'repeat') {
    const rows = Math.ceil(M - 1e-9);
    const spill = (sc * Math.hypot(src.w, src.h)) / 2 > Math.min(cwid, chgt) / 2;
    const lv = { v: 1 };
    for (let j = 0; j < nz; j++) {
      const z = j * dz;
      if (z < z0 - cap || z > z1 + cap) continue;
      const rj = Math.floor((z - z0) / chgt);
      for (let i = 0; i < nx; i++) {
        let x = (i / nx) * circ - phase;
        x -= circ * Math.floor(x / circ);
        const ci = Math.floor(x / cwid);
        let best = cap;
        lv.v = 1;
        for (let dj = spill ? -1 : 0; dj <= (spill ? 1 : 0); dj++) {
          const r = rj + dj;
          if (r < 0 || r >= rows) continue;
          const cyz = z0 + (r + 0.5) * chgt;
          if (cyz > z1) continue;
          for (let di = spill ? -1 : 0; di <= (spill ? 1 : 0); di++) {
            const cxx = (ci + di + 0.5) * cwid;
            const dd = evalAt(x - cxx, z - cyz, lv);
            if (dd < best) best = dd;
          }
        }
        d[j * nx + i] = best;
        if (lvl && best < 0) lvl[j * nx + i] = lv.v;
      }
    }
  } else {
    const zc = (m.height / 100) * H;
    const R = (sc * Math.hypot(src.w, src.h)) / 2 + cap;
    const lv = { v: 1 };
    for (let j = 0; j < nz; j++) {
      const z = j * dz;
      if (Math.abs(z - zc) > R) continue;
      for (let i = 0; i < nx; i++) {
        let x = (i / nx) * circ - phase;
        // nearest copy of the centre (x = 0) across the seam
        x -= circ * Math.round(x / circ);
        if (Math.abs(x) > R) continue;
        lv.v = 1;
        const dd = evalAt(x, z - zc, lv);
        d[j * nx + i] = dd;
        if (lvl && dd < 0) lvl[j * nx + i] = lv.v;
      }
    }
  }

  const tScale = nx / TAU;
  const vScale = (nz - 1) / H;
  const sample = (arr: Float32Array, phi: number, z: number) => {
    let u = phi * tScale;
    u -= nx * Math.floor(u / nx);
    let i0 = Math.floor(u);
    const fu = u - i0;
    if (i0 >= nx) i0 -= nx;
    const i1 = i0 + 1 === nx ? 0 : i0 + 1;
    const v = Math.min(nz - 1, Math.max(0, z * vScale));
    const j0 = Math.min(nz - 2, Math.floor(v));
    const fv = v - j0;
    const a = j0 * nx;
    const b = a + nx;
    const r0 = arr[a + i0] + (arr[a + i1] - arr[a + i0]) * fu;
    const r1 = arr[b + i0] + (arr[b + i1] - arr[b + i0]) * fu;
    return r0 + (r1 - r0) * fv;
  };
  return {
    nx,
    nz,
    H,
    rRef,
    d,
    lvl,
    holesAreCells: !!src.holesAreCells,
    cap,
    at: (phi, z) => sample(d, phi, z),
    levelAt: (phi, z) => (lvl ? sample(lvl, phi, z) : 1),
  };
}
