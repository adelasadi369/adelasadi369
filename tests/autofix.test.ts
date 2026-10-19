import { describe, expect, it } from 'vitest';
import { autoFix } from '../src/core/printability/autofix';
import { evaluate } from '../src/core/printability';
import { VaseParamsSchema } from '../src/core/params/schema';
import { normalizeParams } from '../src/core/params/normalize';

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

  it('sleeve mode: ablation removes the overhang errors without touching the insert or the printer', () => {
    const p = normalizeParams({
      dimensions: { height: 120, baseDiameter: 66, maxDiameter: 150, topDiameter: 120, bellyPosition: 80 },
      profile: { preset: 'convex', strength: 80 },
      effects: [{ type: 'organic', style: 'blobs', amount: 8, scale: 40 }],
      print: { outputMode: 'sleeve' },
      insert: { od: 40 },
    });
    const before = evaluate(p, 'low').report;
    expect(before.issues.some((i) => i.check === 'overhang' && i.severity === 'error')).toBe(true);
    // the overhang issue now offers the auto-fix action in sleeve mode
    expect(before.issues.find((i) => i.check === 'overhang' && i.severity === 'error')?.fix?.kind).toBe('autofix');
    const r = autoFix(p);
    expect(r.after).toBeGreaterThan(r.before);
    expect(r.report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.diff.length).toBeGreaterThan(0);
    expect(r.diff.every((d) => /^(twist|dimensions|rim|effects|sleeve)\./.test(d.path))).toBe(true);
    expect(r.params.insert).toEqual(p.insert);
    expect(r.params.print).toEqual(p.print);
  });
});
