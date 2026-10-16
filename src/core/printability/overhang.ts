import type { VaseMesh } from '../geometry/mesh';
import type { OverhangSummary } from './types';

export const BANDS = 50;
const RAD2DEG = 180 / Math.PI;

/**
 * α = asin(|n_z|) from vertical. Vase modes: outer wall, both lean directions count.
 * Shell: outer and inner walls where the face points downward (n_z < 0).
 */
export function analyzeOverhang(mesh: VaseMesh, maxDeg: number): { summary: OverhangSummary; vertex: Float32Array } {
  const vase = mesh.mode === 'solidVase';
  const kinds = vase ? ['outer'] : ['outer', 'inner'];
  const P = mesh.positions;
  const I = mesh.indices;
  const H = mesh.height || 1;
  const tol = 0.5;
  const sinYellow = Math.sin(((maxDeg + tol) * Math.PI) / 180);
  const sinRed = Math.sin(((maxDeg + 10 + tol) * Math.PI) / 180);
  let maxNz = 0;
  const area = new Float64Array(BANDS);
  const red = new Float64Array(BANDS);
  const yellow = new Float64Array(BANDS);
  let total = 0;
  let totRed = 0;
  let totYellow = 0;

  for (const s of mesh.surfaces) {
    if (!kinds.includes(s.kind)) continue;
    for (let t = s.firstTri; t < s.firstTri + s.triCount; t++) {
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
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l === 0) continue;
      const ar = l / 2;
      const zc = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      let band = Math.floor((zc / H) * BANDS);
      if (band >= BANDS) band = BANDS - 1;
      if (band < 0) band = 0;
      area[band] += ar;
      total += ar;
      const nzn = nz / l;
      if (!vase && nzn >= 0) continue;
      const anz = nzn < 0 ? -nzn : nzn;
      if (anz > maxNz) maxNz = anz;
      if (anz > sinRed) {
        red[band] += ar;
        totRed += ar;
      } else if (anz > sinYellow) {
        yellow[band] += ar;
        totYellow += ar;
      }
    }
  }

  const vertex = new Float32Array(mesh.vertexCount).fill(-1);
  const N = mesh.normals;
  for (const s of mesh.surfaces) {
    if (!kinds.includes(s.kind)) continue;
    const end = s.firstVertex + s.rows * mesh.nTheta;
    for (let v = s.firstVertex; v < end; v++) {
      const nz = N[v * 3 + 2];
      vertex[v] = !vase && nz >= 0 ? 0 : Math.asin(Math.min(1, Math.abs(nz))) * RAD2DEG;
    }
  }

  const bandsRed = new Float32Array(BANDS);
  const bandsYellow = new Float32Array(BANDS);
  for (let b = 0; b < BANDS; b++) {
    bandsRed[b] = area[b] > 0 ? red[b] / area[b] : 0;
    bandsYellow[b] = area[b] > 0 ? yellow[b] / area[b] : 0;
  }
  return {
    summary: {
      maxDeg: Math.asin(Math.min(1, maxNz)) * RAD2DEG,
      redFraction: total ? totRed / total : 0,
      yellowFraction: total ? totYellow / total : 0,
      bandsRed,
      bandsYellow,
    },
    vertex,
  };
}
