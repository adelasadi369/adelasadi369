import { segmentSource, type MotifSource } from '../motif/source';
import type { VaseParams } from '../params/schema';
import { hankin, type Segment } from './hankin';
import { polygonsIn, tiling, type Tiling, type TilingId, type V2 } from './tilings';

export { hankin } from './hankin';
export { gapPolygons, polygonsIn, tiling, TILINGS, type TilingId } from './tilings';

/**
 * Persian geometric patterns as motif sources (docs/persian-patterns.md, GEOMETRY.md §15): a Hankin strap network
 * on a periodic tiling, cut into a horizontal strip whose x period is a lattice vector, so N periods wrap the body
 * with no seam. Cells (outside the straps) are the openings in sleeve hole mode 'pattern'; the straps are bridges.
 */
type Persian = VaseParams['motif']['persian'];

/** Named patterns: tiling, contact angle, line offset. */
export const PRESETS: Record<
  Exclude<Persian['preset'], 'custom'>,
  { tiling: TilingId; angle: number; offset: number }
> = {
  // khatam: the 8-point star of octagons in 4.8.8 (Kaplan's classic 67.5°)
  khatam: { tiling: '4.8.8', angle: 67.5, offset: 0 },
  // shamseh: rosettes from the two-line (offset) variant
  shamseh8: { tiling: '4.8.8', angle: 72, offset: 0.12 },
  shamseh10: { tiling: 'girih-decagons', angle: 63, offset: 0.1 },
  // girih: the girih tiles' strapwork crosses every edge midpoint at 54°
  girih10: { tiling: 'girih-decagons', angle: 54, offset: 0 },
  star12: { tiling: '4.6.12', angle: 60, offset: 0 },
};

export function resolvePersian(p: Persian) {
  return p.preset === 'custom'
    ? { tiling: p.tiling as TilingId, angle: p.contactAngle, offset: p.offset }
    : PRESETS[p.preset];
}

/** Lattice vectors m·a + n·b (|m|, |n| ≤ 3) as candidate strip directions, shortest first, one per direction. */
export function latticeDirections(t: Tiling): { w: V2; P: number; deg: number }[] {
  const out: { w: V2; P: number; deg: number }[] = [];
  const maxP = 4 * Math.max(Math.hypot(...t.a), Math.hypot(...t.b));
  for (let m = -3; m <= 3; m++)
    for (let n = -3; n <= 3; n++) {
      const w: V2 = [m * t.a[0] + n * t.b[0], m * t.a[1] + n * t.b[1]];
      const P = Math.hypot(w[0], w[1]);
      if (P < 1e-9 || P > maxP) continue;
      let deg = (Math.atan2(w[1], w[0]) * 180) / Math.PI;
      deg = ((deg % 180) + 180) % 180;
      // keep w pointing to +x (or +y) so the strip is not mirrored
      const ww: V2 = deg === (Math.atan2(w[1], w[0]) * 180) / Math.PI ? w : [-w[0], -w[1]];
      if (out.some((o) => Math.abs(o.deg - deg) < 1e-6 && o.P <= P + 1e-9)) continue;
      const k = out.findIndex((o) => Math.abs(o.deg - deg) < 1e-6);
      if (k >= 0) out.splice(k, 1);
      out.push({ w: ww, P, deg });
    }
  return out.sort((x, y) => x.P - y.P || x.deg - y.deg);
}

/** Strap network in strip coordinates (x along w, y across), for the strip window. */
export function stripSegments(t: Tiling, w: V2, angle: number, offset: number, win: [number, number, number, number]) {
  const P = Math.hypot(w[0], w[1]);
  const ux = w[0] / P;
  const uy = w[1] / P;
  // strip (x, y) → tiling x·u + y·u⊥ ; back with dot products
  const toT = (x: number, y: number): V2 => [x * ux - y * uy, x * uy + y * ux];
  const toS = (p: V2): V2 => [p[0] * ux + p[1] * uy, -p[0] * uy + p[1] * ux];
  const [x0, y0, x1, y1] = win;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; // prettier-ignore
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as V2[]) {
    const [tx, ty] = toT(x, y);
    bx0 = Math.min(bx0, tx);
    bx1 = Math.max(bx1, tx);
    by0 = Math.min(by0, ty);
    by1 = Math.max(by1, ty);
  }
  const segs: Segment[] = [];
  for (const poly of polygonsIn(t, [bx0, by0, bx1, by1]))
    for (const s of hankin(poly, angle, offset)) {
      const a = toS(s.a);
      const b = toS(s.b);
      if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1) continue;
      if (Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1) continue;
      segs.push({ a, b });
    }
  return segs;
}

/** Share of strap length within 25° of horizontal (flat cell tops and bottoms). */
export function horizontalShare(segs: Segment[]): number {
  let h = 0;
  let all = 0;
  const c25 = Math.cos((25 * Math.PI) / 180) ** 2;
  for (const s of segs) {
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) continue;
    const L = Math.sqrt(L2);
    all += L;
    const c2 = (dx * dx) / L2;
    if (c2 > c25) h += L;
  }
  return all ? h / all : 0;
}

/**
 * Strip direction: the lattice direction nearest the requested rotation (shorter period on ties), or with
 * auto-rotate the one with the least horizontal strap length (cell tops that would need supports).
 */
