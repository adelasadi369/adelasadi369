import type { ShapeSet } from './blob';

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
  // square bins, about two segments per bin (long Persian strips are far taller than wide)
  const area = Math.max(1e-12, (x1 - x0) * (y1 - y0));
  const cell = Math.max(1e-6, Math.sqrt((2 * area) / Math.max(1, n)));
  const GX = Math.max(1, Math.min(512, Math.ceil((x1 - x0) / cell)));
  const GY = Math.max(1, Math.min(4096, Math.ceil((y1 - y0) / cell)));
  const cw = Math.max(1e-9, (x1 - x0) / GX);
  const ch = Math.max(1e-9, (y1 - y0) / GY);
  const bins: number[][] = Array.from({ length: GX * GY }, () => []);
  // fill edges by row band (for the inside test)
  const rows: number[][] = Array.from({ length: GY }, () => []);
  for (let k = 0; k < n; k++) {
    const ax = S[4 * k], ay = S[4 * k + 1], bx = S[4 * k + 2], by = S[4 * k + 3]; // prettier-ignore
    const hw = isFill[k] ? 0 : halfOf(k);
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - hw - x0) / cw));
    const i1 = Math.min(GX - 1, Math.floor((Math.max(ax, bx) + hw - x0) / cw));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - hw - y0) / ch));
    const j1 = Math.min(GY - 1, Math.floor((Math.max(ay, by) + hw - y0) / ch));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[j * GX + i].push(k);
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
    const j = Math.min(GY - 1, Math.max(0, Math.floor((y - y0) / ch)));
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
      const i1 = Math.min(GX - 1, Math.floor((x + cap - x0) / cw));
      const j0 = Math.max(0, Math.floor((y - cap - y0) / ch));
      const j1 = Math.min(GY - 1, Math.floor((y + cap - y0) / ch));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++)
          for (const k of bins[j * GX + i]) {
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
