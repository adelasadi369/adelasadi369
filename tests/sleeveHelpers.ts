import { expect } from 'vitest';
import { normalizeParams } from '../src/core/params/normalize';
import type { VaseParams, VaseParamsInput } from '../src/core/params/schema';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import type { SleeveBuild } from '../src/core/sleeve';

export const sleeveParams = (base: VaseParamsInput | VaseParams = {}, insert: object = {}): VaseParams =>
  normalizeParams({
    ...base,
    print: { ...(base.print ?? {}), outputMode: 'sleeve' },
    insert: { ...(base.insert ?? {}), od: 40, ...insert },
  });

/** Validity from the builder, cross-checked with the independent sorting check. */
export function expectSoundSleeve(b: SleeveBuild, label = '') {
  const s = b.mesh.sleeve;
  expect(s.validity, label).toMatchObject({
    ok: true,
    badEdges: 0,
    flippedEdges: 0,
    degenerate: 0,
    badVertices: 0,
    bodies: 1,
  });
  expect(checkManifold(b.mesh).manifold, label).toBe(true);
  expect(signedVolume(b.mesh), label).toBeGreaterThan(0);
}

/** Open share of the side seen along radial rays through the composed SDF (80 × 50 grid in (φ, z), below the rim). */
export function rayCoverage(b: SleeveBuild): number {
  const f = b.sdf;
  let open = 0;
  let tot = 0;
  for (let a = 0; a < 80; a++)
    for (let k = 0; k < 50; k++) {
      const phi = ((a + 0.5) / 80) * 2 * Math.PI;
      const z = ((k + 0.5) / 50) * f.H;
      if (z >= f.top.at(phi)) continue;
      tot++;
      let hit = false;
      for (let r = f.R + 0.05; r < f.reach + 1 && !hit; r += 0.25)
        hit = f.at(r * Math.cos(phi), r * Math.sin(phi), z) < 0;
      if (!hit) open++;
    }
  return open / tot;
}

/**
 * Hole roofs from face normals: downward faces within 2 mm of a hole edge (g on the hole map), off the bore. Faces
 * in a tip zone (the hole, or the material ∨ between two merged roofs, narrower than 2·dTip at that height) are left
 * out: a rounded tip has a tiny flat patch by construction. Returns the area share steeper than maxOverhang + 3°.
 */
export function roofOverhang(b: SleeveBuild, p: VaseParams): { badFraction: number; area: number } {
  const { mesh, sdf } = b;
  const hm = sdf.holes!;
  const P = mesh.positions;
  const I = mesh.indices;
  const rOut = Math.max(sdf.skin.reach, sdf.Rc);
  const dTip = Math.max(1.5 * mesh.sleeve.voxel, hm.k + 1.5);
  const tip = (phi: number, z: number) => {
    const nx = hm.nx;
    const i = Math.round(((((phi / (2 * Math.PI)) % 1) + 1) % 1) * nx) % nx;
    const row = Math.min(hm.nz - 1, Math.max(0, Math.round(z / hm.dz))) * nx;
    const o = hm.open[row + i];
    let a = 0;
    let c = 0;
    while (a < nx && hm.open[row + ((i - a - 1 + nx) % nx)] === o) a++;
    while (c < nx && hm.open[row + ((i + c + 1) % nx)] === o) c++;
    return (a + c + 1) * hm.dphi * rOut < 2 * dTip;
  };
  let area = 0;
  let bad = 0;
  for (let t = 0; t < mesh.surfaces[0].triCount; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3; // prettier-ignore
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2]; // prettier-ignore
    const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2]; // prettier-ignore
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // prettier-ignore
    const L = Math.hypot(nx, ny, nz);
    if (!L || nz >= 0) continue;
    const x = (P[a] + P[c] + P[d]) / 3, y = (P[a + 1] + P[c + 1] + P[d + 1]) / 3, z = (P[a + 2] + P[c + 2] + P[d + 2]) / 3; // prettier-ignore
    const phi = Math.atan2(y, x);
    if (Math.hypot(x, y) < sdf.R + 0.3 || Math.abs(hm.at(phi, z)) > 2 || tip(phi, z)) continue;
    const A = L / 2;
    area += A;
    if ((Math.asin(-nz / L) * 180) / Math.PI > p.print.maxOverhang + 3) bad += A;
  }
  return { badFraction: area ? bad / area : 0, area };
}
