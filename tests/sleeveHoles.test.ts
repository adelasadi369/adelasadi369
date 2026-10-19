import { describe, expect, it } from 'vitest';
import { normalizeParams } from '../src/core/params/normalize';
import { analyze } from '../src/core/printability';
import { measureSleeveBore } from '../src/core/printability/sleeve';
import type { VaseParamsInput } from '../src/core/params/schema';
import { buildSleeveMesh, DRAG_VOXEL } from '../src/core/sleeve';
import { edt, label } from '../src/core/sleeve/grid2d';
import { buildTopEdge } from '../src/core/sleeve/topEdge';
import { hashBuffer } from './helpers';
import { expectSoundSleeve, rayCoverage, roofOverhang } from './sleeveHelpers';

/** Straight sleeve (no skin overhang of its own) around a Ø50 glass tube, with organic-noise holes. */
const holed = (holes: object = {}, extra: VaseParamsInput = {}) =>
  normalizeParams({
    profile: { preset: 'straight' },
    ...extra,
    print: { outputMode: 'sleeve' },
    insert: { od: 50 },
    sleeve: { holes: { mode: 'organicNoise', coverage: 20, ...holes }, ...(extra.sleeve ?? {}) },
  });

describe('grid2d', () => {
  it('periodic EDT and nearest site match brute force', () => {
    const g = { nx: 23, nz: 17 };
    const site = new Uint8Array(g.nx * g.nz);
    for (let c = 0; c < site.length; c++) site[c] = (c * 7919) % 31 === 0 ? 1 : 0;
    const dx = 0.7;
    const dz = 0.4;
    const { d2, near } = edt(g, site, dx, dz);
    for (let c = 0; c < site.length; c++) {
      const i = c % g.nx;
      const j = (c - i) / g.nx;
      let best = Infinity;
      for (let s = 0; s < site.length; s++) {
        if (!site[s]) continue;
        const si = s % g.nx;
        let di = Math.abs(si - i);
        di = Math.min(di, g.nx - di);
        best = Math.min(best, (di * dx) ** 2 + ((Math.floor(s / g.nx) - j) * dz) ** 2);
      }
      expect(d2[c]).toBeCloseTo(best, 9);
      const s = near[c];
      let di = Math.abs((s % g.nx) - i);
      di = Math.min(di, g.nx - di);
      expect((di * dx) ** 2 + ((Math.floor(s / g.nx) - j) * dz) ** 2).toBeCloseTo(best, 9);
    }
  });

  it('labels wrap around in x', () => {
    const g = { nx: 10, nz: 3 };
    const on = new Uint8Array(30);
    on[10] = on[19] = 1; // row 1, columns 0 and 9: neighbours across the seam
    expect(label(g, on, false).count).toBe(1);
  });
});

describe('top edge', () => {
  it('flat without peaks; peaks reach H and valleys never go below minTubeCoverage', () => {
    expect(buildTopEdge(holed(), 150).flat).toBe(true);
    const p = normalizeParams({ sleeve: { topEdge: { peakCount: 3, amplitude: 120, minTubeCoverage: 70 } } });
    const t = buildTopEdge(p, 150);
    expect(t.flat).toBe(false);
    expect(t.min).toBeCloseTo(70, 9);
    expect(t.max).toBeGreaterThan(148);
    // minTubeCoverage is capped at the height
    expect(
      buildTopEdge(normalizeParams({ sleeve: { topEdge: { peakCount: 3, minTubeCoverage: 400 } } }), 150).min,
    ).toBe(150);
  });

  it('cuts the sleeve: the mesh top follows Htop and the lowest point of the rim holds the tube', () => {
    const p = normalizeParams({
      print: { outputMode: 'sleeve' },
      insert: { od: 40 },
      sleeve: { topEdge: { peakCount: 3, amplitude: 40, minTubeCoverage: 60 } },
    });
    const b = buildSleeveMesh(p, DRAG_VOXEL);
    expectSoundSleeve(b);
    const top = b.sdf.top;
    // material just below the rim, none just above, all around
    for (let k = 0; k < 24; k++) {
      const phi = (k / 24) * 2 * Math.PI;
      const r = b.sdf.Rc - 0.5;
      const h = top.at(phi);
      expect(b.sdf.at(r * Math.cos(phi), r * Math.sin(phi), h - 1.5)).toBeLessThan(0);
      expect(b.sdf.at(r * Math.cos(phi), r * Math.sin(phi), h + 1.5)).toBeGreaterThan(0);
    }
    expect(top.min).toBeGreaterThanOrEqual(60);
  });
});