export function chooseDirection(
  t: Tiling,
  persian: { autoRotate: boolean },
  rotation: number,
  angle: number,
  offset: number,
) {
  const dirs = latticeDirections(t).filter((d, _i, all) => d.P <= 2.5 * all[0].P + 1e-9);
  if (persian.autoRotate) {
    let best = dirs[0];
    let score = Infinity;
    for (const d of dirs) {
      const segs = stripSegments(t, d.w, angle, offset, [0, 0, d.P, d.P]);
      const s = horizontalShare(segs) + 0.02 * (d.P / dirs[0].P);
      if (s < score - 1e-9) {
        score = s;
        best = d;
      }
    }
    return best;
  }
  const want = ((rotation % 180) + 180) % 180;
  const dist = (deg: number) => Math.min(Math.abs(deg - want), 180 - Math.abs(deg - want));
  return dirs.reduce((b, d) => (dist(d.deg) < dist(b.deg) - 1e-6 ? d : b), dirs[0]);
}

/**
 * Interlace (relief only): at each strap crossing one strand stays up and the other steps down under it. The strand
 * whose direction angle (mod 180°) is smaller goes over: a local rule, so the levels are periodic like the straps.
 * Strands that cross at an edge midpoint (offset 0) are found as two collinear pairs among the segments meeting there.
 */
function interlaceLevel(segs: Segment[], half: number) {
  const cross: { x: number; y: number; ox: number; oy: number }[] = [];
  const dir = (s: Segment): V2 => {
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  };
  const mod180 = (d: V2) => {
    const a = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    return ((a % 180) + 180) % 180;
  };
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i];
      const q = segs[j];
      const r: V2 = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
      const s: V2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const wx = q.a[0] - p.a[0];
      const wy = q.a[1] - p.a[1];
      const t = (wx * s[1] - wy * s[0]) / den;
      const u = (wx * r[1] - wy * r[0]) / den;
      // proper crossings and crossings at shared endpoints that continue straight (edge midpoints)
      if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) continue;
      const endP = t < 1e-6 || t > 1 - 1e-6;
      const endQ = u < 1e-6 || u > 1 - 1e-6;
      if (endP && endQ) {
        // both end here: a strand turning at a star tip is not a crossing; an X at a midpoint has angle > 20°
        const c = Math.abs(dir(p)[0] * dir(q)[0] + dir(p)[1] * dir(q)[1]);
        if (c > 0.94 || !straightThrough(segs, p, t < 0.5 ? p.a : p.b)) continue;
      }
      const x = p.a[0] + t * r[0];
      const y = p.a[1] + t * r[1];
      if (cross.some((c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.y - y) < 1e-6)) continue;
      const over = mod180(dir(p)) < mod180(dir(q)) ? dir(p) : dir(q);
      cross.push({ x, y, ox: over[0], oy: over[1] });
    }
  const R = 2.5 * half;
  // crossings binned on a grid of cell R: a query looks at its own and the 8 neighbouring bins
  const bins = new Map<string, typeof cross>();
  const bk = (i: number, j: number) => `${i},${j}`;
  for (const c of cross) {
    const k = bk(Math.floor(c.x / R), Math.floor(c.y / R));
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k)!.push(c);
  }
  return (x: number, y: number) => {
    const bi = Math.floor(x / R);
    const bj = Math.floor(y / R);
    const near: typeof cross = [];
    for (let j = bj - 1; j <= bj + 1; j++)
      for (let i = bi - 1; i <= bi + 1; i++) near.push(...(bins.get(bk(i, j)) ?? []));
    for (const c of near) {
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy > R * R) continue;
      // off the over strand ⇒ on the under strand, close to the crossing: step down
      if (Math.abs(dx * c.oy - dy * c.ox) > half) return 0.5;
    }
    return 1;
  };
}
/** Some other segment leaves `pt` in the direction opposite to segment p (the strand runs straight through). */
function straightThrough(segs: Segment[], p: Segment, pt: V2) {
  const d: V2 = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
  const L = Math.hypot(d[0], d[1]) || 1;
  for (const q of segs) {
    if (q === p) continue;
    for (const [s, e] of [
      [q.a, q.b],
      [q.b, q.a],
    ] as [V2, V2][]) {
      if (Math.abs(s[0] - pt[0]) > 1e-6 || Math.abs(s[1] - pt[1]) > 1e-6) continue;
      const qx = e[0] - s[0];
      const qy = e[1] - s[1];
      const ql = Math.hypot(qx, qy) || 1;
      const sameSide = pt === p.b ? 1 : -1;
      if (((d[0] * qx + d[1] * qy) / (L * ql)) * sameSide > 0.999) return true;
    }
  }
  return false;
}

/** Stroke half-width in mm: never below two lines, nor half the bridge width when the cells are sleeve openings. */
export function strapHalfMm(p: VaseParams): number {
  const holes = p.print.outputMode === 'sleeve' && p.sleeve.holes.mode === 'pattern';
  return Math.max(p.motif.persian.strapWidth, 2 * p.print.lineWidth, holes ? p.sleeve.holes.minBridgeWidth : 0) / 2;
}

/** Motif proto for the map (motif/map.ts): period P along x, strip window built on demand. */
export function persianProto(p: VaseParams) {
  const cfg = resolvePersian(p.motif.persian);
  const t = tiling(cfg.tiling);
  const d = chooseDirection(t, p.motif.persian, p.motif.rotation, cfg.angle, cfg.offset);
  const P = d.P;
  return {
    w: P,
    h: P,
    period: P,
    halfMm: strapHalfMm(p),
    make(half: number, win: { y0: number; y1: number }): MotifSource {
      const segs = stripSegments(t, d.w, cfg.angle, cfg.offset, [
        -0.5 * P - 2 * half,
        win.y0 - P,
        1.5 * P + 2 * half,
        win.y1 + P,
      ]);
      const S = new Float64Array(segs.length * 4);
      segs.forEach((s, k) => S.set([s.a[0], s.a[1], s.b[0], s.b[1]], 4 * k));
      const level = p.motif.persian.interlace ? interlaceLevel(segs, half) : undefined;
      return segmentSource(S, new Uint8Array(segs.length), half, P, P, { holesAreCells: true, level });
    },
  };
}
