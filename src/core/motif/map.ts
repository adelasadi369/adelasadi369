import { TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { decodeShapes, type ShapeSet } from './blob';

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
export interface MotifSource {
  /** Signed distance in source units (< 0 inside), clamped to ±cap. */
  dist(x: number, y: number, cap: number): number;
  /** Bounds of one copy in source units. */
  w: number;
  h: number;
  /** Interlace level at a point (1 = strand on top, < 1 = passing under); absent = 1. */
  level?(x: number, y: number): number;
  /** Cells (outside the straps) open as holes instead of the motif itself (Persian patterns). */
  holesAreCells?: boolean;
}

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

/** Polylines of a decoded blob as a source: closed pieces are filled (even-odd), open pieces are stroked. */
export function shapeSource(set: ShapeSet, strokeHalf: number): MotifSource {
  // flat segment list: x0 y0 x1 y1, fill flag
  const seg: number[] = [];
  const fill: number[] = [];
  for (const s of set.shapes) {
    const n = s.pts.length / 2;
    const m = s.closed ? n : n - 1;
    for (let k = 0; k < m; k++) {
      const a = k;
      const b = (k + 1) % n;
      seg.push(s.pts[2 * a], s.pts[2 * a + 1], s.pts[2 * b], s.pts[2 * b + 1]);
      fill.push(s.closed ? 1 : 0);
    }
  }
  return segmentSource(Float64Array.from(seg), Uint8Array.from(fill), strokeHalf, set.w, set.h);
}

/**
 * Generic segment source with a uniform bin grid: fill segments (closed outlines, even-odd inside by a +x ray) and
 * stroke segments (distance − half width). Shared by SVG shapes, text outlines and Persian strap networks.
 */
export function segmentSource(
  S: Float64Array,
  isFill: Uint8Array,
  strokeHalf: number | Float64Array,
  w: number,
  h: number,
  extra?: Pick<MotifSource, 'level' | 'holesAreCells'>,
): MotifSource {
  const n = isFill.length;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; // prettier-ignore
  for (let k = 0; k < n; k++) {
    x0 = Math.min(x0, S[4 * k], S[4 * k + 2]);
    x1 = Math.max(x1, S[4 * k], S[4 * k + 2]);
    y0 = Math.min(y0, S[4 * k + 1], S[4 * k + 3]);
    y1 = Math.max(y1, S[4 * k + 1], S[4 * k + 3]);
  }
  const halfOf = (k: number) => (typeof strokeHalf === 'number' ? strokeHalf : strokeHalf[k]);
  let maxHalf = 0;
  for (let k = 0; k < n; k++) if (!isFill[k]) maxHalf = Math.max(maxHalf, halfOf(k));
  x0 -= maxHalf;
  y0 -= maxHalf;
  x1 += maxHalf;
  y1 += maxHalf;
  const G = Math.max(4, Math.min(128, Math.ceil(Math.sqrt(n) * 1.5)));
  const cw = Math.max(1e-9, (x1 - x0) / G);
  const ch = Math.max(1e-9, (y1 - y0) / G);
  const bins: number[][] = Array.from({ length: G * G }, () => []);
  // fill edges by row band (for the inside test)
  const rows: number[][] = Array.from({ length: G }, () => []);
  for (let k = 0; k < n; k++) {
    const ax = S[4 * k], ay = S[4 * k + 1], bx = S[4 * k + 2], by = S[4 * k + 3]; // prettier-ignore
    const hw = isFill[k] ? 0 : halfOf(k);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - x0) / cw));
    const i1 = Math.min(G - 1, Math.floor((Math.max(ax, bx) + hw - x0) / cw));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - hw - y0) / ch));
    const j1 = Math.min(G - 1, Math.floor((Math.max(ay, by) + hw - y0) / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[j * G + i].push(k);
    if (isFill[k]) for (let j = j0; j <= j1; j++) rows[j].push(k);
  }
  const anyFill = isFill.some((f) => f === 1);
  const segDist = (k: number, x: number, y: number) => {
    const ax = S[4 * k], ay = S[4 * k + 1], bx = S[4 * k + 2], by = S[4 * k + 3]; // prettier-ignore
    const ex = bx - ax;
    const ey = by - ay;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - ax - t * ex, y - ay - t * ey);
  };
  const inside = (x: number, y: number) => {
    if (!anyFill || y < y0 || y > y1) return false;
    const j = Math.min(G - 1, Math.max(0, Math.floor((y - y0) / ch)));
    let c = 0;
    for (const k of rows[j]) {
      const ay = S[4 * k + 1], by = S[4 * k + 3]; // prettier-ignore
      if (ay > y === by > y) continue;
      const ax = S[4 * k], bx = S[4 * k + 2]; // prettier-ignore
      if (ax + ((y - ay) / (by - ay)) * (bx - ax) > x) c ^= 1;
    }
    return c === 1;
  };
  const dist = (x: number, y: number, cap: number) => {
    const inF = inside(x, y);
    let dF = cap;
    let dS = cap;
    if (x >= x0 - cap && x <= x1 + cap && y >= y0 - cap && y <= y1 + cap) {
      const i0 = Math.max(0, Math.floor((x - cap - x0) / cw));
      const i1 = Math.min(G - 1, Math.floor((x + cap - x0) / cw));
      const j0 = Math.max(0, Math.floor((y - cap - y0) / ch));
      const j1 = Math.min(G - 1, Math.floor((y + cap - y0) / ch));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++)
          for (const k of bins[j * G + i]) {
            if (isFill[k]) {
              const d = segDist(k, x, y);
              if (d < dF) dF = d;
            } else {
              const d = segDist(k, x, y) - halfOf(k);
              if (d < dS) dS = d;
            }
          }
    }
    const d = Math.min(inF ? -dF : dF, dS);
    return d < -cap ? -cap : d > cap ? cap : d;
  };
  return { dist, w, h, ...extra };
}

