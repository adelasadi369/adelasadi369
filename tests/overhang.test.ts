import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { analyzeOverhang } from '../src/core/printability/overhang';
import { VaseParamsSchema } from '../src/core/params/schema';

// Straight taper: rb − rt = H ⇒ wall at exactly 45° from vertical.
const cone = (outputMode: 'solidVase' | 'shell', inward: boolean) =>
  VaseParamsSchema.parse({
    dimensions: inward
      ? { height: 60, baseDiameter: 160, topDiameter: 40 }
      : { height: 60, baseDiameter: 40, topDiameter: 160, maxDiameter: 160 },
    profile: { preset: 'taper' },
    base: { chamfer: 0 },
    rim: { round: false },
    print: { outputMode },
  });

describe('overhang', () => {
  it('analytic 45° cone reports 45° ± 0.5 (vase mode, inward lean)', () => {
    const { mesh } = buildMesh(cone('solidVase', true), 'medium');
    const o = analyzeOverhang(mesh, 45);
    expect(o.summary.maxDeg).toBeGreaterThan(44.5);
    expect(o.summary.maxDeg).toBeLessThan(45.5);
    expect(o.summary.redFraction).toBe(0);
    // per-vertex values on the outer wall agree
    let mx = 0;
    for (let v = 0; v < mesh.nTheta * mesh.nZ; v++) mx = Math.max(mx, o.vertex[v]);
    expect(mx).toBeCloseTo(45, 0);
  });

  it('outward 45° cone in shell mode reports 45° on the outer wall', () => {
    const { mesh } = buildMesh(cone('shell', false), 'medium');
    const o = analyzeOverhang(mesh, 45);
    expect(Math.abs(o.summary.maxDeg - 45)).toBeLessThan(0.5);
  });

  it('inward lean does not count in shell mode on the outer wall', () => {
    const { mesh } = buildMesh(cone('shell', true), 'medium');
    const o = analyzeOverhang(mesh, 45);
    // inner wall of an inward cone faces down → counted; outer faces up → not
    expect(o.summary.maxDeg).toBeLessThan(45.6);
  });
});
