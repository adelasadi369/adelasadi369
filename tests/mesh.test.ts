import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { VaseParamsSchema, type VaseParamsInput } from '../src/core/params/schema';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';

const make = (p: VaseParamsInput) => VaseParamsSchema.parse(p);

const CASES: [string, VaseParamsInput][] = [
  ['default solid', {}],
  ['default shell', { print: { outputMode: 'shell' } }],
  ['shell flat rim, open bottom', { print: { outputMode: 'shell' }, rim: { round: false }, base: { bottomThickness: 0 } }],
  [
    'twisted hex shell with lip, foot, flare',
    {
      section: { bottom: { shape: 'polygon', sides: 6, cornerRadius: 3 } },
      twist: { total: 120, curve: 'easeInOut' },
      rim: { lipThickness: 1.5, flare: 4, flareZone: 12 },
      base: { footRing: { height: 6, inset: 3 }, chamfer: 1 },
      print: { outputMode: 'shell' },
    },
  ],
  [
    'star + ribs + waves + noise + bend',
    {
      section: { bottom: { shape: 'star', starPoints: 8, starInnerRatio: 0.78, aspectXY: 1.3 } },
      twist: { total: 90, lobes: { count: 3, depth: 10, swirl: 0.5 }, bend: { offset: 10, direction: 45 } },
      effects: [
        { type: 'ribs', count: 36, depth: 1.5, helixTurns: 1.5 },
        { type: 'waves', amplitude: 1, freqZ: 10 },
        { type: 'noise', amplitude: 1, start: 20, end: 80, fade: 0 },
      ],
    },
  ],
];

describe('mesh builder', () => {
  for (const [name, input] of CASES) {
    it(`${name}: manifold with outward winding`, () => {
      const { mesh } = buildMesh(make(input), 'low');
      const m = checkManifold(mesh);
      expect(m).toMatchObject({ badEdges: 0, flippedEdges: 0, degenerate: 0 });
      expect(signedVolume(mesh)).toBeGreaterThan(0);
    });
  }

  it('reaches the requested height exactly', () => {
    const { mesh } = buildMesh(make({ print: { outputMode: 'shell' } }), 'low');
    expect(mesh.height).toBeCloseTo(180, 3);
    const s = buildMesh(make({}), 'low').mesh;
    expect(s.height).toBeCloseTo(180, 3);
  });

  it('auto-raises Nθ to a multiple of the repetition count', () => {
    const { mesh } = buildMesh(make({ effects: [{ type: 'ribs', count: 60 }] }), 'low');
    expect(mesh.nTheta % 60).toBe(0);
    expect(mesh.nTheta).toBeGreaterThanOrEqual(480);
  });
});
