import { describe, expect, it } from 'vitest';
import { exportDesign } from '../src/core/export';
import { recommendedSettings } from '../src/core/export/slicerSettings';
import { BORE_TOLERANCE, computeBore } from '../src/core/insert';
import { normalizeParams } from '../src/core/params/normalize';
import { analyze, evaluate } from '../src/core/printability';
import { measureSleeveBore } from '../src/core/printability/sleeve';
import { buildSleeveMesh, DRAG_VOXEL, type SleeveBuild } from '../src/core/sleeve';
import { PRESETS } from '../src/presets';
import { hashBuffer, slice } from './helpers';
import { expectSoundSleeve, sleeveParams } from './sleeveHelpers';

describe('sleeve engine', () => {
  it('is deterministic: same params ⇒ identical buffers', () => {
    const p = sleeveParams(PRESETS[1].params);
    const a = buildSleeveMesh(p, DRAG_VOXEL).mesh;
    const b = buildSleeveMesh(structuredClone(p), DRAG_VOXEL).mesh;
    expect(hashBuffer(a.positions)).toBe(hashBuffer(b.positions));
    expect(hashBuffer(a.indices)).toBe(hashBuffer(b.indices));
  });

  it('every preset builds one valid body at the drag voxel, first lattice', () => {
    for (const preset of PRESETS) {
      const b = buildSleeveMesh(sleeveParams(preset.params), DRAG_VOXEL);
      expectSoundSleeve(b, preset.id);
      expect(b.mesh.sleeve.retried, preset.id).toBe(false);
    }
  });

  it('a failed first lattice is retried once on the shifted lattice and logged', () => {
    const b = buildSleeveMesh(sleeveParams(PRESETS[4].params), DRAG_VOXEL, { failFirst: true });
    expect(b.mesh.sleeve.retried).toBe(true);
    expect(b.mesh.sleeve.log.join(' ')).toMatch(/retried at offset 0\.3/);
    expectSoundSleeve(b);
    expect(analyze(b, sleeveParams(PRESETS[4].params)).issues.some((i) => i.id === 'sleeve-retry')).toBe(true);
  });

  it('the shifted retry lattice also builds a valid body', () => {
    expectSoundSleeve(buildSleeveMesh(sleeveParams(PRESETS[4].params), DRAG_VOXEL, { offsetIndex: 1 }));
  });

  it('floor bottom: no hole at the axis, watertight', () => {
    const p = sleeveParams({}, { bottom: 'floor', floorThickness: 2 });
    const b = buildSleeveMesh(p, 1);
    expectSoundSleeve(b);
    // the field is material on the axis through the floor, and the bore starts above it
    for (const z of [0.3, 1, 1.7]) expect(b.sdf.at(0, 0, z)).toBeLessThan(0);
    expect(b.sdf.at(0, 0, 3)).toBeGreaterThan(0);
    // a slice through the floor is one solid disc (one contour), above it an annulus (two)
    expect(slice(b.mesh, 1).loops.length).toBe(1);
    expect(slice(b.mesh, 10).loops.length).toBe(2);
    expect(b.mesh.sleeve.holeVertices.length).toBe(0);
  });

  it('lip and drain bottoms leave an exact opening; open bottom has none below the bore', () => {
    for (const [bottom, extra] of [
      ['lip', { lipWidth: 3 }],
      ['drain', { drainDiameter: 10 }],
    ] as const) {
      const b = buildSleeveMesh(sleeveParams({}, { bottom, ...extra }), 1);
      expectSoundSleeve(b, bottom);
      const r = bottom === 'lip' ? b.sdf.R - 3 : 5;
      const P = b.mesh.positions;
      expect(b.mesh.sleeve.holeVertices.length).toBeGreaterThan(0);
      for (const v of b.mesh.sleeve.holeVertices) expect(Math.hypot(P[v * 3], P[v * 3 + 1])).toBeCloseTo(r, 4);
      expect(slice(b.mesh, 0.8).loops.length).toBe(2);
    }
  });
});

