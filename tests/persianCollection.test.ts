import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { designSystemPrompt } from '../src/ai/prompts';
import { compileField } from '../src/core/geometry/field';
import { encodeShapes } from '../src/core/motif/blob';
import { buildMotifMap } from '../src/core/motif/map';
import { normalizeParams } from '../src/core/params/normalize';
import { PERSIAN_FORMS } from '../src/core/persian/silhouettes';
import { analyze, buildDesign } from '../src/core/printability';
import { checkManifold } from '../src/core/printability/sanity';
import { PERSIAN_PRESETS, PRESETS, VASE_PRESETS } from '../src/presets';
import { shapedGlyphs, textOutline } from '../src/text/outline';
import golden from './golden/vase-presets.json';
import { expectSoundSleeve } from './sleeveHelpers';

const font = opentype.parse(
  readFileSync(join(import.meta.dirname, '..', 'public', 'fonts', 'Vazirmatn-Regular.ttf')).buffer,
);

describe('Persian text (Vazirmatn, shaped)', () => {
  it('joins letters: contextual forms and the lam-alef ligature', () => {
    // سلام: seen initial (FEB3), lam-alef final ligature (FEFC), meem isolated (after alef); laid out visually
    expect(shapedGlyphs(font, 'سلام')).toEqual(['uni0645', 'uniFEFC', 'uniFEB3']);
    // گل: gaf initial, lam final
    const g = shapedGlyphs(font, 'گل');
    expect(g).toContain('uniFB94');
    expect(g.some((n) => n.startsWith('uniFEDE') || n === 'uniFEDE')).toBe(true);
  });

  it('outlines go into the same motif pipeline (single placement, relief map)', () => {
    const polys = textOutline(font, 'گلاب');
    expect(polys.length).toBeGreaterThan(2);
    const enc = encodeShapes(polys);
    expect(enc.ok).toBe(true);
    if (!enc.ok) return;
    const p = normalizeParams({
      ...PRESETS[2].params,
      motif: {
        source: 'text',
        placement: 'single',
        size: 60,
        height: 50,
        text: { value: 'گلاب', data: enc.data, hash: enc.hash, points: enc.points },
      },
      effects: [{ type: 'motif', relief: 'engraved', depth: 0.8, softness: 0.4 }],
    });
    const map = buildMotifMap(p, p.dimensions.height, 50)!;
    expect(map.d.reduce((a, b) => Math.min(a, b), 0)).toBeLessThan(0);
    expect(checkManifold(buildDesign(p, 'low').mesh).manifold).toBe(true);
  });
});

describe('muqarnas collar', () => {
  const base = PERSIAN_PRESETS.find((p) => p.id === 'vase-muqarnas')!.params;
  const fx = (over: object = {}) => {
    const p = normalizeParams({ ...base, effects: [{ ...base.effects[0], ...over }] });
    return { p, f: compileField(p) };
  };
  const radius = (f: ReturnType<typeof compileField>, theta: number, z: number) => {
    const r = f.row(z);
    return f.outerRaw(theta - r.twist, Math.cos(theta - r.twist), Math.sin(theta - r.twist), r);
  };

  it('stays inside its band; niches recess, walls between them do not; tiers shift by half a cell', () => {
    const { p, f } = fx();
    const e = p.effects[0] as Extract<(typeof p.effects)[number], { type: 'muqarnas' }>;
    const H = p.dimensions.height;
    const z0 = H - e.tiers * e.tierHeight;
    const R0 = radius(f, 0, z0 - 5);
    // below the band: the plain body
    expect(radius(f, 0.3, z0 - 5)).toBeCloseTo(R0, 6);
    const cell = (2 * Math.PI) / e.cells;
    const mid = z0 + 0.4 * e.tierHeight;
    // tier 0: niche centred at half a cell, wall at the cell boundary; tier 1 swaps them
    expect(radius(f, cell / 2, mid)).toBeLessThan(radius(f, 0, mid) - 1);
    const mid1 = mid + e.tierHeight;
    expect(radius(f, 0, mid1)).toBeLessThan(radius(f, cell / 2, mid1) - 1);
  });

  it('corbels outward no steeper than maxOverhang − 5° and prints without red overhang', () => {
    const { p, f } = fx({ corbel: 6, tierHeight: 8 });
    const e = p.effects[0] as Extract<(typeof p.effects)[number], { type: 'muqarnas' }>;
    const H = p.dimensions.height;
    const z0 = H - e.tiers * e.tierHeight;
    const wall = 0;
    const rise = radius(f, wall, H - 0.01) - radius(f, wall, z0);
    expect(rise / (H - z0)).toBeLessThanOrEqual(Math.tan(((p.print.maxOverhang - 5) * Math.PI) / 180) + 1e-6);
    const b = buildDesign(base, 'medium');
    const r = analyze(b, base);
    expect(r.issues.filter((i) => i.id.startsWith('overhang-red'))).toEqual([]);
    expect(checkManifold(b.mesh).manifold).toBe(true);
  });
});

describe('Persian vessel forms (inspired by)', () => {
  it.each(PERSIAN_FORMS.map((f) => [f.id, f] as const))(
    '%s: valid editable profile that prints as a vase',
    (_id, f) => {
      expect(f.points.length).toBeLessThanOrEqual(12);
      expect(f.points[0].t).toBe(0);
      expect(f.points[f.points.length - 1].t).toBe(100);
      expect(f.name.en).toContain('inspired by');
      const p = normalizeParams({
        dimensions: { height: f.height, maxDiameter: f.maxDiameter },
        profile: { preset: 'custom', controlPoints: f.points.map((q) => ({ ...q, sharp: false })) },
      });
      expect(p.profile.controlPoints).toHaveLength(f.points.length);
      const b = buildDesign(p, 'low');
      expect(checkManifold(b.mesh).manifold).toBe(true);
      const ids = analyze(b, p).issues.map((i) => i.id);
      expect(ids.filter((i) => i.startsWith('overhang-red') || i.startsWith('bounds'))).toEqual([]);
    },
  );
});

describe('Persian collection presets', () => {
  it('has the five presets, bilingual, kept out of the golden vase set', () => {
    expect(PERSIAN_PRESETS.map((p) => p.id).sort()).toEqual(
      ['sleeve-girih', 'sleeve-kashi', 'sleeve-khatam', 'vase-golabpash', 'vase-muqarnas'].sort(),
    );
    for (const p of PERSIAN_PRESETS) {
      expect(p.name.fa.length).toBeGreaterThan(2);
      expect(VASE_PRESETS).not.toContain(p);
    }
    expect(Object.keys(golden.presets)).toHaveLength(14);
  });

  it.each(PERSIAN_PRESETS.map((p) => p.id))('%s: manifold, score ≥ 90, bore pass for sleeves', (id) => {
    const p = PERSIAN_PRESETS.find((x) => x.id === id)!.params;
    const b = buildDesign(p, p.render.previewQuality);
    const r = analyze(b, p);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    if ('sdf' in b) {
      expectSoundSleeve(b, id);
      expect(r.issues.map((i) => i.id)).toContain('bore-ok');
    } else expect(checkManifold(b.mesh).manifold).toBe(true);
  });

  it('the AI prompt knows the collection and the blob rule', () => {
    const s = designSystemPrompt(PRESETS);
    expect(s).toContain('sleeve-girih');
    expect(s).toContain('Persian pattern girih10');
    expect(s).toContain('Never write motif.svg');
    expect(s).toContain('motif.persian.preset');
    expect(s).not.toContain('motif.svg.data |');
  });
});
