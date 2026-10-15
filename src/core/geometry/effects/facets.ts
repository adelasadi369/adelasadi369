import { TAU } from '../../math';
import { hash3 } from '../../random';
import type { Effect } from '../../params/schema';
import type { ModifyFn, PrevEval } from './types';

type Facets = Extract<Effect, { type: 'facets' }>;

/**
 * Low-poly facets: nodes on an (a × v) grid inside the effect window sample the field below and get
 * seeded radial jitter; each cell is split into two exact planar triangles. For a vertex at (θ, z)
 * on triangle plane n·X = d: r = (d − n_z z) / (n_x cos θ + n_y sin θ).
 */
export function facetsModifier(e: Facets, height: number, prev: PrevEval): { modify: ModifyFn; rowBreaks: number[] } {
  const a = e.angularSegments;
  const vs = e.verticalSegments;
  const t0 = e.start / 100;
  const t1 = e.end / 100;
  const rowBreaks: number[] = [];
  const nodes = new Float64Array(a * (vs + 1) * 3);
  for (let k = 0; k <= vs; k++) {
    const t = t0 + ((t1 - t0) * k) / vs;
    rowBreaks.push(t);
    for (let i = 0; i < a; i++) {
      const th = (TAU * i) / a;
      const jitter = e.jitter * (2 * hash3(e.seed, i, k) - 1);
      const r = Math.max(1, prev(th, t) + jitter);
      const o = (k * a + i) * 3;
      nodes[o] = r * Math.cos(th);
      nodes[o + 1] = r * Math.sin(th);
      nodes[o + 2] = t * height;
    }
  }
  // two planes per cell: lower (00,10,11) and upper (00,11,01); store n (3) + d
  const planes = new Float64Array(a * vs * 2 * 4);
  const node = (i: number, k: number) => ((k * a + (i % a)) * 3);
  const setPlane = (slot: number, p: number, q: number, r: number) => {
    const ux = nodes[q] - nodes[p], uy = nodes[q + 1] - nodes[p + 1], uz = nodes[q + 2] - nodes[p + 2];
    const vx = nodes[r] - nodes[p], vy = nodes[r + 1] - nodes[p + 1], vz = nodes[r + 2] - nodes[p + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    planes[slot] = nx;
    planes[slot + 1] = ny;
    planes[slot + 2] = nz;
    planes[slot + 3] = nx * nodes[p] + ny * nodes[p + 1] + nz * nodes[p + 2];
  };
  for (let k = 0; k < vs; k++) {
    for (let i = 0; i < a; i++) {
      const base = ((k * a + i) * 2) * 4;
      setPlane(base, node(i, k), node(i + 1, k), node(i + 1, k + 1));
      setPlane(base + 4, node(i, k), node(i + 1, k + 1), node(i, k + 1));
    }
  }
  const modify: ModifyFn = (thetaW, c, s, t, v) => {
    if (t < t0 || t > t1) return v;
    const uA = ((thetaW / TAU) % 1 + 1) % 1 * a;
    const i = Math.min(a - 1, Math.floor(uA));
    const wV = ((t - t0) / (t1 - t0)) * vs;
    const k = Math.min(vs - 1, Math.max(0, Math.floor(wV)));
    const u = uA - i;
    const w = wV - k;
    const slot = ((k * a + i) * 2 + (w <= u ? 0 : 1)) * 4;
    const den = planes[slot] * c + planes[slot + 1] * s;
    if (Math.abs(den) < 1e-9) return v;
    const r = (planes[slot + 3] - planes[slot + 2] * t * height) / den;
    return r > 0 ? r : v;
  };
  return { modify, rowBreaks };
}
