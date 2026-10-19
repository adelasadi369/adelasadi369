/** Post-processing for marching-cubes meshes: normals, adjacency, Taubin smoothing, islands, orientation. */

export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Area-weighted vertex normals. */
export function vertexNormals(m: TriMesh): Float32Array {
  const { positions: P, indices: I } = m;
  const acc = new Float64Array(m.vertexCount * 3);
  for (let t = 0; t < m.triangleCount; t++) {
    const a = I[t * 3] * 3,
      b = I[t * 3 + 1] * 3,
      c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a],
      uy = P[b + 1] - P[a + 1],
      uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a],
      vy = P[c + 1] - P[a + 1],
      vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    acc[a] += nx;
    acc[a + 1] += ny;
    acc[a + 2] += nz;
    acc[b] += nx;
    acc[b + 1] += ny;
    acc[b + 2] += nz;
    acc[c] += nx;
    acc[c + 1] += ny;
    acc[c + 2] += nz;
  }
  const n = new Float32Array(acc.length);
  for (let v = 0; v < acc.length; v += 3) {
    const l = Math.sqrt(acc[v] * acc[v] + acc[v + 1] * acc[v + 1] + acc[v + 2] * acc[v + 2]) || 1;
    n[v] = acc[v] / l;
    n[v + 1] = acc[v + 1] / l;
    n[v + 2] = acc[v + 2] / l;
  }
  return n;
}

/** Vertex → neighbour lists (CSR, unique). */
export function adjacency(m: TriMesh): { start: Uint32Array; nbr: Uint32Array } {
  const V = m.vertexCount;
  const I = m.indices;
  const deg = new Uint32Array(V + 1);
  for (let k = 0; k < m.triangleCount * 3; k++) deg[I[k]] += 2;
  const start = new Uint32Array(V + 1);
  for (let v = 0; v < V; v++) start[v + 1] = start[v] + deg[v];
  const fill = start.slice(0, V);
  const raw = new Uint32Array(start[V]);
  for (let t = 0; t < m.triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = I[t * 3 + e];
      const b = I[t * 3 + ((e + 1) % 3)];
      raw[fill[a]++] = b;
      raw[fill[b]++] = a;
    }
  }
  // dedupe each list (an interior edge appears twice per endpoint)
  const outStart = new Uint32Array(V + 1);
  const out = new Uint32Array(raw.length);
  let w = 0;
  for (let v = 0; v < V; v++) {
    outStart[v] = w;
    const list = raw.subarray(start[v], start[v + 1]).sort();
    for (let k = 0; k < list.length; k++) if (k === 0 || list[k] !== list[k - 1]) out[w++] = list[k];
  }
  outStart[V] = w;
  return { start: outStart, nbr: out.slice(0, w) };
}

/** Taubin λ/μ smoothing (uniform Laplacian). Locked vertices never move. */
export function taubin(
  m: TriMesh,
  adj: { start: Uint32Array; nbr: Uint32Array },
  locked: Uint8Array,
  iterations: number,
  lambda = 0.5,
  mu = -0.53,
) {
  const P = m.positions;
  const V = m.vertexCount;
  const d = new Float64Array(V * 3);
  for (let it = 0; it < iterations * 2; it++) {
    const f = it % 2 === 0 ? lambda : mu;
    for (let v = 0; v < V; v++) {
      const s = adj.start[v];
      const e = adj.start[v + 1];
      if (locked[v] || e === s) {
        d[v * 3] = d[v * 3 + 1] = d[v * 3 + 2] = 0;
        continue;
      }
      let x = 0,
        y = 0,
        z = 0;
      for (let k = s; k < e; k++) {
        const q = adj.nbr[k] * 3;
        x += P[q];
        y += P[q + 1];
        z += P[q + 2];
      }
      const n = e - s;
      d[v * 3] = f * (x / n - P[v * 3]);
      d[v * 3 + 1] = f * (y / n - P[v * 3 + 1]);
      d[v * 3 + 2] = f * (z / n - P[v * 3 + 2]);
    }
    for (let k = 0; k < V * 3; k++) P[k] += d[k];
  }
}

