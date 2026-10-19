/**
 * Marching-cubes case table, generated once instead of hand-typed.
 *
 * Corner c of a unit cube sits at (c & 1, c >> 1 & 1, c >> 2 & 1); bit c of a case index is set when that corner is
 * inside (field < 0). On every face the crossing edges are joined by segments that keep the inside corners apart
 * (the fixed rule for ambiguous faces). The rule only looks at the face's own corners, so two cubes sharing a face
 * always agree and the extracted surface has no cracks. The segments chain into loops (each crossing edge is an
 * exit on one of its faces and an entry on the other), and each loop becomes a triangle fan.
 *
 * A fan diagonal must never lie in a cube face: on an ambiguous face the neighbouring cube may draw the same
 * diagonal and the edge would be used four times. Each loop is therefore fanned from an apex none of whose
 * diagonals lies in a face; every one of the 256 cases has such an apex (checked when the table is built).
 */

/** The 12 cube edges as corner pairs: 4 along x, 4 along y, 4 along z. */
export const EDGES: readonly [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const corner = (c: number) => [c & 1, (c >> 1) & 1, (c >> 2) & 1];

function edgeOf(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return EDGES.findIndex(([p, q]) => p === lo && q === hi);
}

/** Faces as corner cycles, counter-clockwise seen from outside the cube. */
const FACES: number[][] = (() => {
  const raw: { axis: number; side: number; cyc: number[] }[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [0, 1]) {
      // the other two axes, walked around the square
      const [u, v] = [0, 1, 2].filter((a) => a !== axis);
      const cyc = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([a, b]) => (side << axis) | (a << u) | (b << v));
      raw.push({ axis, side, cyc });
    }
  }
  return raw.map(({ axis, side, cyc }) => {
    const [p, q, r] = cyc.map(corner);
    const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e2 = [r[0] - q[0], r[1] - q[1], r[2] - q[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const outward = side === 1 ? 1 : -1;
    return n[axis] * outward > 0 ? cyc : cyc.slice().reverse();
  });
})();

/** TRI_TABLE[case] = flat list of edge-index triples; TRI_COUNT[case] = number of triangles. */
export const TRI_TABLE: Int8Array[] = [];
export const TRI_COUNT = new Uint8Array(256);

/** True when edges a and b lie in a common cube face. */
function shareFace(a: number, b: number): boolean {
  const [a0, a1] = EDGES[a];
  const [b0, b1] = EDGES[b];
  return FACES.some((f) => f.includes(a0) && f.includes(a1) && f.includes(b0) && f.includes(b1));
}

function fan(loop: number[]): number[] {
  const n = loop.length;
  if (n === 3) return [loop[0], loop[2], loop[1]];
  for (let a = 0; a < n; a++) {
    let ok = true;
    for (let k = 2; k < n - 1 && ok; k++) if (shareFace(loop[a], loop[(a + k) % n])) ok = false;
    if (!ok) continue;
    const tris: number[] = [];
    for (let k = 1; k + 1 < n; k++) tris.push(loop[a], loop[(a + k + 1) % n], loop[(a + k) % n]);
    return tris;
  }
  throw new Error(`marching cubes: no face-safe fan apex for loop ${loop.join(',')}`);
}

for (let cs = 0; cs < 256; cs++) {
  const inside = (c: number) => ((cs >> c) & 1) === 1;
  const next = new Int8Array(12).fill(-1);
  for (const q of FACES) {
    for (let m = 0; m < 4; m++) {
      const a = q[m];
      const b = q[(m + 1) % 4];
      if (!inside(a) || inside(b)) continue; // not an exit (inside → outside walking counter-clockwise)
      // walk back to the entry that opened this run of inside corners
      let j = m;
      while (inside(q[(j + 3) % 4])) j = (j + 3) % 4;
      const entry = edgeOf(q[(j + 3) % 4], q[j]);
      next[edgeOf(a, b)] = entry;
    }
  }
  const tris: number[] = [];
  const seen = new Uint8Array(12);
  for (let e = 0; e < 12; e++) {
    if (next[e] < 0 || seen[e]) continue;
    const loop: number[] = [];
    for (let k = e; !seen[k]; k = next[k]) {
      seen[k] = 1;
      loop.push(k);
    }
    tris.push(...fan(loop));
  }
  TRI_TABLE.push(Int8Array.from(tris));
  TRI_COUNT[cs] = tris.length / 3;
}
