import { describe, expect, it } from 'vitest';
import { autoFix } from '../src/core/printability/autofix';
import { evaluate } from '../src/core/printability';
import { VaseParamsSchema } from '../src/core/params/schema';

describe('auto-fix', () => {
  it('fixes an overhanging belly + twist and only touches offending params', () => {
    const p = VaseParamsSchema.parse({
      dimensions: { height: 120, baseDiameter: 60, maxDiameter: 180, topDiameter: 50, bellyPosition: 30 },
      profile: { preset: 'convex', strength: 90 },
      section: { bottom: { shape: 'polygon', sides: 5, cornerRadius: 2 } },
      twist: { total: 200 },
      print: { printer: { preset: 'bambuH2D' } },
    });
    const before = evaluate(p, 'low').report;
    expect(before.issues.some((i) => i.check === 'overhang' && i.severity === 'error')).toBe(true);
    const r = autoFix(p);
    expect(r.after).toBeGreaterThan(r.before);
    expect(r.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const touched = r.diff.map((d) => d.path);
    expect(touched.every((t) => /^(twist|dimensions|profile|rim)\./.test(t))).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(20);
  });

  it('applies direct fixes (line width, mode)', () => {
    const p = VaseParamsSchema.parse({ print: { lineWidth: 0.4 }, base: { drainageHole: 8 } });
    const r = autoFix(p);
    expect(r.params.print.lineWidth).toBeCloseTo(0.7);
    expect(r.params.print.outputMode).toBe('shell');
  });
});
