import type { TriMesh } from './post';

/**
 * Quadric edge-collapse decimation (Garland–Heckbert) for closed marching-cubes meshes, used at export (S4).
 *
 * - Every collapse keeps the mesh a closed 2-manifold: the link condition (the endpoints share exactly the two
 *   opposite vertices), no flipped or sliver triangles, no vertex of degree < 3.
 * - `kind[v] > 0` marks snapped vertices (1 bore, 2 bottom opening, 3 base). They never move: a free vertex may
 *   collapse onto one, and a snapped vertex may only collapse onto a neighbour of the same kind when all its own
 *   neighbours share that kind (interior of the bore, opening or bed). Bed vertices stay on z = 0 and the bed
 *   outline stays; on the bore and the opening every new facet must stay within `sag` of its vertices' radius,
 *   so a fitted tube still meets the facets within the bore tolerance.
 * - Free collapses stop at a quadric error of `maxError` (distance in mm to the merged planes).
 * Deterministic: ties in the heap break by edge order.
 */
export interface DecimateOptions {
  /** Stop once the mesh has at most this many triangles. */
  target: number;
  kind?: Uint8Array;
  /** Largest allowed quadric distance error (mm). */
  maxError?: number;
  /** Largest chord sag on the bore / opening facets (mm). */
  sag?: number;
}

export interface Decimated {
  mesh: TriMesh;
  /** Old vertex → new vertex (−1 = removed). */
  remap: Int32Array;
  before: number;
  after: number;
}

/** Binary min-heap over (cost, edge) with parallel typed arrays. */
class Heap {
  cost = new Float64Array(1024);
  a = new Int32Array(1024);
  b = new Int32Array(1024);
  n = 0;
  push(c: number, a: number, b: number) {
    if (this.n === this.cost.length) {
      const grow = <T extends Float64Array | Int32Array>(x: T): T => {
        const y = new (x.constructor as { new (n: number): T })(x.length * 2);
        y.set(x);
        return y;
      };
      this.cost = grow(this.cost);
      this.a = grow(this.a);
      this.b = grow(this.b);
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= c) break;
      this.move(p, i);
      i = p;
    }
    this.cost[i] = c;
    this.a[i] = a;
    this.b[i] = b;
  }
  private move(from: number, to: number) {
    this.cost[to] = this.cost[from];
    this.a[to] = this.a[from];
    this.b[to] = this.b[from];
  }
  /** Pops the minimum into out = [cost, a, b]; false when empty. */
  pop(out: number[]): boolean {
    if (this.n === 0) return false;
    out[0] = this.cost[0];
    out[1] = this.a[0];
    out[2] = this.b[0];
    const n = --this.n;
    if (n === 0) return true;
    const c = this.cost[n], a = this.a[n], b = this.b[n]; // prettier-ignore
    let i = 0;
    for (;;) {
      let k = 2 * i + 1;
      if (k >= n) break;
      if (k + 1 < n && this.cost[k + 1] < this.cost[k]) k++;
      if (this.cost[k] >= c) break;
      this.move(k, i);
      i = k;
    }
    this.cost[i] = c;
    this.a[i] = a;
    this.b[i] = b;
    return true;
  }
}

/** Most incident triangles per vertex (a collapse that would exceed it is skipped). */
const MAXD = 20;

function unchanged(m: TriMesh, before: number): Decimated {
  const remap = new Int32Array(m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) remap[v] = v;
  return { mesh: m, remap, before, after: m.triangleCount };
}