describe('organic-noise holes', () => {
  it('coverage (radial rays through the SDF) is within ±3 points of the target', () => {
    for (const [coverage, seed] of [
      [10, 1],
      [20, 2],
      [35, 3],
    ])
      expect(
        Math.abs(rayCoverage(buildSleeveMesh(holed({ coverage }, { random: { seed } }), DRAG_VOXEL)) - coverage / 100),
      ).toBeLessThan(0.03);
  });

  it('no bridge between holes (or a hole and the rim) is thinner than minBridgeWidth', () => {
    for (const [w, seed] of [
      [4.8, 4],
      [8, 5],
    ]) {
      const b = buildSleeveMesh(holed({ minBridgeWidth: w, coverage: 25 }, { random: { seed } }), DRAG_VOXEL);
      const s = b.mesh.sleeve.holes!;
      // one map cell of tolerance at the bore radius
      expect(s.minBridge).toBeGreaterThanOrEqual(w - Math.max(b.sdf.holes!.dphi * b.sdf.R, b.sdf.holes!.dz));
      expect(s.thinBridges).toBeNull();
    }
  });

  it('teardrop tops keep hole roofs within maxOverhang (from face normals); without them roofs overhang', () => {
    const pOn = holed({}, { random: { seed: 2 } });
    const pOff = holed({ teardropTops: false }, { random: { seed: 2 } });
    const on = roofOverhang(buildSleeveMesh(pOn, 1), pOn);
    const off = roofOverhang(buildSleeveMesh(pOff, 1), pOff);
    expect(on.area).toBeGreaterThan(500);
    expect(on.badFraction).toBeLessThan(0.02);
    expect(off.badFraction).toBeGreaterThan(0.1);
  });

  it('holes keep out of the base, the bore-bottom ring and the keep-out bands', () => {
    const p = holed({ coverage: 40, keepOutBottom: 15, keepOutTop: 12 });
    const b = buildSleeveMesh(p, DRAG_VOXEL);
    const hm = b.sdf.holes!;
    for (let c = 0; c < hm.open.length; c++) {
      if (!hm.open[c]) continue;
      const z = Math.floor(c / hm.nx) * hm.dz;
      expect(z).toBeGreaterThanOrEqual(15);
    }
    // the band below the bottom keep-out is a solid ring all around the bore
    for (let k = 0; k < 36; k++) {
      const phi = (k / 36) * 2 * Math.PI;
      const r = b.sdf.R + 1;
      for (const z of [1, 7, 13]) expect(b.sdf.at(r * Math.cos(phi), r * Math.sin(phi), z)).toBeLessThan(0);
    }
    expectSoundSleeve(b);
  });

  it('is deterministic (also after the hole-map cache was replaced)', () => {
    const p = holed({}, { random: { seed: 9 } });
    const a = buildSleeveMesh(p, DRAG_VOXEL).mesh;
    buildSleeveMesh(holed({}, { random: { seed: 10 } }), DRAG_VOXEL);
    const b = buildSleeveMesh(structuredClone(p), DRAG_VOXEL).mesh;
    expect(hashBuffer(a.positions)).toBe(hashBuffer(b.positions));
    expect(hashBuffer(a.indices)).toBe(hashBuffer(b.indices));
  });

  it('reports bore contact (solid share of the bore between its bottom and the rim)', () => {
    const s = buildSleeveMesh(holed({ coverage: 30 }), DRAG_VOXEL).mesh.sleeve.holes!;
    expect(s.boreContact).toBeGreaterThan(0.6);
    expect(s.boreContact).toBeLessThan(0.75);
  });
});

describe('sleeve hole checks', () => {
  const p = holed({ coverage: 25 }, { random: { seed: 3 } });
  const b = buildSleeveMesh(p, 1);
  const withHoles = (over: object) => ({
    ...b,
    mesh: { ...b.mesh, sleeve: { ...b.mesh.sleeve, holes: { ...b.mesh.sleeve.holes!, ...over } } },
  });

  it('bore accuracy ignores facets on hole edges: a holed sleeve still passes ±0.05 mm', () => {
    const m = measureSleeveBore(b);
    expect(m.samples).toBeGreaterThan(200);
    expect(m.deviation).toBeLessThanOrEqual(0.05);
    const r = analyze(b, p);
    expect(r.issues.map((i) => i.id)).toContain('bore-ok');
    expect(r.issues.some((i) => i.id === 'bore-accuracy')).toBe(false);
    expect(r.stats.boreContact).toBeCloseTo(b.mesh.sleeve.holes!.boreContact, 9);
  });

  it('thin bridges warn with a height range and three fixes', () => {
    const r = analyze(withHoles({ thinBridges: [40, 60], minBridge: 3 }), p);
    const i = r.issues.find((x) => x.id === 'sleeve-bridges')!;
    expect(i.severity).toBe('warn');
    expect(i.heightRange![0]).toBeLessThan((100 * 40) / b.mesh.height);
    expect(i.heightRange![1]).toBeGreaterThan((100 * 60) / b.mesh.height);
    const paths = [i.fix!, ...i.fixes!].flatMap((f) => (f.kind === 'patch' ? f.changes.map((c) => c.path) : []));
    expect(paths).toEqual(['sleeve.holes.coverage', 'sleeve.holes.size', 'sleeve.holes.minBridgeWidth']);
  });

  it('bore contact below 40 % warns, with coverage and keep-out fixes', () => {
    expect(analyze(b, p).issues.some((i) => i.id === 'sleeve-bore-contact')).toBe(false);
    const i = analyze(withHoles({ boreContact: 0.3 }), p).issues.find((x) => x.id === 'sleeve-bore-contact')!;
    expect(i.severity).toBe('warn');
    expect(i.fix!.kind === 'patch' && i.fix!.changes[0]).toEqual({ path: 'sleeve.holes.coverage', value: 20 });
    expect(i.fixes![0].kind === 'patch' && i.fixes![0].changes.map((c) => c.path)).toEqual([
      'sleeve.holes.keepOutBottom',
      'sleeve.holes.keepOutTop',
    ]);
  });
});