function signedVolumeOf(P: Float32Array, I: Uint32Array, t: number): number {
  const a = I[t * 3] * 3,
    b = I[t * 3 + 1] * 3,
    c = I[t * 3 + 2] * 3;
  return (
    (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
    6
  );
}

export interface IslandResult {
  mesh: TriMesh;
  /** Map old vertex → new vertex (−1 = removed). */
  remap: Int32Array;
  components: number;
  /** Removed volume (mm³) and fraction of the total. */
  removedVolume: number;
  removedFraction: number;
}

function unionFind(m: TriMesh): (v: number) => number {
  const parent = new Int32Array(m.vertexCount);
  for (let v = 0; v < m.vertexCount; v++) parent[v] = v;
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  const I = m.indices;
  for (let t = 0; t < m.triangleCount; t++) {
    const a = find(I[t * 3]);
    const b = find(I[t * 3 + 1]);
    if (a !== b) parent[b] = a;
    const c = find(I[t * 3 + 2]);
    const r = find(a);
    if (c !== r) parent[c] = r;
  }
  return find;
}

/** Number of connected components (vertices joined by triangles). */
export function countComponents(m: TriMesh): number {
  const find = unionFind(m);
  let n = 0;
  for (let v = 0; v < m.vertexCount; v++) if (find(v) === v) n++;
  return n;
}

/** Keep the connected component with the largest volume. */
export function keepLargest(m: TriMesh): IslandResult {
  const V = m.vertexCount;
  const I = m.indices;
  const find = unionFind(m);
  const vol = new Map<number, number>();
  for (let t = 0; t < m.triangleCount; t++) {
    const r = find(I[t * 3]);
    vol.set(r, (vol.get(r) ?? 0) + signedVolumeOf(m.positions, I, t));
  }
  let best = -1;
  let bestV = -Infinity;
  let total = 0;
  // deterministic: Map iteration follows first-seen order
  for (const [r, v] of vol) {
    total += Math.abs(v);
    if (Math.abs(v) > bestV) {
      bestV = Math.abs(v);
      best = r;
    }
  }
  const remap = new Int32Array(V).fill(-1);
  if (vol.size <= 1) {
    for (let v = 0; v < V; v++) remap[v] = v;
    return { mesh: m, remap, components: vol.size, removedVolume: 0, removedFraction: 0 };
  }
  let nv = 0;
  for (let v = 0; v < V; v++) if (find(v) === best) remap[v] = nv++;
  const pos = new Float32Array(nv * 3);
  for (let v = 0; v < V; v++) if (remap[v] >= 0) pos.set(m.positions.subarray(v * 3, v * 3 + 3), remap[v] * 3);
  const idx = new Uint32Array(m.triangleCount * 3);
  let nt = 0;
  for (let t = 0; t < m.triangleCount; t++) {
    if (remap[I[t * 3]] < 0) continue;
    idx[nt * 3] = remap[I[t * 3]];
    idx[nt * 3 + 1] = remap[I[t * 3 + 1]];
    idx[nt * 3 + 2] = remap[I[t * 3 + 2]];
    nt++;
  }
  const removed = total - bestV;
  return {
    mesh: { positions: pos, indices: idx.slice(0, nt * 3), vertexCount: nv, triangleCount: nt },
    remap,
    components: vol.size,
    removedVolume: removed,
    removedFraction: total > 0 ? removed / total : 0,
  };
}

/** Flip every triangle when the signed volume is negative (outward winding). Returns the volume. */
export function orientOutward(m: TriMesh): number {
  let v = 0;
  for (let t = 0; t < m.triangleCount; t++) v += signedVolumeOf(m.positions, m.indices, t);
  if (v < 0) {
    const I = m.indices;
    for (let t = 0; t < m.triangleCount; t++) {
      const b = I[t * 3 + 1];
      I[t * 3 + 1] = I[t * 3 + 2];
      I[t * 3 + 2] = b;
    }
  }
  return Math.abs(v);
}

export interface MeshValidity {
  edges: number;
  /** Edges not used by exactly two triangles. */
  badEdges: number;
  /** Edges whose two uses run the same way (inconsistent winding). */
  flippedEdges: number;
  degenerate: number;
  /** Vertices whose triangles do not form one fan (bow-ties, open fans). */
  badVertices: number;
  manifold: boolean;
}

/**
 * Full validity of a welded mesh in O(T): edge manifold (each edge used twice, once per direction), vertex manifold
 * (the opposite edges of a vertex's triangles form a single cycle) and degenerate triangles. Same edge result as
 * printability/sanity checkManifold, which sorts every edge key.
 */
export function meshValidity(m: TriMesh): MeshValidity {
  const V = m.vertexCount;
  const I = m.indices;
  const P = m.positions;
  const start = new Uint32Array(V + 1);
  for (let k = 0; k < m.triangleCount * 3; k++) start[I[k] + 1]++;
  for (let v = 0; v < V; v++) start[v + 1] += start[v];
  const fill = start.slice(0, V);
  // per vertex v and incident triangle (v, b, c): link edge b → c; so v → b and c → v are its directed edges
  const from = new Uint32Array(m.triangleCount * 3);
  const to = new Uint32Array(m.triangleCount * 3);
  let degenerate = 0;
  for (let t = 0; t < m.triangleCount; t++) {
    const a = I[t * 3],
      b = I[t * 3 + 1],
      c = I[t * 3 + 2];
    let k = fill[a]++;
    from[k] = b;
    to[k] = c;
    k = fill[b]++;
    from[k] = c;
    to[k] = a;
    k = fill[c]++;
    from[k] = a;
    to[k] = b;
    if (a === b || b === c || a === c) degenerate++;
    else {
      const ux = P[b * 3] - P[a * 3],
        uy = P[b * 3 + 1] - P[a * 3 + 1],
        uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3],
        vy = P[c * 3 + 1] - P[a * 3 + 1],
        vz = P[c * 3 + 2] - P[a * 3 + 2];
      const x = uy * vz - uz * vy,
        y = uz * vx - ux * vz,
        z = ux * vy - uy * vx;
      if (x * x + y * y + z * z < 1e-18) degenerate++;
    }
  }
  let edges = 0;
  let bad = 0;
  let flipped = 0;
  let badVertices = 0;
  for (let a = 0; a < V; a++) {
    const s = start[a];
    const e = start[a + 1];
    const n = e - s;
    // edges a – b with b > a, counted once: uses a → b (from) and b → a (to)
    for (let k = s; k < e; k++) {
      for (let side = 0; side < 2; side++) {
        const b = side === 0 ? from[k] : to[k];
        if (b <= a || (side === 1 && from[k] === b)) continue;
        let first = true;
        for (let q = s; q < k && first; q++) if (from[q] === b || to[q] === b) first = false;
        if (!first) continue;
        let out = 0;
        let inn = 0;
        for (let q = s; q < e; q++) {
          if (from[q] === b) out++;
          if (to[q] === b) inn++;
        }
        edges++;
        if (out + inn !== 2) bad++;
        else if (out !== 1) flipped++;
      }
    }
    // the link edges must form exactly one cycle through all n of them
    if (n < 3) {
      badVertices++;
      continue;
    }
    let cur = to[s];
    let steps = 1;
    let ok = true;
    while (cur !== from[s] && steps <= n) {
      let found = -1;
      for (let q = s; q < e; q++) {
        if (from[q] === cur) {
          if (found >= 0) ok = false;
          found = q;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      cur = to[found];
      steps++;
    }
    if (!ok || steps !== n) badVertices++;
  }
  return {
    edges,
    badEdges: bad,
    flippedEdges: flipped,
    degenerate,
    badVertices,
    manifold: bad === 0 && flipped === 0 && degenerate === 0 && badVertices === 0,
  };
}

/** Edge part of meshValidity, shaped like printability/sanity checkManifold. */
export function edgeManifold(m: TriMesh) {
  const { edges, badEdges, flippedEdges, degenerate } = meshValidity(m);
  return {
    edges,
    badEdges,
    flippedEdges,
    degenerate,
    manifold: badEdges === 0 && flippedEdges === 0 && degenerate === 0,
  };
}

/** Vertices whose triangles do not form one fan. */
export const nonManifoldVertices = (m: TriMesh) => meshValidity(m).badVertices;