describe('sleeve bore accuracy (measured between ribs)', () => {
  it.each([
    [1, 0],
    [1, 4],
    [0.5, 0],
    [0.5, 4],
  ])('voxel %s mm, %s grip ribs: within ±0.05 mm', (voxel, ribs) => {
    const p = sleeveParams(PRESETS[0].params, { ribs: { count: ribs, interference: 0.2, width: 2 } });
    const b = buildSleeveMesh(p, voxel);
    expectSoundSleeve(b);
    const m = measureSleeveBore(b);
    expect(m.samples).toBeGreaterThan(1000);
    expect(m.deviation).toBeLessThanOrEqual(BORE_TOLERANCE);
    expect(m.sag).toBeLessThanOrEqual(BORE_TOLERANCE);
    // and through the report: bore-ok, no accuracy error
    const ids = analyze(b, p).issues.map((i) => i.id);
    expect(ids).toContain('bore-ok');
    expect(ids).not.toContain('bore-accuracy');
  });

  it('ribs reach into the bore by their interference', () => {
    const p = sleeveParams(PRESETS[0].params, { ribs: { count: 4, interference: 0.2, width: 2 } });
    const b = buildSleeveMesh(p, 0.5);
    const P = b.mesh.positions;
    let deepest = Infinity;
    for (const v of b.mesh.sleeve.boreVertices) deepest = Math.min(deepest, Math.hypot(P[v * 3], P[v * 3 + 1]));
    expect(b.sdf.R - deepest).toBeGreaterThan(0.15);
    expect(b.sdf.R - deepest).toBeLessThanOrEqual(0.2 + 1e-4);
  });
});

describe('sleeve report', () => {
  it('reports bore Ø, volume and no capacity; overhang skips the bed', () => {
    const p = sleeveParams(PRESETS[6].params);
    const { build, report } = evaluate(p, 'low');
    expect(report.manifold).toBe(true);
    expect(report.stats.boreDiameter).toBeCloseTo(2 * computeBore(p.insert, p.print.printer).radius, 9);
    expect(report.stats.capacityMl).toBe(0);
    expect(report.stats.materialCm3).toBeGreaterThan(10);
    for (const v of (build as SleeveBuild).mesh.sleeve.baseVertices) expect(report.vertexOverhang[v]).toBe(-1);
    expect(report.issues.some((i) => i.id === 'bore-mode')).toBe(false);
  });

  it('reuses the press-fit and short-tube checks', () => {
    const p = sleeveParams({ dimensions: { height: 200 } }, { fit: 'press', clearance: 0.1, length: 150 });
    const ids = evaluate(p, 'low').report.issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['insert-press-glass', 'insert-short']));
  });

  it('warns about a wall thinner than two lines (core tube alone at coreWall 1.2)', () => {
    // in S2a the skin is solid to the axis, so the only thin wall is the core tube when the skin is inside it
    const p = sleeveParams(
      { dimensions: { baseDiameter: 40, topDiameter: 40, maxDiameter: 40 }, profile: { preset: 'straight' } },
      { od: 50, coreWall: 1.2 },
    );
    const w = evaluate(p, 'low').report.issues.find((i) => i.id === 'sleeve-wall');
    expect(w?.severity).toBe('warn');
    const ok = sleeveParams(PRESETS[0].params);
    expect(evaluate(ok, 'low').report.issues.some((i) => i.id === 'sleeve-wall')).toBe(false);
  });
});

describe('sleeve exports', () => {
  it('STL at the export voxel with progress; aborts on request', async () => {
    const p = sleeveParams(PRESETS[3].params);
    const q = normalizeParams({ ...p, sleeve: { ...p.sleeve, mesh: { ...p.sleeve.mesh, exportVoxel: 0.6 } } });
    const seen: number[] = [];
    const f = await exportDesign(q, 'stl', undefined, { onProgress: (x) => seen.push(x) });
    expect(f.name.endsWith('.stl')).toBe(true);
    const tris = new DataView(f.data.buffer, f.data.byteOffset).getUint32(80, true);
    expect(f.data.byteLength).toBe(84 + 50 * tris);
    expect(tris).toBe(buildSleeveMesh(q, 0.6).mesh.triangleCount);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.at(-1)).toBe(1);
    const signal = { aborted: false };
    const run = exportDesign(q, 'stl', undefined, {
      signal,
      onProgress: (x) => {
        if (x > 0.3) signal.aborted = true;
      },
    });
    await expect(run).rejects.toThrow('aborted');
  });

  it('Fit Test Ring works in sleeve mode; 3MF carries the sleeve slicer profile', async () => {
    const p = sleeveParams({}, { od: 50, clearance: 0.1, odTolerance: 0.3 });
    const ring = await exportDesign(p, 'fitRing', 'low');
    expect(ring.name).toBe('fit-ring_D50.50_hc0.05.stl');
    const s = recommendedSettings(p);
    expect(s).toMatchObject({ spiral_mode: 0, wall_loops: 3, support_on_build_plate_only: 1, mode: 'sleeve' });
    expect(String(s.support_type)).toContain('tree');
  });
});
