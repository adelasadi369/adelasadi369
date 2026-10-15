import { describe, expect, it } from 'vitest';
import { clampToSchema } from '../src/core/params/clamp';
import { normalizeParams } from '../src/core/params/normalize';
import { diffParams, getPath, setPath } from '../src/core/params/paths';
import { DEFAULT_PARAMS, VaseParamsSchema, paramsJsonSchema } from '../src/core/params/schema';

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
