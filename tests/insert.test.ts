import { describe, expect, it } from 'vitest';
import {
  boreMinColumns,
  boreProfile,
  boreRay,
  BORE_SAG,
  calibrateHoleCompensation,
  computeBore,
  FIT_CLEARANCE,
} from '../src/core/insert';
import { normalizeParams } from '../src/core/params/normalize';
import { DEFAULT_PARAMS } from '../src/core/params/schema';

const withInsert = (insert: object, printer: object = {}) =>
  normalizeParams({ insert, print: { outputMode: 'shell', innerSurface: 'bore', printer } });

describe('computeBore', () => {
  it('R_bore = OD/2 + clearance + tol/2 + holeCompensation', () => {
    const b = computeBore(
      { ...DEFAULT_PARAMS.insert, od: 50, clearance: 0.25, odTolerance: 0.3 },
      { holeCompensation: 0.05 },
    );
    expect(b.radius).toBeCloseTo(25 + 0.25 + 0.15 + 0.05, 12);
    expect(b.targetDiameter).toBeCloseTo(50.8, 12);
    expect(b.diameter).toBeCloseTo(50.9, 12);
  });

  it('fit clearances match the spec', () => {
    expect(FIT_CLEARANCE).toEqual({ press: 0.1, snug: 0.18, slip: 0.25 });
    expect(DEFAULT_PARAMS.insert.clearance).toBe(FIT_CLEARANCE[DEFAULT_PARAMS.insert.fit]);
  });
});

describe('bore profile', () => {
  const p = withInsert({
    od: 40,
    entryChamfer: 1,
    bottomChamfer: 0.6,
    grooves: { count: 1, z1: 50, width: 3, depth: 1 },
  });
  const prof = boreProfile(p, 150, 150);
  const R = prof.bore.radius;

  it('is exactly R_bore away from chamfers, grooves and ribs', () => {
    for (const z of [5, 40, 100, 140]) expect(prof.radiusAt(1.234, z, 150)).toBe(R);
  });

  it('opens 45° chamfers at the bottom (elephant foot) and the entry', () => {
    expect(prof.radiusAt(0, 0, 150)).toBeCloseTo(R + 0.6, 12);
    expect(prof.radiusAt(0, 0.3, 150)).toBeCloseTo(R + 0.3, 12);
    expect(prof.radiusAt(0, 150, 150)).toBeCloseTo(R + 1, 12);
    expect(prof.radiusAt(0, 149.5, 150)).toBeCloseTo(R + 0.5, 12);
  });

  it('cuts O-ring grooves with 45° flanks', () => {
    expect(prof.radiusAt(0, 75, 150)).toBeCloseTo(R + 1, 12);
    expect(prof.radiusAt(0, 73.5 + 0.5, 150)).toBeCloseTo(R + 0.5, 12);
    expect(prof.radiusAt(0, 73, 150)).toBe(R);
  });

  it('grip ribs reach in by the interference and leave the gaps exact', () => {
    const q = boreProfile(
      withInsert({ od: 40, ribs: { count: 4, width: 2, interference: 0.2, heightFraction: 50 } }),
      150,
      150,
    );
    const r = q.bore.radius;
    expect(q.radiusAt(0, 30, 150)).toBeCloseTo(r - 0.2, 12);
    expect(q.radiusAt(Math.PI / 2, 30, 150)).toBeCloseTo(r - 0.2, 12);
    expect(q.radiusAt(Math.PI / 4, 30, 150)).toBe(r);
    expect(q.radiusAt(0, 120, 150)).toBe(r); // above heightFraction
  });

  it('ray from an off-axis slice centre lands on the bore circle', () => {
    const s = boreRay(prof, 3, -2, 0.7, 50, 150);
    const x = 3 + s * Math.cos(0.7);
    const y = -2 + s * Math.sin(0.7);
    expect(Math.hypot(x, y)).toBeCloseTo(R, 10);
    expect(Number.isNaN(boreRay(prof, R + 1, 0, 0, 50, 150))).toBe(true);
  });

  it('column count keeps the chord sag within budget', () => {
    for (const R of [8, 25, 75]) {
      const n = boreMinColumns(DEFAULT_PARAMS.insert, R);
      expect(R * (1 - Math.cos(Math.PI / n))).toBeLessThanOrEqual(BORE_SAG + 1e-12);
    }
  });
});

describe('calibration', () => {
  const bore = computeBore({ ...DEFAULT_PARAMS.insert, od: 50 }, { holeCompensation: 0.05 });

  it('adds half the shortfall of the printed hole', () => {
    const c = calibrateHoleCompensation(bore, bore.targetDiameter - 0.2);
    expect(c.old).toBe(0.05);
    expect(c.next).toBeCloseTo(0.15, 12);
    expect(c.clamped).toBe(false);
  });

  it('a perfect print keeps the value; an oversize hole lowers it; the range is respected', () => {
    expect(calibrateHoleCompensation(bore, bore.targetDiameter).next).toBeCloseTo(0.05, 12);
    expect(calibrateHoleCompensation(bore, bore.targetDiameter + 0.1).next).toBeCloseTo(0, 12);
    const far = calibrateHoleCompensation(bore, bore.targetDiameter - 5);
    expect(far.next).toBe(0.5);
    expect(far.clamped).toBe(true);
  });
});