export function decimate(m: TriMesh, opts: DecimateOptions): Decimated {
  const V = m.vertexCount;
  const T = m.triangleCount;
  const before = T;
  const kind = opts.kind ?? new Uint8Array(V);
  const maxErr2 = (opts.maxError ?? 0.05) ** 2;
  const sag = opts.sag ?? 0.03;
  if (T <= opts.target) return unchanged(m, before);

  const P = Float64Array.from(m.positions);
  const I = Int32Array.from(m.indices);
  const dead = new Uint8Array(T);
  const gone = new Uint8Array(V);
  // vertex → incident triangles
  // vertex → incident triangles in fixed slots (MAXD per vertex): no per-vertex arrays for ~10⁶ vertices
  const VT = new Int32Array(V * MAXD);
  const deg = new Uint8Array(V);
  for (let t = 0; t < T; t++)
    for (let e = 0; e < 3; e++) {
      const w = I[t * 3 + e];
      if (deg[w] === MAXD) return unchanged(m, before);
      VT[w * MAXD + deg[w]++] = t;
    }

  // quadrics (symmetric 4×4 as 10 coefficients) from unit face planes
  const Q = new Float64Array(V * 10);
  for (let t = 0; t < T; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3; // prettier-ignore
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]; // prettier-ignore
    const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2]; // prettier-ignore
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; // prettier-ignore
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-12) continue;
    nx /= l;
    ny /= l;
    nz /= l;
    const d = -(nx * P[a] + ny * P[a + 1] + nz * P[a + 2]);
    for (let e = 0; e < 3; e++) {
      const o = I[t * 3 + e] * 10;
      Q[o] += nx * nx;
      Q[o + 1] += nx * ny;
      Q[o + 2] += nx * nz;
      Q[o + 3] += nx * d;
      Q[o + 4] += ny * ny;
      Q[o + 5] += ny * nz;
      Q[o + 6] += ny * d;
      Q[o + 7] += nz * nz;
      Q[o + 8] += nz * d;
      Q[o + 9] += d * d;
    }
  }
  const q = new Float64Array(10);
  const err = (x: number, y: number, z: number) =>
    q[0] * x * x +
    2 * q[1] * x * y +
    2 * q[2] * x * z +
    2 * q[3] * x +
    q[4] * y * y +
    2 * q[5] * y * z +
    2 * q[6] * y +
    q[7] * z * z +
    2 * q[8] * z +
    q[9];

  // neighbour marks: mark[w] === stamp ⇔ w is a neighbour of the vertex last scanned
  const mark = new Int32Array(V);
  let stamp = 0;
  const nb: number[] = [];
  /** Unique neighbours of v into nb; marks them with a fresh stamp. */
  const scan = (v: number) => {
    stamp++;
    nb.length = 0;
    for (let k = 0; k < deg[v]; k++)
      for (let e = 0, t = VT[v * MAXD + k]; e < 3; e++) {
        const w = I[t * 3 + e];
        if (w !== v && mark[w] !== stamp) {
          mark[w] = stamp;
          nb.push(w);
        }
      }
    return nb.length;
  };
  /** Snapped vertex u may leave only from the interior of its own surface. */
  const interior = (u: number) => {
    const k = kind[u];
    for (let j = 0; j < deg[u]; j++)
      for (let e = 0, t = VT[u * MAXD + j]; e < 3; e++) if (kind[I[t * 3 + e]] !== k) return false;
    return true;
  };

  // candidate collapse of edge (a, b): which vertex goes (u), which stays (v), where v goes, and the cost
  const best = { u: -1, v: -1, x: 0, y: 0, z: 0, c: Infinity };
  function consider(u: number, v: number, x: number, y: number, z: number) {
    const c = Math.max(0, err(x, y, z));
    if (c < best.c) {
      best.c = c;
      best.u = u;
      best.v = v;
      best.x = x;
      best.y = y;
      best.z = z;
    }
  }
  function evaluate(a: number, b: number) {
    best.c = Infinity;
    best.u = -1;
    for (let k = 0; k < 10; k++) q[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const ka = kind[a];
    const kb = kind[b];
    const pa = a * 3;
    const pb = b * 3;
    if (ka === 0 && kb === 0) {
      // optimal point: solve the 3×3 system, fall back to the endpoints and the midpoint
      const a11 = q[0], a12 = q[1], a13 = q[2], a22 = q[4], a23 = q[5], a33 = q[7]; // prettier-ignore
      const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
      const mx = (P[pa] + P[pb]) / 2, my = (P[pa + 1] + P[pb + 1]) / 2, mz = (P[pa + 2] + P[pb + 2]) / 2; // prettier-ignore
      if (Math.abs(det) > 1e-9) {
        const b1 = -q[3], b2 = -q[6], b3 = -q[8]; // prettier-ignore
        const x = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det;
        const y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det;
        const z = (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det;
        // stay near the edge: a far optimum means a near-flat region, where the midpoint is as good
        const L2 = (P[pa] - P[pb]) ** 2 + (P[pa + 1] - P[pb + 1]) ** 2 + (P[pa + 2] - P[pb + 2]) ** 2;
        if ((x - mx) ** 2 + (y - my) ** 2 + (z - mz) ** 2 < L2) consider(a, b, x, y, z);
      }
      consider(a, b, mx, my, mz);
      consider(a, b, P[pb], P[pb + 1], P[pb + 2]);
      consider(b, a, P[pa], P[pa + 1], P[pa + 2]);
    } else {
      // a snapped vertex never moves: the other one comes to it
      if (ka === 0 || (ka === kb && interior(a))) consider(a, b, P[pb], P[pb + 1], P[pb + 2]);
      if (kb === 0 || (ka === kb && interior(b))) consider(b, a, P[pa], P[pa + 1], P[pa + 2]);
    }
  }

  const heap = new Heap();
  const pushEdge = (a: number, b: number) => {
    evaluate(a, b);
    if (best.u < 0 || best.c > maxErr2) return;
    heap.push(best.c, a, b);
  };
  // initial edges (each once: a < b, in triangle order: deterministic)
  for (let t = 0; t < T; t++)
    for (let e = 0; e < 3; e++) {
      const a = I[t * 3 + e];
      const b = I[t * 3 + ((e + 1) % 3)];
      if (a < b) pushEdge(a, b);
    }

  /**
   * Triangle t with vertex `from` moved to (x, y, z): false when it flips (normal turns > 72°), degenerates or turns
   * into a sliver, or (on the bore / opening) when the facet sags more than `sag` inside its vertices' radius.
   */
  function moveOk(t: number, from: number, x: number, y: number, z: number): boolean {
    const i0 = I[t * 3], i1 = I[t * 3 + 1], i2 = I[t * 3 + 2]; // prettier-ignore
    const ax = P[i0 * 3], ay = P[i0 * 3 + 1], az = P[i0 * 3 + 2]; // prettier-ignore
    const bx = P[i1 * 3], by = P[i1 * 3 + 1], bz = P[i1 * 3 + 2]; // prettier-ignore
    const cx = P[i2 * 3], cy = P[i2 * 3 + 1], cz = P[i2 * 3 + 2]; // prettier-ignore
    const onx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ony = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const onz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const Ax = i0 === from ? x : ax, Ay = i0 === from ? y : ay, Az = i0 === from ? z : az; // prettier-ignore
    const Bx = i1 === from ? x : bx, By = i1 === from ? y : by, Bz = i1 === from ? z : bz; // prettier-ignore
    const Cx = i2 === from ? x : cx, Cy = i2 === from ? y : cy, Cz = i2 === from ? z : cz; // prettier-ignore
    const ux = Bx - Ax, uy = By - Ay, uz = Bz - Az; // prettier-ignore
    const wx = Cx - Ax, wy = Cy - Ay, wz = Cz - Az; // prettier-ignore
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; // prettier-ignore
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const ol = Math.sqrt(onx * onx + ony * ony + onz * onz);
    if (l < 1e-12 || ol < 1e-12 || (onx * nx + ony * ny + onz * nz) / (ol * l) < 0.3) return false;
    // sliver: twice the area over the longest edge squared
    const e2 = Math.max(ux * ux + uy * uy + uz * uz, wx * wx + wy * wy + wz * wz, (Cx - Bx) ** 2 + (Cy - By) ** 2 + (Cz - Bz) ** 2); // prettier-ignore
    if (l / e2 < 0.02) return false;
    const k = kind[i0];
    if ((k !== 1 && k !== 2) || kind[i1] !== k || kind[i2] !== k) return true;
    const rMin = Math.min(Math.hypot(Ax, Ay), Math.hypot(Bx, By), Math.hypot(Cx, Cy)) - sag;
    return (
      Math.hypot((Ax + Bx + Cx) / 3, (Ay + By + Cy) / 3) >= rMin &&
      Math.hypot((Ax + Bx) / 2, (Ay + By) / 2) >= rMin &&
      Math.hypot((Bx + Cx) / 2, (By + Cy) / 2) >= rMin &&
      Math.hypot((Cx + Ax) / 2, (Cy + Ay) / 2) >= rMin
    );
  }
  /** Every triangle of `from` except the two shared with `other` stays sound after the move. */
  function trisOk(from: number, other: number, x: number, y: number, z: number): boolean {
    for (let k = 0; k < deg[from]; k++) {
      const t = VT[from * MAXD + k];
      if (I[t * 3] === other || I[t * 3 + 1] === other || I[t * 3 + 2] === other) continue;
      if (!moveOk(t, from, x, y, z)) return false;
    }
    return true;
  }

  let alive = T;
  const top = [0, 0, 0];
  const out: number[] = [];
  while (alive > opts.target && heap.pop(top)) {
    const a = top[1];
    const b = top[2];
    if (gone[a] || gone[b]) continue;
    // re-evaluate instead of tracking stamps: a stale entry goes back with its current cost
    evaluate(a, b);
    if (best.u < 0 || best.c > maxErr2) continue;
    if (best.c > top[0] + 1e-12) {
      heap.push(best.c, a, b);
      continue;
    }
    const { u, v, x, y, z } = best;
    // link condition: common neighbours = the two opposite vertices of the shared triangles
    let shared = 0;
    for (let k = 0; k < deg[u]; k++) {
      const t = VT[u * MAXD + k];
      if (I[t * 3] === v || I[t * 3 + 1] === v || I[t * 3 + 2] === v) shared++;
    }
    if (shared !== 2 || deg[u] + deg[v] - 4 > MAXD || scan(v) < 4 || scan(u) < 4) continue;
    // marks now hold u's neighbours
    let common = 0;
    for (let k = 0; k < deg[v]; k++)
      for (let e = 0, t = VT[v * MAXD + k]; e < 3; e++) {
        const w = I[t * 3 + e];
        if (w !== v && w !== u && mark[w] === stamp) {
          mark[w] = -1;
          common++;
        }
      }
    if (common !== 2) continue;
    if (!trisOk(u, v, x, y, z) || !trisOk(v, u, x, y, z)) continue;

    // apply: drop the two shared triangles, move v, hand u's triangles to v
    for (let k = 0; k < deg[u]; k++) {
      const t = VT[u * MAXD + k];
      if (I[t * 3] !== v && I[t * 3 + 1] !== v && I[t * 3 + 2] !== v) continue;
      dead[t] = 1;
      alive--;
      for (let e = 0; e < 3; e++) {
        const w = I[t * 3 + e];
        if (w === u) continue;
        // swap-remove t from w's slots
        const o = w * MAXD;
        for (let j = 0; j < deg[w]; j++)
          if (VT[o + j] === t) {
            VT[o + j] = VT[o + --deg[w]];
            break;
          }
      }
    }
    for (let k = 0; k < deg[u]; k++) {
      const t = VT[u * MAXD + k];
      if (dead[t]) continue;
      for (let e = 0; e < 3; e++) if (I[t * 3 + e] === u) I[t * 3 + e] = v;
      VT[v * MAXD + deg[v]++] = t;
    }
    deg[u] = 0;
    gone[u] = 1;
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    for (let k = 0; k < 10; k++) Q[v * 10 + k] += Q[u * 10 + k];
    scan(v);
    out.length = 0;
    for (const w of nb) out.push(w);
    for (const w of out) pushEdge(Math.min(v, w), Math.max(v, w));
  }

  // compact
  const remap = new Int32Array(V).fill(-1);
  let nv = 0;
  for (let t = 0; t < T; t++) {
    if (dead[t]) continue;
    for (let e = 0; e < 3; e++) {
      const w = I[t * 3 + e];
      if (remap[w] < 0) remap[w] = nv++;
    }
  }
  const positions = new Float32Array(nv * 3);
  for (let w = 0; w < V; w++) {
    const r = remap[w];
    if (r < 0) continue;
    positions[r * 3] = P[w * 3];
    positions[r * 3 + 1] = P[w * 3 + 1];
    positions[r * 3 + 2] = P[w * 3 + 2];
  }
  const indices = new Uint32Array(alive * 3);
  let n = 0;
  for (let t = 0; t < T; t++) {
    if (dead[t]) continue;
    indices[n++] = remap[I[t * 3]];
    indices[n++] = remap[I[t * 3 + 1]];
    indices[n++] = remap[I[t * 3 + 2]];
  }
  return { mesh: { positions, indices, vertexCount: nv, triangleCount: alive }, remap, before, after: alive };
}
