import type { Surface, VaseMesh } from '../geometry/mesh';

export function surfaceOf(mesh: VaseMesh, kind: Surface['kind']): Surface | undefined {
  return mesh.surfaces.find((s) => s.kind === kind);
}

/** Shoelace area and perimeter of ring r of a grid surface. */
export function ringMetrics(mesh: VaseMesh, s: Surface, r: number) {
  const P = mesh.positions;
  const n = mesh.nTheta;
  const o = s.firstVertex + r * n;
  let area = 0;
  let per = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const a = (o + i) * 3;
    const b = (o + ((i + 1) % n)) * 3;
    const cr = P[a] * P[b + 1] - P[b] * P[a + 1];
    area += cr;
    cx += (P[a] + P[b]) * cr;
    cy += (P[a + 1] + P[b + 1]) * cr;
    const ex = P[b] - P[a];
    const ey = P[b + 1] - P[a + 1];
    per += Math.sqrt(ex * ex + ey * ey);
  }
  area /= 2;
  return { area: Math.abs(area), perimeter: per, cx: cx / (6 * area), cy: cy / (6 * area), z: P[o * 3 + 2] };
}

export function surfaceArea(mesh: VaseMesh, s: Surface): number {
  const P = mesh.positions;
  const I = mesh.indices;
  let A = 0;
  for (let t = s.firstTri; t < s.firstTri + s.triCount; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    A += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return A;
}

/** Area-weighted centroid of a surface's triangles. */
export function surfaceCentroid(mesh: VaseMesh, s: Surface): { area: number; x: number; y: number; z: number } {
  const P = mesh.positions;
  const I = mesh.indices;
  let A = 0, x = 0, y = 0, z = 0;
  for (let t = s.firstTri; t < s.firstTri + s.triCount; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const qx = uy * vz - uz * vy, qy = uz * vx - ux * vz, qz = ux * vy - uy * vx;
    const ar = Math.sqrt(qx * qx + qy * qy + qz * qz) / 2;
    A += ar;
    x += (ar * (P[a] + P[b] + P[c])) / 3;
    y += (ar * (P[a + 1] + P[b + 1] + P[c + 1])) / 3;
    z += (ar * (P[a + 2] + P[b + 2] + P[c + 2])) / 3;
  }
  return { area: A, x: x / A, y: y / A, z: z / A };
}

/** Volume and centroid of the closed mesh (signed tetrahedra). */
export function volumeCentroid(mesh: VaseMesh): { volume: number; x: number; y: number; z: number } {
  const P = mesh.positions;
  const I = mesh.indices;
  let V = 0, x = 0, y = 0, z = 0;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const v =
      (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
        P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
        P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
      6;
    V += v;
    x += (v * (P[a] + P[b] + P[c])) / 4;
    y += (v * (P[a + 1] + P[b + 1] + P[c + 1])) / 4;
    z += (v * (P[a + 2] + P[b + 2] + P[c + 2])) / 4;
  }
  return { volume: V, x: x / V, y: y / V, z: z / V };
}

export function bbox(mesh: VaseMesh) {
  const P = mesh.positions;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < x0) x0 = P[i];
    if (P[i] > x1) x1 = P[i];
    if (P[i + 1] < y0) y0 = P[i + 1];
    if (P[i + 1] > y1) y1 = P[i + 1];
  }
  return { x0, x1, y0, y1, sx: x1 - x0, sy: y1 - y0 };
}

/** Distance from (cx,cy) to the ring boundary along direction (dx,dy) (ring star-shaped about c). */
export function rayToRing(mesh: VaseMesh, s: Surface, r: number, cx: number, cy: number, dx: number, dy: number) {
  const P = mesh.positions;
  const n = mesh.nTheta;
  const o = s.firstVertex + r * n;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = (o + i) * 3;
    const b = (o + ((i + 1) % n)) * 3;
    const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1];
    const wx = P[a] - cx, wy = P[a + 1] - cy;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const tRay = (wx * ey - wy * ex) / den;
    const u = (wx * dy - wy * dx) / den;
    if (tRay >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && tRay < best) best = tRay;
  }
  return best;
}
