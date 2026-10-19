import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { normalizeParams } from '../src/core/params/normalize';
import { VaseParamsSchema } from '../src/core/params/schema';
import { evaluate } from '../src/core/printability';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import { analyze } from '../src/core/printability';
import { measureSleeveBore } from '../src/core/printability/sleeve';
import { buildSleeveMesh } from '../src/core/sleeve';
import { PRESETS, SLEEVE_PRESETS, VASE_PRESETS } from '../src/presets';
import { PRESET_SOURCES } from '../scripts/presets.src';
import { slice } from './helpers';

describe('presets', () => {
  it('has the 14 trend presets and the sleeve starter, in sync with their sources', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(PRESET_SOURCES.map((s) => s.id));
    expect(VASE_PRESETS).toHaveLength(14);
    expect(SLEEVE_PRESETS.map((p) => p.id)).toEqual(['sleeve-starter']);
    for (const p of PRESETS) {
      const src = PRESET_SOURCES.find((s) => s.id === p.id)!;
      const regenerated = normalizeParams({ ...src.params, name: src.name.en });
      regenerated.effects.forEach((e, i) => (e.id = `${src.id}-${i}`));
      expect(p.params).toEqual(regenerated);
      expect(VaseParamsSchema.safeParse(p.params).success).toBe(true);
    }
  });

  for (const preset of VASE_PRESETS) {
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

  for (const preset of SLEEVE_PRESETS) {
    describe(preset.id, () => {
      it('is manifold, passes the bore check and scores ≥ 90 at the preview voxel', () => {
        const p = preset.params;
        const b = buildSleeveMesh(p, p.sleeve.mesh.previewVoxel);
        expect(b.mesh.sleeve.validity.ok).toBe(true);
        expect(checkManifold(b.mesh)).toMatchObject({ manifold: true });
        expect(measureSleeveBore(b).deviation).toBeLessThanOrEqual(0.05);
        const report = analyze(b, p);
        expect(report.issues.map((i) => i.id)).toContain('bore-ok');
        expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(report.score).toBeGreaterThanOrEqual(90);
      });
    });
  }
});
