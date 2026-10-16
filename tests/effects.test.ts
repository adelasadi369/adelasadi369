import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { TEXTURE_PATTERNS, VaseParamsSchema, type VaseParamsInput } from '../src/core/params/schema';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import { slice } from './helpers';

const solidOk = (input: VaseParamsInput) => {
  const p = VaseParamsSchema.parse(input);
  const { mesh } = buildMesh(p, 'low');
  expect(checkManifold(mesh).manifold).toBe(true);
  expect(signedVolume(mesh)).toBeGreaterThan(0);
  for (let k = 1; k < 12; k++) {
    const s = slice(mesh, (p.dimensions.height * k) / 12 + 0.0137);
    expect(s.loops.length).toBe(1);
    expect(s.starShaped[0]).toBe(true);
  }
  return mesh;
};

describe('Phase 2 effects', () => {
  for (const pattern of TEXTURE_PATTERNS) {
    it(`texture ${pattern}: manifold, one star-shaped contour, seamless`, () => {
      const mesh = solidOk({ effects: [{ type: 'texture', pattern, depth: 1, repeats: 31 }] });
      if (pattern === 'basketweave') expect(mesh.nTheta % 32).toBe(0); // forced even
      // seam: column 0 and column nθ−1 must be neighbours of similar radius (no jump)
      const P = mesh.positions;
      const n = mesh.nTheta;
      for (const row of [Math.floor(mesh.nZ / 3), Math.floor(mesh.nZ / 2)]) {
        const r = (i: number) => Math.hypot(P[(row * n + i) * 3], P[(row * n + i) * 3 + 1]);
        const jump = Math.abs(r(0) - r(n - 1));
        let maxStep = 0;
        for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(r(i) - r(i - 1)));
        expect(jump).toBeLessThanOrEqual(maxStep + 1e-3);
      }
    });
  }

  it('steps: terraces with bevel, manifold and star-shaped', () => {
    const p = VaseParamsSchema.parse({ effects: [{ type: 'steps', count: 6, bevel: 60, fade: 0 }] });
    const mesh = solidOk(p);
    // inside a step (below the bevel) the radius at a fixed column is constant in z
    const { rows, nTheta: n, positions: P } = mesh;
    const H = p.dimensions.height;
    const inStep = [...rows.keys()].filter((j) => {
      const w = (rows[j] / H) * 6;
      return w - Math.floor(w) > 0.05 && w - Math.floor(w) < 0.35 && Math.floor(w) === 2;
    });
    const r = (j: number) => Math.hypot(P[j * n * 3], P[j * n * 3 + 1]);
    expect(inStep.length).toBeGreaterThan(2);
    for (const j of inStep) expect(r(j)).toBeCloseTo(r(inStep[0]), 4);
  });

  it('glitch: bands are deterministic and the mesh stays valid', () => {
    const input: VaseParamsInput = {
      section: { bottom: { shape: 'polygon', sides: 5 } },
      effects: [{ type: 'glitch', bands: 8, maxOffset: 3, maxShift: 12, seed: 9 }],
    };
    const a = solidOk(input);
    const b = buildMesh(VaseParamsSchema.parse(input), 'low').mesh;
    expect(Array.from(a.positions.slice(0, 3000))).toEqual(Array.from(b.positions.slice(0, 3000)));
  });

  it('texture + steps + glitch stack in shell mode is manifold', () => {
    const p = VaseParamsSchema.parse({
      print: { outputMode: 'shell' },
      effects: [
        { type: 'steps', count: 5, bevel: 70 },
        { type: 'texture', pattern: 'hammered', depth: 0.8, repeats: 40 },
        { type: 'glitch', bands: 5, maxOffset: 2 },
      ],
    });
    const { mesh } = buildMesh(p, 'low');
    expect(checkManifold(mesh).manifold).toBe(true);
  });
});
