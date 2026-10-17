import { describe, expect, it } from 'vitest';
import { BORE_SAG, computeBore } from '../src/core/insert';
import { buildMesh, type BuildResult } from '../src/core/geometry/mesh';
import { normalizeParams } from '../src/core/params/normalize';
import type { VaseParams, VaseParamsInput } from '../src/core/params/schema';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import { PRESETS } from '../src/presets';
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
    for (const preset of PRESETS) {
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
