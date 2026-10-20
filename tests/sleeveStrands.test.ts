import { describe, expect, it } from 'vitest';
import { normalizeParams } from '../src/core/params/normalize';
import type { VaseParamsInput } from '../src/core/params/schema';
import { analyze } from '../src/core/printability';
import { buildSleeveMesh, DRAG_VOXEL } from '../src/core/sleeve';
import { createSleeveField } from '../src/core/sleeve/field';
import { PRESETS } from '../src/presets';
import { expectSoundSleeve, rayCoverage, strandOverhang, strandWall } from './sleeveHelpers';

const DEG = Math.PI / 180;

/** Straight sleeve around a Ø50 glass tube with fingers / drips. */
const withStrands = (sleeve: VaseParamsInput['sleeve'] = {}, extra: VaseParamsInput = {}) =>
  normalizeParams({
    dimensions: { height: 160, baseDiameter: 84, topDiameter: 84 },
    profile: { preset: 'straight' },
    ...extra,
    print: { outputMode: 'sleeve' },
    insert: { od: 50 },
    sleeve,
  });

describe('fingers (strand paths)', () => {
  it('extreme lean, curl and twist are scaled back to maxOverhang − 3°; radii never below r_min', () => {
    const p = withStrands({ fingers: { count: 6, lean: 40, curl: -40, twist: 360, taper: 80, freeLength: 120 } });
    const { strands, H, Rc } = createSleeveField(p, DRAG_VOXEL);
    expect(strands.list).toHaveLength(6);
    for (const f of strands.list) {
      expect(f.tilt).toBeLessThanOrEqual(p.print.maxOverhang - 3 + 1e-6);
      expect(f.scale).toBeLessThan(1);
      expect(Math.min(...f.rad)).toBeGreaterThanOrEqual(strands.rMin - 1e-9);
      // rooted at the bed, touching the core tube; tips below the top cut
      expect(f.pts[2]).toBe(0);
      expect(Math.hypot(f.pts[0], f.pts[1]) - f.rad[0]).toBeLessThan(Rc);
      expect(f.box[5]).toBeLessThanOrEqual(H + 1e-6);
    }
    expect(strands.zBody).toBeGreaterThanOrEqual(Math.min(p.sleeve.topEdge.minTubeCoverage, H));
  });

  it('mild settings are kept as given (scale 1)', () => {
    const p = withStrands({ fingers: { count: 5, lean: 3, curl: 5, twist: 0 } });
    for (const f of createSleeveField(p, DRAG_VOXEL).strands.list) expect(f.scale).toBe(1);
  });

  it('drip bulbs widen upward at ≤ maxOverhang − 8° plus the path tilt', () => {
    const p = withStrands({ drips: { count: 6, length: 60, bulbSize: 16, placement: 'random' } });
    const { strands } = createSleeveField(p, DRAG_VOXEL);
    expect(strands.list.filter((s) => s.kind === 'drip').length).toBeGreaterThan(0);
    for (const d of strands.list) {
      const P = d.pts;
      const L = Math.hypot(P[3] - P[0], P[4] - P[1], P[5] - P[2]);
      const side = Math.asin((d.rad[1] - d.rad[0]) / L) / DEG;
      const tilt = Math.atan2(Math.hypot(P[3] - P[0], P[4] - P[1]), P[5] - P[2]) / DEG;
      expect(side).toBeLessThanOrEqual(p.print.maxOverhang - 8 + 1e-6);
      expect(side + tilt).toBeLessThanOrEqual(p.print.maxOverhang + 1e-6);
      expect(d.rad[0]).toBeGreaterThanOrEqual(strands.rMin - 1e-9);
    }
  });

  it('no holes above the body cap: free fingers are never cut', () => {
    const p = withStrands({
      fingers: { count: 5, freeLength: 80 },
      holes: { mode: 'organicNoise', coverage: 20, keepOutTop: 0 },
    });
    const f = createSleeveField(p, DRAG_VOXEL);
    for (let a = 0; a < 64; a++)
      for (let z = f.strands.zBody + 1; z < f.H; z += 4)
        expect(f.holes!.at((a / 64) * 2 * Math.PI, z)).toBeGreaterThan(0);
  });
});

