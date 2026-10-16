import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { normalizeParams } from '../src/core/params/normalize';
import { VaseParamsSchema } from '../src/core/params/schema';
import { evaluate } from '../src/core/printability';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import { PRESETS } from '../src/presets';
import { PRESET_SOURCES } from '../scripts/presets.src';
import { slice } from './helpers';

describe('presets', () => {
  it('has all 14 trend presets, in sync with their sources', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(PRESET_SOURCES.map((s) => s.id));
    expect(PRESETS).toHaveLength(14);
    for (const p of PRESETS) {
      const src = PRESET_SOURCES.find((s) => s.id === p.id)!;
      const regenerated = normalizeParams({ ...src.params, name: src.name.en });
      regenerated.effects.forEach((e, i) => (e.id = `${src.id}-${i}`));
      expect(p.params).toEqual(regenerated);
      expect(VaseParamsSchema.safeParse(p.params).success).toBe(true);
    }
  });

  for (const preset of PRESETS) {
    describe(preset.id, () => {
      it('is manifold in solid and shell mode', () => {
        for (const outputMode of ['solidVase', 'shell'] as const) {
          const p = { ...preset.params, print: { ...preset.params.print, outputMode } };
          const { mesh } = buildMesh(p, 'medium');
          expect(checkManifold(mesh)).toMatchObject({ manifold: true });
          expect(signedVolume(mesh)).toBeGreaterThan(0);
        }
      });

      it('scores ≥ 90 with no errors', () => {
        const { report } = evaluate(preset.params, 'medium');
        expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(report.score).toBeGreaterThanOrEqual(90);
      });

      it('slices to exactly one star-shaped contour per Z (vase mode)', () => {
        const p = { ...preset.params, print: { ...preset.params.print, outputMode: 'solidVase' as const } };
        const { mesh } = buildMesh(p, 'low');
        const H = p.dimensions.height;
        for (let k = 1; k < 25; k++) {
          const s = slice(mesh, (H * k) / 25 + 0.0137);
          expect(s.loops.length).toBe(1);
          expect(s.starShaped[0]).toBe(true);
        }
      });
    });
  }
});
