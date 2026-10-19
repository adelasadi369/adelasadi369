import { describe, expect, it } from 'vitest';
import { BORE_SAG, computeBore } from '../src/core/insert';
import { buildFitTestRing, buildMesh, type BuildResult } from '../src/core/geometry/mesh';
import { exportDesign, fitRingName } from '../src/core/export';
import { normalizeParams } from '../src/core/params/normalize';
import type { VaseParams, VaseParamsInput } from '../src/core/params/schema';
import { analyze, evaluate } from '../src/core/printability';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import { setPath } from '../src/core/params/paths';
import { VASE_PRESETS } from '../src/presets';
import { slice } from './helpers';

const boreParams = (base: VaseParamsInput | VaseParams, insert: object = {}): VaseParams =>
  normalizeParams({
    ...base,
    print: { ...(base.print ?? {}), outputMode: 'shell', innerSurface: 'bore' },
    insert: { ...(base.insert ?? {}), ...insert },
  });

const expectSound = (b: BuildResult) => {
  expect(checkManifold(b.mesh)).toMatchObject({ badEdges: 0, flippedEdges: 0, degenerate: 0, manifold: true });
  expect(signedVolume(b.mesh)).toBeGreaterThan(0);
};

/** Bore wall vertices: world radius and height, grouped per ring (row). */
function boreRings(b: BuildResult) {
  const s = b.mesh.surfaces.find((x) => x.kind === 'inner')!;
  const P = b.mesh.positions;
  const rings: { z: number; rho: number[]; phi: number[] }[] = [];
  for (let r = 0; r < s.rows; r++) {
    const ring = { z: P[(s.firstVertex + r * s.cols) * 3 + 2], rho: [] as number[], phi: [] as number[] };
    for (let i = 0; i < s.cols; i++) {
      const v = (s.firstVertex + r * s.cols + i) * 3;
      ring.rho.push(Math.hypot(P[v], P[v + 1]));
      ring.phi.push(Math.atan2(P[v + 1], P[v]));
    }
    rings.push(ring);
  }
  return rings;
}

const maxGap = (phi: number[]) => {
  const a = phi.slice().sort((x, y) => x - y);
  let g = a[0] + 2 * Math.PI - a[a.length - 1];
  for (let i = 1; i < a.length; i++) g = Math.max(g, a[i] - a[i - 1]);
  return g;
};

