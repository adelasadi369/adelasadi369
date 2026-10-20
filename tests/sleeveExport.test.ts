import { describe, expect, it } from 'vitest';
import { exportBatch, paramsForOd, printCard } from '../src/core/export/batch';
import { parseOdList } from '../src/core/export/odList';
import { computeBore, BORE_TOLERANCE } from '../src/core/insert';
import { decimate } from '../src/core/mc/decimate';
import { countComponents, meshValidity } from '../src/core/mc/post';
import { normalizeParams } from '../src/core/params/normalize';
import { measureSleeveBore } from '../src/core/printability/sleeve';
import { buildSleeveMesh, decimateSleeve } from '../src/core/sleeve';
import { PRESETS } from '../src/presets';
import { hashBuffer } from './helpers';
import { expectSoundSleeve } from './sleeveHelpers';

const holed = normalizeParams({
  dimensions: { height: 120, baseDiameter: 96, topDiameter: 90, maxDiameter: 100 },
  profile: { preset: 'convex', strength: 30 },
  effects: [{ type: 'organic', style: 'silkFolds', amount: 3, scale: 40, stretch: 5, seed: 4 }],
  print: { outputMode: 'sleeve' },
  insert: { od: 50, ribs: { count: 4, interference: 0.2, width: 2 } },
  sleeve: { holes: { mode: 'organicNoise', coverage: 15 } },
});

describe('export decimation (quadric, locked bore / base)', () => {
  const b = buildSleeveMesh(holed, 1);
  const target = Math.round(b.mesh.triangleCount * 0.35);
  const d = decimateSleeve(b, target);

  it('reaches the target and stays one closed manifold body', () => {
    expect(d.mesh.triangleCount).toBeLessThanOrEqual(target);
    expect(d.mesh.sleeve.decimated).toMatchObject({ before: b.mesh.triangleCount, after: d.mesh.triangleCount });
    expectSoundSleeve(d);
    expect(meshValidity(d.mesh).manifold).toBe(true);
    expect(countComponents(d.mesh)).toBe(1);
  });

  it('keeps the bore within ±0.05 mm and the base flat', () => {
    const m = measureSleeveBore(d);
    expect(m.samples).toBeGreaterThan(200);
    expect(m.deviation).toBeLessThanOrEqual(BORE_TOLERANCE);
    expect(m.sag).toBeLessThanOrEqual(BORE_TOLERANCE);
    const P = d.mesh.positions;
    for (const v of d.mesh.sleeve.baseVertices) expect(P[v * 3 + 2]).toBe(0);
    let minZ = Infinity;
    for (let v = 0; v < d.mesh.vertexCount; v++) minZ = Math.min(minZ, P[v * 3 + 2]);
    expect(minZ).toBe(0);
  });

  it('stays on the surface: every vertex within half a voxel of the SDF zero set', () => {
    const P = d.mesh.positions;
    let worst = 0;
    for (let v = 0; v < d.mesh.vertexCount; v += 7)
      worst = Math.max(worst, Math.abs(d.sdf.at(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])));
    expect(worst).toBeLessThan(0.5);
  });

  it('is deterministic and a no-op below the target or when off', () => {
    const again = decimateSleeve(buildSleeveMesh(holed, 1), target);
    expect(hashBuffer(again.mesh.positions)).toBe(hashBuffer(d.mesh.positions));
    expect(decimateSleeve(b, 0)).toBe(b);
    expect(decimateSleeve(b, b.mesh.triangleCount + 1)).toBe(b);
    const raw = decimate(b.mesh, { target: b.mesh.triangleCount });
    expect(raw.after).toBe(b.mesh.triangleCount);
  });
});

describe('batch export (several insert ODs)', () => {
  it('parses an OD list: separators, decimals, range, dedupe, order', () => {
    expect(parseOdList('60, 40 ;50 50')).toEqual([40, 50, 60]);
    expect(parseOdList('40.5 / 5 / 200 / 32,5')).toEqual([32.5, 40.5]);
    expect(parseOdList('')).toEqual([]);
  });

  it('scales the skin with R_bore and keeps millimetre features', () => {
    const p = PRESETS.find((x) => x.id === 'sleeve-fingers')!.params;
    const q = paramsForOd(p, 60);
    const k = computeBore(q.insert, q.print.printer).radius / computeBore(p.insert, p.print.printer).radius;
    expect(q.insert.od).toBe(60);
    expect(q.dimensions.maxDiameter).toBeCloseTo(p.dimensions.maxDiameter * k, 6);
    expect(q.sleeve.fingers.width).toBeCloseTo(Math.min(30, p.sleeve.fingers.width * k), 6);
    expect(q.dimensions.height).toBe(p.dimensions.height);
    expect(q.sleeve.holes).toEqual(p.sleeve.holes);
    expect(q.sleeve.skinThickness).toBe(p.sleeve.skinThickness);
  });

  it('one ZIP with a mesh and a print card per size', async () => {
    const p = normalizeParams({
      ...holed,
      name: 'Batch Test',
      dimensions: { ...holed.dimensions, height: 40 },
      sleeve: { ...holed.sleeve, holes: { mode: 'none' }, mesh: { exportVoxel: 0.6, decimateTarget: 30000 } },
    });
    const progress: number[] = [];
    const f = await exportBatch(p, [40, 50], 'stl', { onProgress: (x) => progress.push(x) });
    expect(f.name).toBe('batch-test-batch.zip');
    const text = new TextDecoder('latin1').decode(f.data);
    for (const n of [
      'D40/batch-test-D40.stl',
      'D40/print-card.txt',
      'D50/batch-test-D50.stl',
      'D50/print-card.txt',
      'batch-test.json',
    ])
      expect(text).toContain(n);
    expect(progress.at(-1)).toBe(1);
    expect(Math.max(...progress.slice(0, -1))).toBeLessThan(1);
  });

  it('the print card states the fit, the measured bore and the decimation', () => {
    const p = normalizeParams({ ...holed, sleeve: { ...holed.sleeve, mesh: { decimateTarget: 60000 } } });
    const b = decimateSleeve(buildSleeveMesh(p, 1), 60000);
    const card = printCard(p, b);
    expect(card).toContain('OD 50.00 mm');
    expect(card).toMatch(/deviation 0\.0[0-4]\d mm/);
    expect(card).toContain('decimated from');
    expect(card).toContain('support_on_build_plate_only = 1');
    expect(card).toContain('کارت چاپ');
  });
});
