/**
 * Periodic tilings for Persian star patterns (docs/persian-patterns.md). Every tiling is a lattice (basis a, b) plus
 * the polygons of one cell (edge length 1); girih decagons add the gaps between edge-sharing decagons, found by
 * cancelling shared edges and chaining the rest into loops.
 *   4.4.4.4  squares                     6.6.6   hexagons
 *   4.8.8    octagons + squares          3.12.12 dodecagons + triangles
 *   4.6.12   dodecagons + hexagons + squares
 *   girih    decagons (gaps: bowties / pentagon-like girih pieces), elongated hexagons, 72° rhombi
 */
export type V2 = [number, number];
export type Poly = V2[];

export const TILINGS = ['4.4.4.4', '6.6.6', '4.8.8', '3.12.12', '4.6.12'] as const;
export const GIRIH = ['decagons', 'hexagons', 'rhombi'] as const;
export type TilingId = (typeof TILINGS)[number] | `girih-${(typeof GIRIH)[number]}`;

export interface Tiling {
  a: V2;
  b: V2;
  /** Polygons of one lattice cell (CCW). */
  cell: Poly[];
  /** Fill the gaps between the cell polygons (girih decagons). */
  gaps?: boolean;
}

const D = Math.PI / 180;
/** Regular n-gon with edge 1 centred at c, its first edge normal at angle `normal` (deg). CCW. */
function ngon(n: number, c: V2, normal = 0): Poly {
  const R = 1 / (2 * Math.sin(Math.PI / n));
  const out: Poly = [];
  for (let k = 0; k < n; k++) {
    const a = (normal - 180 / n + (360 * k) / n) * D;
    out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]);
  }
  return out;
}
const add = (p: V2, q: V2): V2 => [p[0] + q[0], p[1] + q[1]];
const sc = (p: V2, s: number): V2 => [p[0] * s, p[1] * s];