describe.each(['sleeve-fingers', 'sleeve-drip'])('%s at 1.0 mm', (id) => {
  const p = PRESETS.find((x) => x.id === id)!.params;
  const b = buildSleeveMesh(p, 1);
  it('one sound body; strand undersides within maxOverhang + 3° (tips excluded); strands ≥ two lines', () => {
    expectSoundSleeve(b, id);
    const oh = strandOverhang(b, p);
    expect(oh.area).toBeGreaterThan(100);
    expect(oh.badFraction).toBeLessThan(0.01);
    expect(strandWall(b)).toBeGreaterThanOrEqual(2 * p.print.lineWidth);
    expect(analyze(b, p).issues.filter((i) => i.id.startsWith('overhang-red'))).toEqual([]);
  });
});

/** Straight sleeve with a hole mode at 20 % (5 mm bridges). */
const holed = (mode: 'ellipses' | 'voronoi' | 'foldGaps', extra: VaseParamsInput = {}) =>
  normalizeParams({
    dimensions: { height: 150, baseDiameter: 92, topDiameter: 92 },
    profile: { preset: 'straight' },
    ...extra,
    print: { outputMode: 'sleeve' },
    insert: { od: 50 },
    sleeve: {
      holes: { mode, coverage: 20, size: 14, minBridgeWidth: 5, verticalStretch: mode === 'foldGaps' ? 3 : 1.4 },
    },
  });

describe.each([
  ['ellipses', {}],
  ['voronoi', {}],
  // fold gaps need folds: six lobes
  ['foldGaps', { twist: { lobes: { count: 6, depth: 25 } } }],
] as const)('%s holes', (mode, extra) => {
  const p = holed(mode, extra);
  const b = buildSleeveMesh(p, DRAG_VOXEL);
  const hs = b.mesh.sleeve.holes!;
  it('manifold, coverage within ±3 points (stats and radial rays), bridges ≥ minBridgeWidth', () => {
    expectSoundSleeve(b, mode);
    expect(hs.holes).toBeGreaterThan(2);
    expect(Math.abs(hs.coverage - 0.2)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(rayCoverage(b) - 0.2)).toBeLessThanOrEqual(0.03);
    expect(hs.thinBridges).toBeNull();
    expect(hs.minBridge).toBeGreaterThanOrEqual(5 - 1e-6);
  });
  it('deterministic', () => {
    const again = buildSleeveMesh(normalizeParams({ ...p, sleeve: { ...p.sleeve } }), DRAG_VOXEL);
    expect(again.mesh.triangleCount).toBe(b.mesh.triangleCount);
    expect(again.mesh.sleeve.holes!.coverage).toBe(hs.coverage);
  });
});

describe('self-supporting skin', () => {
  it('removes the red overhang of a steep belly; the trade-off is less volume under it', () => {
    const base = {
      dimensions: { height: 120, baseDiameter: 66, maxDiameter: 150, topDiameter: 120, bellyPosition: 80 },
      profile: { preset: 'convex' as const, strength: 80 },
      effects: [{ type: 'organic' as const, style: 'blobs' as const, amount: 8, scale: 40 }],
      print: { outputMode: 'sleeve' as const },
      insert: { od: 40 },
    };
    const off = normalizeParams(base);
    const on = normalizeParams({ ...base, sleeve: { selfSupporting: true } });
    const bOff = buildSleeveMesh(off, DRAG_VOXEL);
    const ro = analyze(bOff, off);
    const bOn = buildSleeveMesh(on, DRAG_VOXEL);
    const rn = analyze(bOn, on);
    const red = (r: typeof ro) => r.issues.filter((i) => i.id.startsWith('overhang-red'));
    expect(red(ro).length).toBeGreaterThan(0);
    // the overhang issue offers the self-supporting skin as an extra fix
    expect(red(ro)[0].fixes?.some((f) => f.kind === 'patch' && f.changes[0].path === 'sleeve.selfSupporting')).toBe(
      true,
    );
    expect(red(rn)).toEqual([]);
    expect(rn.overhang.redFraction).toBeLessThan(0.001);
    expect(bOn.mesh.sleeve.validity.volume).toBeLessThan(bOff.mesh.sleeve.validity.volume);
    expectSoundSleeve(bOn, 'selfSupporting');
  });
});