describe('shell bore liner', () => {
  it.each<[string, VaseParamsInput]>([
    ['default straight', {}],
    ['twisted hex', { section: { bottom: { shape: 'polygon', sides: 6 } }, twist: { total: 120 } }],
    ['bent', { twist: { bend: { offset: 8, direction: 30 } } }],
  ])('bore radius is exact (%s)', (_n, input) => {
    const p = boreParams({ ...input, dimensions: { baseDiameter: 90, maxDiameter: 110, topDiameter: 90 } }, { od: 50 });
    const b = buildMesh(p, 'medium');
    const R = computeBore(p.insert, p.print.printer).radius;
    expect(b.mesh.bore!.radius).toBe(R);
    const plain = boreRings(b).filter((r) => r.z > 2 && r.z < b.mesh.bore!.zTop - 2);
    expect(plain.length).toBeGreaterThan(100);
    for (const ring of plain) {
      for (const rho of ring.rho) expect(Math.abs(rho - R)).toBeLessThan(1e-4);
      // facets: the inscribed polygon stays within the sag budget
      expect(R * (1 - Math.cos(maxGap(ring.phi) / 2))).toBeLessThanOrEqual(BORE_SAG * 1.05);
    }
  });

  it('every preset with a bore liner is manifold, outward and has two star-shaped contours per slice', () => {
    for (const preset of VASE_PRESETS) {
      const p = boreParams(preset.params, { od: 36 });
      const b = buildMesh(p, 'low');
      expectSound(b);
      expect(b.mesh.bore!.offAxis).toBe(0);
      for (const t of [0.25, 0.5, 0.75]) {
        const s = slice(b.mesh, b.mesh.height * t);
        expect(s.loops.length, `${preset.id} @ ${t}`).toBe(2);
        expect(s.starShaped.every(Boolean), `${preset.id} @ ${t}`).toBe(true);
      }
    }
  });

  it.each<[string, object, VaseParamsInput?]>([
    ['open', { bottom: 'open' }],
    ['lip', { bottom: 'lip', lipWidth: 3 }],
    ['floor', { bottom: 'floor' }],
    ['drain', { bottom: 'drain', drainDiameter: 10 }],
    ['grip ribs', { ribs: { count: 3, interference: 0.2 } }],
    ['grooves', { grooves: { count: 2 } }],
    ['no chamfers', { entryChamfer: 0, bottomChamfer: 0 }],
    ['ruffle + slant', {}, { rim: { ruffle: { count: 6, depth: 5 }, slant: { height: 10 } } }],
    ['flat rim + saucer', { bottom: 'lip' }, { rim: { round: false }, base: { saucer: { enabled: true } } }],
  ])('bottom/feature variant is sound: %s', (_n, insert, extra = {}) => {
    const b = buildMesh(boreParams(extra, { od: 40, ...insert }), 'low');
    expectSound(b);
    if (b.saucer) expectSound({ ...b, mesh: b.saucer });
  });

  it('floor and lip bottoms put the bore on top of the floor; open starts at z = 0 with the elephant-foot chamfer', () => {
    const open = buildMesh(boreParams({}, { od: 40, bottomChamfer: 0.6 }), 'low');
    const R = open.mesh.bore!.radius;
    const bottom = boreRings(open).at(-1)!;
    expect(bottom.z).toBe(0);
    for (const rho of bottom.rho) expect(rho).toBeCloseTo(R + 0.6, 4);
    const lip = buildMesh(boreParams({}, { od: 40, bottom: 'lip', lipThickness: 1.6, lipWidth: 3 }), 'low');
    expect(boreRings(lip).at(-1)!.z).toBeCloseTo(1.6, 5);
    const hole = lip.mesh.surfaces.find((s) => s.kind === 'hole')!;
    const P = lip.mesh.positions;
    const v = hole.firstVertex * 3;
    expect(Math.hypot(P[v], P[v + 1])).toBeCloseTo(lip.mesh.bore!.radius - 3, 4);
    expect(lip.mesh.holeClamped).toBe(false);
    const floor = buildMesh(boreParams({}, { od: 40, bottom: 'floor', floorThickness: 2 }), 'low');
    expect(floor.mesh.surfaces.some((s) => s.kind === 'hole')).toBe(false);
    expect(boreRings(floor).at(-1)!.z).toBeCloseTo(2, 5);
  });

  it('reports a thin core wall and the scale that fixes it', () => {
    const p = boreParams({ dimensions: { baseDiameter: 56, maxDiameter: 60, topDiameter: 56 } }, { od: 50 });
    const bore = buildMesh(p, 'low').mesh.bore!;
    expect(bore.minWall).toBeLessThan(bore.coreWall);
    expect(bore.thin).not.toBeNull();
    expect(bore.scaleNeeded).toBeGreaterThan(1);
  });

  it('leaves non-bore modes untouched', () => {
    const b = buildMesh(normalizeParams({ print: { outputMode: 'shell' } }), 'low');
    expect(b.mesh.bore).toBeUndefined();
  });
});

