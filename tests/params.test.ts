import { describe, expect, it } from 'vitest';
import { clampToSchema } from '../src/core/params/clamp';
import { normalizeParams } from '../src/core/params/normalize';
import { diffParams, getPath, setPath } from '../src/core/params/paths';
import { migrateParams } from '../src/core/params/migrate';
import { DEFAULT_PARAMS, SCHEMA_VERSION, VaseParamsSchema, paramsJsonSchema } from '../src/core/params/schema';

describe('schema', () => {
  it('fills every default from {}', () => {
    expect(DEFAULT_PARAMS.dimensions.height).toBe(180);
    expect(DEFAULT_PARAMS.print.outputMode).toBe('solidVase');
    expect(DEFAULT_PARAMS.section.top.shape).toBe('circle');
  });

  it.each([
    ['height too big', { dimensions: { height: 301 } }],
    ['height too small', { dimensions: { height: 39 } }],
    ['twist out of range', { twist: { total: 800 } }],
    ['non-integer sides', { section: { bottom: { sides: 6.5 } } }],
    ['unknown enum', { profile: { preset: 'banana' } }],
    ['too many ribs', { effects: [{ type: 'ribs', count: 241 }] }],
    ['window inverted', { effects: [{ type: 'waves', start: 60, end: 50 }] }],
    ['neck below belly', { dimensions: { bellyPosition: 70, neckPosition: 60 } }],
    ['lobe depth > 30 %', { twist: { lobes: { depth: 31 } } }],
  ])('rejects %s', (_n, input) => {
    expect(VaseParamsSchema.safeParse(input).success).toBe(false);
  });

  it('exports a JSON schema for the AI module', () => {
    const js = paramsJsonSchema() as { properties: Record<string, unknown> };
    expect(Object.keys(js.properties)).toContain('effects');
  });
});

describe('clamp + normalize', () => {
  it('clamps numbers and drops bad enums', () => {
    const c = clampToSchema(VaseParamsSchema, {
      dimensions: { height: 999, baseDiameter: -5 },
      profile: { preset: 'banana' },
      section: { bottom: { sides: 6.6 } },
      bogus: 1,
    }) as Record<string, Record<string, unknown>>;
    expect(c.dimensions.height).toBe(300);
    expect(c.dimensions.baseDiameter).toBe(30);
    expect(c.profile.preset).toBeUndefined();
    expect((c.section.bottom as Record<string, unknown>).sides).toBe(7);
    expect(c.bogus).toBeUndefined();
  });

  it('normalizes arbitrary input into valid params', () => {
    const p = normalizeParams({
      dimensions: { bellyPosition: 70, neckPosition: 60, height: 1e9 },
      effects: [{ type: 'ribs', start: 60, end: 50, fade: 40 }, { type: 'nope' }],
    });
    expect(VaseParamsSchema.safeParse(p).success).toBe(true);
    expect(p.dimensions.neckPosition).toBeGreaterThan(p.dimensions.bellyPosition);
    expect(p.effects).toHaveLength(1);
    expect(p.effects[0].id).toBeTruthy();
  });

  it('snaps the shell wall to line-width multiples', () => {
    const p = normalizeParams({ print: { wallThickness: 2, lineWidth: 0.7 } });
    expect(p.print.wallThickness).toBeCloseTo(2.1);
  });
});

describe('paths', () => {
  it('get/set/diff', () => {
    const a = DEFAULT_PARAMS;
    const b = setPath(a, 'dimensions.height', 150);
    expect(getPath(b, 'dimensions.height')).toBe(150);
    expect(a.dimensions.height).toBe(180);
    expect(b.profile).toBe(a.profile);
    expect(diffParams(a, b)).toEqual([{ path: 'dimensions.height', from: 180, to: 150 }]);
  });
});

import { PARAMS, paramInfo } from '../src/core/params/meta';
import { mutate, randomize } from '../src/core/params/random';
import { decodeShare, encodeShare } from '../src/core/params/share';
import { PRESETS } from '../src/presets';

describe('meta', () => {
  it('lists every parameter with fa/en labels', () => {
    expect(PARAMS.length).toBeGreaterThan(60);
    for (const p of PARAMS) {
      expect(p.meta.label.fa.length).toBeGreaterThan(0);
      expect(p.meta.label.en.length).toBeGreaterThan(0);
    }
    expect(paramInfo('effects.0.depth', 'ribs')?.meta.max).toBe(15);
  });
});

describe('randomness', () => {
  const base = PRESETS[0].params;
  it('randomize is deterministic per seed and respects locks', () => {
    const locked = { ...base, random: { ...base.random, seed: 99, locks: ['dimensions.height', 'section'] } };
    const a = randomize(locked);
    const b = randomize(locked);
    expect(a).toEqual(b);
    expect(a.dimensions.height).toBe(base.dimensions.height);
    expect(a.section).toEqual(base.section);
    expect(a.dimensions.baseDiameter).not.toBe(base.dimensions.baseDiameter);
    expect(a.random.seed).toBe(100);
  });
  it('mutate stays within ±10 %', () => {
    const m = mutate({ ...base, random: { ...base.random, seed: 5 } });
    expect(Math.abs(m.dimensions.height - base.dimensions.height)).toBeLessThanOrEqual(
      base.dimensions.height * 0.1 + 1e-9,
    );
  });
});

describe('share links', () => {
  it('roundtrips every preset', () => {
    for (const p of PRESETS) {
      const token = encodeShare(p.params);
      expect(token.length).toBeLessThan(800);
      expect(decodeShare(token)).toEqual(p.params);
    }
    expect(decodeShare('garbage')).toBeNull();
  });
});

describe('schema v2 migration (insert block)', () => {
  it('upgrades a v1 document: version, insert defaults and printer hole compensation', () => {
    const v1 = { ...structuredClone(PRESETS[0].params), version: 1 } as Record<string, unknown>;
    delete v1.insert;
    delete (v1.print as { printer: Record<string, unknown> }).printer.holeCompensation;
    const raw = migrateParams(v1) as typeof v1;
    expect(raw.version).toBe(2);
    expect((raw.print as { printer: { holeCompensation: number } }).printer.holeCompensation).toBe(0.05);
    const p = normalizeParams(v1);
    expect(p.version).toBe(SCHEMA_VERSION);
    expect(p.insert).toEqual(DEFAULT_PARAMS.insert);
    expect({ ...p, insert: undefined, version: 0 }).toEqual({ ...PRESETS[0].params, insert: undefined, version: 0 });
  });

  it('does not mutate its input and keeps explicit values', () => {
    const v1 = { version: 1, print: { printer: { preset: 'ender3', holeCompensation: 0.12 } } };
    const copy = structuredClone(v1);
    expect(normalizeParams(v1).print.printer.holeCompensation).toBe(0.12);
    expect(v1).toEqual(copy);
  });

  it('insert defaults match the S1 brief', () => {
    const i = DEFAULT_PARAMS.insert;
    expect([i.type, i.fit, i.odTolerance, i.ribs.count, i.grooves.count, i.bottom]).toEqual([
      'glass',
      'slip',
      0.3,
      0,
      0,
      'open',
    ]);
    expect(i.bottomChamfer).toBe(0.6);
    expect(DEFAULT_PARAMS.print.innerSurface).toBe('smoothLiner');
  });

  it('decodes a v1 share token onto v2 defaults', () => {
    const token = encodeShare(PRESETS[1].params).replace(/^\d+\./, '1.');
    expect(decodeShare(token)).toEqual(PRESETS[1].params);
  });
});