/** Polygon from edge headings (deg) walked from the origin, centred on its vertex mean. CCW for left turns. */
function walk(headings: number[]): Poly {
  const pts: Poly = [[0, 0]];
  for (const h of headings.slice(0, -1)) {
    const [x, y] = pts[pts.length - 1];
    pts.push([x + Math.cos(h * D), y + Math.sin(h * D)]);
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}

export function tiling(id: TilingId): Tiling {
  switch (id) {
    case '4.4.4.4':
      return { a: [1, 0], b: [0, 1], cell: [ngon(4, [0.5, 0.5])] };
    case '6.6.6': {
      const s3 = Math.sqrt(3);
      return { a: [s3, 0], b: [s3 / 2, 1.5], cell: [ngon(6, [0, 0])] };
    }
    case '4.8.8': {
      const L = 1 + Math.SQRT2;
      return { a: [L, 0], b: [0, L], cell: [ngon(8, [0, 0]), ngon(4, [L / 2, L / 2], 45)] };
    }
    case '3.12.12': {
      const L = 2 + Math.sqrt(3);
      const a: V2 = [L, 0];
      const b: V2 = [L / 2, (L * Math.sqrt(3)) / 2];
      const c1 = sc(add(a, b), 1 / 3);
      const c2 = sc(add(a, b), 2 / 3);
      // a triangle's edges face the three dodecagons around it, so its vertices point away from them
      return { a, b, cell: [ngon(12, [0, 0]), ngon(3, c1, 210), ngon(3, c2, 30)] };
    }
    case '4.6.12': {
      const L = 3 + Math.sqrt(3);
      const a: V2 = [L, 0];
      const b: V2 = [L / 2, (L * Math.sqrt(3)) / 2];
      return {
        a,
        b,
        cell: [
          ngon(12, [0, 0]),
          ngon(4, sc(a, 0.5), 0),
          ngon(4, sc(b, 0.5), 60),
          ngon(4, sc(add(a, b), 0.5), 120),
          ngon(6, sc(add(a, b), 1 / 3), 30),
          ngon(6, sc(add(a, b), 2 / 3), 30),
        ],
      };
    }
    case 'girih-decagons': {
      // edge-sharing decagons along 0° and 72° (both are edge normals of a decagon)
      const r = 1 / (2 * Math.tan(18 * D));
      return {
        a: [2 * r, 0],
        b: [2 * r * Math.cos(72 * D), 2 * r * Math.sin(72 * D)],
        cell: [ngon(10, [0, 0])],
        gaps: true,
      };
    }
    case 'girih-hexagons': {
      // elongated hexagon (72°, 144°, 144°, …): centrally symmetric, so it tiles by translation alone
      const hex = walk([0, 36, 144, 180, 216, 324]);
      const e = (h: number): V2 => [Math.cos(h * D), Math.sin(h * D)];
      return { a: add(e(0), e(36)), b: add(e(36), e(144)), cell: [hex] };
    }
    case 'girih-rhombi': {
      const rh = walk([0, 72, 180, 252]);
      return { a: [1, 0], b: [Math.cos(72 * D), Math.sin(72 * D)], cell: [rh] };
    }
  }
}

const key = (p: V2) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;

/** Gap loops between polygons: edges used once (not shared) chained into closed loops, returned CCW. */
export function gapPolygons(polys: Poly[]): Poly[] {
  const edges = new Map<string, [V2, V2]>();
  for (const p of polys)
    for (let k = 0; k < p.length; k++) {
      const a = p[k];
      const b = p[(k + 1) % p.length];
      const back = `${key(b)}|${key(a)}`;
      if (edges.has(back)) edges.delete(back);
      else edges.set(`${key(a)}|${key(b)}`, [a, b]);
    }
  // remaining edges run CCW around the tiles, i.e. CW around each gap: follow b → next edge starting at b
  const from = new Map<string, [V2, V2][]>();
  for (const e of edges.values()) {
    const k = key(e[0]);
    if (!from.has(k)) from.set(k, []);
    from.get(k)!.push(e);
  }
  const used = new Set<[V2, V2]>();
  const out: Poly[] = [];
  for (const e0 of edges.values()) {
    if (used.has(e0)) continue;
    const loop: Poly = [];
    let e = e0;
    let ok = false;
    for (let guard = 0; guard < 64; guard++) {
      used.add(e);
      loop.push(e[0]);
      const next = (from.get(key(e[1])) ?? []).filter((x) => !used.has(x));
      if (key(e[1]) === key(e0[0])) {
        ok = true;
        break;
      }
      if (!next.length) break;
      // at a vertex with several continuations take the sharpest right turn (stays on the gap's boundary)
      const dx = e[1][0] - e[0][0];
      const dy = e[1][1] - e[0][1];
      next.sort((p, q) => turn(dx, dy, p) - turn(dx, dy, q));
      e = next[0];
    }
    if (ok && loop.length >= 3 && loop.length <= 16) out.push(loop.reverse());
  }
  return out;
}
function turn(dx: number, dy: number, e: [V2, V2]) {
  const ex = e[1][0] - e[0][0];
  const ey = e[1][1] - e[0][1];
  return Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey);
}

/** All tiling polygons whose centre lies inside the box (tiling coordinates), plus gaps for girih decagons. */
export function polygonsIn(t: Tiling, box: [number, number, number, number]): Poly[] {
  const [x0, y0, x1, y1] = box;
  const det = t.a[0] * t.b[1] - t.a[1] * t.b[0];
  const toLat = (x: number, y: number): V2 => [(x * t.b[1] - y * t.b[0]) / det, (-x * t.a[1] + y * t.a[0]) / det];
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity; // prettier-ignore
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as V2[]) {
    const [i, j] = toLat(x, y);
    i0 = Math.min(i0, i);
    i1 = Math.max(i1, i);
    j0 = Math.min(j0, j);
    j1 = Math.max(j1, j);
  }
  const out: Poly[] = [];
  const pad = 2;
  for (let j = Math.floor(j0) - pad; j <= Math.ceil(j1) + pad; j++)
    for (let i = Math.floor(i0) - pad; i <= Math.ceil(i1) + pad; i++) {
      const o: V2 = [i * t.a[0] + j * t.b[0], i * t.a[1] + j * t.b[1]];
      for (const p of t.cell) out.push(p.map((v) => add(v, o)));
    }
  const all = t.gaps ? [...out, ...gapPolygons(out)] : out;
  const m = 3;
  return all.filter((p) => {
    const cx = p.reduce((s, v) => s + v[0], 0) / p.length;
    const cy = p.reduce((s, v) => s + v[1], 0) / p.length;
    return cx >= x0 - m && cx <= x1 + m && cy >= y0 - m && cy <= y1 + m;
  });
}