/** Everything the map depends on (the cache key). */
const mapKey = (p: VaseParams, H: number, rRef: number, cap: number) =>
  JSON.stringify([p.motif, p.print.lineWidth, p.sleeve.holes.minBridgeWidth, H, Math.round(rRef * 100) / 100, cap]);
let cache: { key: string; map: MotifMap | null } | null = null;

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
  make(strokeHalf: number): MotifSource;
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
};
/** Register a motif kind (persian/, text) without a circular import. */
export function registerMotifSource(kind: VaseParams['motif']['source'], f: ProtoFactory) {
  factories[kind] = f;
}

/**
 * The motif distance map for the current params on a body of height H at reference radius rRef, or null. Cached
 * (one entry): relief effects and the hole map ask for the same map.
 */
export function buildMotifMap(p: VaseParams, H: number, rRef: number, cap = 3): MotifMap | null {
  const key = mapKey(p, H, rRef, cap);
  if (cache?.key === key) return cache.map;
  const map = rasterise(p, H, rRef, cap);
  cache = { key, map };
  return map;
}

function rasterise(p: VaseParams, H: number, rRef: number, cap: number): MotifMap | null {
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
  const sc =
    periodic > 0
      ? circ / (N * periodic)
      : m.placement === 'repeat'
        ? (m.fill / 100) * Math.min(cwid / Math.max(proto.w, 1e-9), chgt / Math.max(proto.h, 1e-9)) || 1
        : m.size / Math.max(proto.w, proto.h, 1e-9);
  const src = proto.make(proto.halfMm / sc);
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
    // Persian strips: N periods around; the strip's y runs up the body at the same scale (no stretching)
    for (let j = 0; j < nz; j++) {
      const z = j * dz;
      for (let i = 0; i < nx; i++) {
        let x = (i / nx) * circ - phase;
        x -= circ * Math.floor(x / circ);
        const xu = (x / sc) % periodic;
        const yu = z / sc;
        const u = cr * xu + sr * yu;
        const v = -sr * xu + cr * yu;
        const dd = src.dist(u, v, cap / sc) * sc;
        d[j * nx + i] = dd;
        if (lvl && dd < 0) lvl[j * nx + i] = src.level!(u, v);
      }
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
