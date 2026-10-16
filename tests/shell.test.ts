import { describe, expect, it } from 'vitest';
import { buildMesh, SLIT_WIDTH } from '../src/core/geometry/mesh';
import { VaseParamsSchema, type VaseParamsInput } from '../src/core/params/schema';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import { slice } from './helpers';

const build = (input: VaseParamsInput, q: 'low' | 'medium' = 'low') => buildMesh(VaseParamsSchema.parse(input), q);
const ok = (input: VaseParamsInput) => {
  const b = build(input);
  const m = checkManifold(b.mesh);
  expect(m).toMatchObject({ badEdges: 0, flippedEdges: 0, degenerate: 0 });
  expect(signedVolume(b.mesh)).toBeGreaterThan(0);
  return b;
};

const shell = { print: { outputMode: 'shell' as const } };

describe('shell rim & base features', () => {
  it.each<[string, VaseParamsInput]>([
    ['ruffle', { ...shell, rim: { ruffle: { count: 8, depth: 6 } } }],
    ['slanted cut', { ...shell, rim: { slant: { height: 25, angle: 30 } } }],
    ['ruffle + slant + flat rim', { ...shell, rim: { round: false, ruffle: { count: 5, depth: 4 }, slant: { height: 12 } } }],
    ['concave base', { ...shell, base: { concave: 2.5, bottomThickness: 2 } }],
    ['drainage hole', { ...shell, base: { drainageHole: 12 } }],
    ['concave + drainage', { ...shell, base: { concave: 2, drainageHole: 10 } }],
    ['follow liner with ribs', { print: { outputMode: 'shell', innerSurface: 'follow' }, effects: [{ type: 'ribs', count: 30, depth: 2 }] }],
    ['twisted hex + all base features', { ...shell, section: { bottom: { shape: 'polygon', sides: 6 } }, twist: { total: 90 }, base: { concave: 1.5, drainageHole: 8, footRing: { height: 5, inset: 2 } }, rim: { ruffle: { count: 6, depth: 5 } } }],
  ])('%s is manifold with outward winding', (_n, input) => {
    ok(input);
  });

  it('ruffle/slant lower the rim per column; max height stays H', () => {
    const { mesh } = ok({ ...shell, rim: { slant: { height: 30, angle: 0 }, round: false } });
    expect(mesh.height).toBeCloseTo(180, 1);
    const outer = mesh.surfaces.find((s) => s.kind === 'outer')!;
    const top = outer.firstVertex + (outer.rows - 1) * outer.cols;
    let mn = Infinity;
    for (let i = 0; i < outer.cols; i++) mn = Math.min(mn, mesh.positions[(top + i) * 3 + 2]);
    expect(mn).toBeCloseTo(150, 0);
  });

  it('drainage hole is a through-hole (slice under the floor has two contours)', () => {
    const { mesh } = ok({ ...shell, base: { drainageHole: 14, bottomThickness: 3 } });
    expect(slice(mesh, 1.5).loops).toHaveLength(2);
    expect(slice(mesh, 60).loops).toHaveLength(2); // outer + inner wall above the floor
  });

  it('follow liner keeps at least the wall thickness everywhere', () => {
    const { mesh } = ok({ print: { outputMode: 'shell', innerSurface: 'follow', wallThickness: 2.1 }, effects: [{ type: 'ribs', count: 24, depth: 3, profile: 'V' }] });
    const outer = mesh.surfaces.find((s) => s.kind === 'outer')!;
    const inner = mesh.surfaces.find((s) => s.kind === 'inner')!;
    const P = mesh.positions;
    // sample inner vertices in the middle; distance to every outer vertex in the same band ≥ wall − tolerance
    const j = Math.floor(inner.rows / 2);
    let minD = Infinity;
    for (let i = 0; i < inner.cols; i += 3) {
      const v = inner.firstVertex + j * inner.cols + i;
      const z = P[v * 3 + 2];
      for (let k = outer.firstVertex; k < outer.firstVertex + outer.rows * outer.cols; k++) {
        if (Math.abs(P[k * 3 + 2] - z) > 3) continue;
        minD = Math.min(minD, Math.hypot(P[v * 3] - P[k * 3], P[v * 3 + 1] - P[k * 3 + 1], P[v * 3 + 2] - P[k * 3 + 2]));
      }
    }
    expect(minD).toBeGreaterThan(2.1 * 0.93);
  });
});

describe('double-wall vase mode', () => {
  it.each([true, false])('is manifold (round rim %s) and slices to ONE contour above the floor', (round) => {
    const { mesh } = ok({ print: { outputMode: 'doubleWallVase', wallThickness: 2.8 }, rim: { round }, base: { bottomThickness: 1.2 } });
    for (const z of [0.6, 30, 90, 170]) expect(slice(mesh, z).loops).toHaveLength(1);
    // the slit is SLIT_WIDTH wide
    const outer = mesh.surfaces.find((s) => s.kind === 'outer')!;
    const j = outer.rows - 5;
    const a = outer.firstVertex + j * outer.cols;
    const b = a + outer.cols - 1;
    const P = mesh.positions;
    const gap = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1]);
    expect(gap).toBeGreaterThan(SLIT_WIDTH * 0.5);
    expect(gap).toBeLessThan(SLIT_WIDTH * 2);
  });
});

describe('saucer', () => {
  it('is a separate manifold body that clears the base by the gap', () => {
    const b = build({ base: { saucer: { enabled: true, gap: 3, height: 15, rim: 2 } } });
    expect(b.saucer).toBeDefined();
    const s = b.saucer!;
    expect(checkManifold(s).manifold).toBe(true);
    expect(signedVolume(s)).toBeGreaterThan(0);
    expect(s.height).toBeCloseTo(15, 3);
    // inner floor ring radius ≥ vase base radius + gap
    const inner = s.surfaces.find((x) => x.kind === 'inner')!;
    const last = inner.firstVertex + (inner.rows - 1) * inner.cols;
    let mn = Infinity;
    for (let i = 0; i < inner.cols; i++) mn = Math.min(mn, Math.hypot(s.positions[(last + i) * 3], s.positions[(last + i) * 3 + 1]));
    expect(mn).toBeGreaterThan(40 - 1 + 3 - 0.01); // base Ø80 minus chamfer, + gap
  });
});