describe('bore printability', () => {
  it('every preset with a bore passes the accuracy check at preview quality', () => {
    for (const preset of VASE_PRESETS) {
      const p = boreParams(preset.params, { od: 36 });
      const { report } = evaluate(p, p.render.previewQuality);
      const ids = report.issues.map((i) => i.id);
      expect(ids, preset.id).toContain('bore-ok');
      expect(ids, preset.id).not.toContain('bore-accuracy');
      expect(report.manifold).toBe(true);
      expect(report.stats.boreDiameter).toBeCloseTo(2 * computeBore(p.insert, p.print.printer).radius, 9);
    }
  });

  it('flags r_outer < R_bore + wall as an error whose fix clears it', () => {
    let p = boreParams({ dimensions: { baseDiameter: 56, maxDiameter: 60, topDiameter: 56 } }, { od: 50 });
    const r = analyze(buildMesh(p, 'low'), p);
    const issue = r.issues.find((i) => i.id === 'bore-wall')!;
    expect(issue.severity).toBe('error');
    expect(r.score).toBeLessThanOrEqual(69);
    expect(issue.fix?.kind).toBe('patch');
    if (issue.fix?.kind === 'patch') for (const c of issue.fix.changes) p = setPath(p, c.path, c.value);
    p = normalizeParams(p);
    expect(analyze(buildMesh(p, 'low'), p).issues.some((i) => i.id === 'bore-wall')).toBe(false);
  });

  it('warns about a press fit on glass and a tube shorter than the sleeve', () => {
    const p = boreParams({ dimensions: { height: 200 } }, { od: 40, fit: 'press', clearance: 0.1, length: 150 });
    const ids = analyze(buildMesh(p, 'low'), p).issues.map((i) => i.id);
    expect(ids).toContain('insert-press-glass');
    expect(ids).toContain('insert-short');
  });

  it('a bend that leaves the bore axis is an error', () => {
    const p = boreParams({ twist: { bend: { offset: 30 } } }, { od: 30 });
    const ids = analyze(buildMesh(p, 'low'), p).issues.map((i) => i.id);
    expect(ids).toContain('bore-axis');
  });
});

describe('fit test ring', () => {
  it.each(['open', 'lip', 'floor', 'drain'] as const)('is a sound 10 mm slice of the bore (%s)', (bottom) => {
    const p = boreParams({}, { od: 50, bottom, ribs: { count: bottom === 'lip' ? 4 : 0 } });
    const ring = buildFitTestRing(p, 'low');
    expectSound({ mesh: ring } as BuildResult);
    expect(ring.height).toBe(10);
    let zMin = Infinity;
    for (let i = 2; i < ring.positions.length; i += 3) zMin = Math.min(zMin, ring.positions[i]);
    expect(zMin).toBe(0);
    const R = computeBore(p.insert, p.print.printer).radius;
    const rings = boreRings({ mesh: ring } as BuildResult);
    // the bore starts on the floor/lip (or at z = 0) and opens by the bottom chamfer there for open/lip bottoms
    const bottomRing = rings.at(-1)!;
    expect(bottomRing.z).toBeCloseTo(bottom === 'open' ? 0 : 1.6, 5);
    const cb = bottom === 'open' || bottom === 'lip' ? 0.6 : 0;
    expect(Math.max(...bottomRing.rho)).toBeCloseTo(R + cb, 4);
    const plain = rings.filter((r) => r.z > bottomRing.z + 1);
    for (const r of plain) expect(Math.max(...r.rho)).toBeCloseTo(R, 4);
  });

  it('exports as STL named after the target Ø and hole compensation', async () => {
    const p = boreParams({}, { od: 50, clearance: 0.1, odTolerance: 0.3 });
    expect(fitRingName(p)).toBe('fit-ring_D50.50_hc0.05');
    const q = normalizeParams({
      ...p,
      print: { ...p.print, printer: { ...p.print.printer, holeCompensation: 0.125 } },
    });
    expect(fitRingName(q)).toBe('fit-ring_D50.50_hc0.125');
    const f = await exportDesign(p, 'fitRing', 'low');
    expect(f.name).toBe('fit-ring_D50.50_hc0.05.stl');
    const tris = new DataView(f.data.buffer, f.data.byteOffset).getUint32(80, true);
    expect(f.data.byteLength).toBe(84 + 50 * tris);
  });
});
