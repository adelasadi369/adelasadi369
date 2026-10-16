import type { VaseMesh } from '../geometry/mesh';

export interface ManifoldResult {
  edges: number;
  /** Edges not shared by exactly two triangles. */
  badEdges: number;
  /** Edges whose two uses have the same direction (inconsistent winding). */
  flippedEdges: number;
  degenerate: number;
  manifold: boolean;
}

/** Every (welded) edge must be used exactly twice, in opposite directions. O(E log E). */
export function checkManifold(
  mesh: Pick<VaseMesh, 'indices' | 'canonical' | 'positions' | 'triangleCount'>,
): ManifoldResult {
  const { indices, canonical, positions, triangleCount } = mesh;
  const nE = triangleCount * 3;
  const keys = new Float64Array(nE);
  const V = canonical.length;
  let degenerate = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = canonical[indices[t * 3]];
    const b = canonical[indices[t * 3 + 1]];
    const c = canonical[indices[t * 3 + 2]];
    if (a === b || b === c || c === a) degenerate++;
    else {
      const ax = positions[a * 3],
        ay = positions[a * 3 + 1],
        az = positions[a * 3 + 2];
      const ux = positions[b * 3] - ax,
        uy = positions[b * 3 + 1] - ay,
        uz = positions[b * 3 + 2] - az;
      const vx = positions[c * 3] - ax,
        vy = positions[c * 3 + 1] - ay,
        vz = positions[c * 3 + 2] - az;
      const cx = uy * vz - uz * vy,
        cy = uz * vx - ux * vz,
        cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz < 1e-18) degenerate++;
    }
    const tri = [a, b, c];
    for (let e = 0; e < 3; e++) {
      const p = tri[e];
      const q = tri[(e + 1) % 3];
      // encode undirected key * 2 + direction bit
      const lo = p < q ? p : q;
      const hi = p < q ? q : p;
      keys[t * 3 + e] = (lo * V + hi) * 2 + (p < q ? 0 : 1);
    }
  }
  keys.sort();
  let edges = 0;
  let bad = 0;
  let flipped = 0;
  let i = 0;
  while (i < nE) {
    const k = Math.floor(keys[i] / 2);
    let j = i;
    let dirs = 0;
    while (j < nE && Math.floor(keys[j] / 2) === k) {
      dirs += keys[j] % 2;
      j++;
    }
    const n = j - i;
    edges++;
    if (n !== 2) bad++;
    else if (dirs !== 1) flipped++;
    i = j;
  }
  return {
    edges,
    badEdges: bad,
    flippedEdges: flipped,
    degenerate,
    manifold: bad === 0 && flipped === 0 && degenerate === 0,
  };
}

/** Signed volume (mm³); positive for outward-facing winding. */
export function signedVolume(mesh: Pick<VaseMesh, 'indices' | 'positions' | 'triangleCount'>): number {
  const { indices: I, positions: P, triangleCount } = mesh;
  let v = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = I[t * 3] * 3,
      b = I[t * 3 + 1] * 3,
      c = I[t * 3 + 2] * 3;
    v +=
      P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}
