import { describe, expect, it } from 'vitest';
import { buildMotifMap } from '../src/core/motif/map';
import { normalizeParams } from '../src/core/params/normalize';
import { PERSIAN_TILINGS, type VaseParamsInput } from '../src/core/params/schema';
import {
  chooseDirection,
  hankin,
  horizontalShare,
  polygonsIn,
  PRESETS as PERSIAN,
  stripSegments,
  strapHalfMm,
  tiling,
} from '../src/core/persian';
import { analyze, buildDesign } from '../src/core/printability';
import { checkManifold } from '../src/core/printability/sanity';
import { buildSleeveMesh } from '../src/core/sleeve';
import { PRESETS } from '../src/presets';
import { expectSoundSleeve } from './sleeveHelpers';

const area = (p: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

describe('tilings', () => {
  it.each(PERSIAN_TILINGS)('%s: unit edges, CCW polygons that fill the plane', (id) => {
    const t = tiling(id);
    for (const p of t.cell)
      for (let k = 0; k < p.length; k++) {
        const [x0, y0] = p[k];
        const [x1, y1] = p[(k + 1) % p.length];
        expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(1, 9);
      }
    for (const p of t.cell) expect(area(p)).toBeGreaterThan(0);
    const cellArea = Math.abs(t.a[0] * t.b[1] - t.a[1] * t.b[0]);
    if (!t.gaps) {
      expect(t.cell.reduce((s, p) => s + area(p), 0)).toBeCloseTo(cellArea, 6);
    } else {
      // decagons + their gaps: count the gaps whose centre falls in one lattice cell of a large patch
      const polys = polygonsIn(t, [-20, -20, 20, 20]);
      const filled = polys.reduce((s, p) => s + area(p), 0);
      const dec = polys.filter((p) => p.length === 10).length;
      expect(Math.abs(filled / dec / cellArea - 1)).toBeLessThan(0.02);
    }
  });
});

describe("Hankin's polygons in contact", () => {
  it('45° in a square gives the rotated square (collinear rays joined), every ray used', () => {
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]; // prettier-ignore
    const segs = hankin(sq, 45, 0);
    expect(segs).toHaveLength(8);
    for (const s of segs) {
      expect(Math.abs(s.a[0] - 0.5) < 1e-9 || Math.abs(s.a[1] - 0.5) < 1e-9).toBe(true);
    }
  });

  it('regular polygons give n-point stars: 2n segments meeting on one circle inside', () => {
    for (const id of ['4.8.8', '4.6.12'] as const) {
      const big = tiling(id).cell[0];
      const n = big.length;
      const segs = hankin(big, 60, 0);
      expect(segs).toHaveLength(2 * n);
      const cx = big.reduce((s, v) => s + v[0], 0) / n;
      const cy = big.reduce((s, v) => s + v[1], 0) / n;
      const r = segs.map((s) => Math.hypot(s.b[0] - cx, s.b[1] - cy));
      for (const x of r) expect(x).toBeCloseTo(r[0], 6);
    }
  });

  it('auto-rotate never picks a direction with more horizontal straps than the default', () => {
    for (const name of Object.keys(PERSIAN) as (keyof typeof PERSIAN)[]) {
      const cfg = PERSIAN[name];
      const t = tiling(cfg.tiling);
      const fixed = chooseDirection(t, { autoRotate: false }, 0, cfg.angle, cfg.offset);
      const auto = chooseDirection(t, { autoRotate: true }, 0, cfg.angle, cfg.offset);
      const h = (d: typeof fixed) => horizontalShare(stripSegments(t, d.w, cfg.angle, cfg.offset, [0, 0, d.P, d.P]));
      expect(h(auto)).toBeLessThanOrEqual(h(fixed) + 1e-9);
    }
  });
});

const persian = (persian: object, extra: VaseParamsInput = {}, base = PRESETS[2].params) =>
  normalizeParams({ ...base, motif: { source: 'persian', repeatsAround: 5, persian }, ...extra });

describe('Persian pattern on the body', () => {
  it.each(Object.keys(PERSIAN))('%s: no seam at 0 / 2π and exactly periodic around', (name) => {
    const p = persian({ preset: name });
    const map = buildMotifMap(p, p.dimensions.height, 50)!;
    const per = map.nx / 5;
    expect(Number.isInteger(per)).toBe(true);
    let neg = 0;
    for (let j = 0; j < map.nz; j += 7)
      for (let i = 0; i < map.nx; i += 3) {
        const c = j * map.nx + i;
        expect(map.d[j * map.nx + ((i + per) % map.nx)]).toBeCloseTo(map.d[c], 4);
        if (map.d[c] < 0) neg++;
      }
    expect(neg).toBeGreaterThan(50);
    // the sampler wraps: just below 2π reads the same as just below 0
    const z = p.dimensions.height / 2;
    expect(map.at(2 * Math.PI - 1e-4, z)).toBeCloseTo(map.at(-1e-4, z), 4);
  });

  it('strap width holds the minimum: two lines for relief, the bridge width for sleeve openings', () => {
    const p = persian({ preset: 'khatam', strapWidth: 0.8 });
    expect(strapHalfMm(p)).toBe(p.print.lineWidth);
    const map = buildMotifMap(p, p.dimensions.height, 50)!;
    const deepest = map.d.reduce((a, b) => Math.min(a, b), 0);
    expect(-deepest).toBeGreaterThan(0.9 * p.print.lineWidth);
    const s = persian(
      { preset: 'khatam', strapWidth: 1 },
      { print: { outputMode: 'sleeve' }, sleeve: { holes: { mode: 'pattern', minBridgeWidth: 6 } } },
    );
    expect(strapHalfMm(s)).toBe(3);
  });

  it('interlace steps one strand down at the crossings, periodically', () => {
    const p = persian({ preset: 'khatam', interlace: true, strapWidth: 3 });
    const map = buildMotifMap(p, p.dimensions.height, 50)!;
    expect(map.lvl).not.toBeNull();
    let low = 0;
    const per = map.nx / 5;
    for (let c = 0; c < map.lvl!.length; c++) {
      if (map.lvl![c] < 1) low++;
      const i = c % map.nx;
      expect(map.lvl![c - i + ((i + per) % map.nx)]).toBe(map.lvl![c]);
    }
    expect(low).toBeGreaterThan(20);
  });

  it('constant cell size: the repeat count follows the radius, with no jumps between rows', () => {
    const base = normalizeParams({ ...PRESETS[2].params, profile: { preset: 'teardrop', strength: 70 } });
    const p = persian({ preset: 'star12', sizing: 'cellSize', cellSize: 30 }, {}, base);
    const map = buildMotifMap(p, p.dimensions.height, 50, 3, (z) => 20 + (40 * z) / p.dimensions.height)!;
    let worst = 0;
    for (let j = 1; j < map.nz; j++)
      for (let i = 0; i < map.nx; i += 5)
        worst = Math.max(worst, Math.abs(map.d[j * map.nx + i] - map.d[(j - 1) * map.nx + i]));
    expect(worst).toBeLessThan(2);
  });

  it('relief straps on a vase are manifold for every tiling (2 mm drag grid)', () => {
    for (const tiling of PERSIAN_TILINGS) {
      const p = persian(
        { preset: 'custom', tiling, contactAngle: tiling.startsWith('girih') ? 54 : 62 },
        {
          effects: [{ type: 'motif', relief: 'both', depth: 1, softness: 1.2 }],
        },
      );
      const b = buildDesign(p, 'low');
      expect(checkManifold(b.mesh).manifold, tiling).toBe(true);
    }
  });
});

describe('Persian openings in sleeves (cells open, straps are bridges)', () => {
  const sleeve = (persianCfg: object, holes: object = {}) => {
    const base = PRESETS.find((x) => x.id === 'sleeve-starter')!.params;
    return normalizeParams({
      ...base,
      motif: { source: 'persian', repeatsAround: 4, persian: { strapWidth: 4, autoRotate: true, ...persianCfg } },
      sleeve: { ...base.sleeve, holes: { ...base.sleeve.holes, mode: 'pattern', ...holes } },
    });
  };

  it.each(PERSIAN_TILINGS)('%s: one sound body at 2 mm, straps ≥ min bridge', (tiling) => {
    const p = sleeve({ preset: 'custom', tiling, contactAngle: tiling.startsWith('girih') ? 54 : 62 });
    const b = buildSleeveMesh(p, 2);
    expectSoundSleeve(b, tiling);
    const s = b.mesh.sleeve.holes!;
    expect(s.holes).toBeGreaterThan(0);
    expect(s.thinBridges).toBeNull();
    expect(s.minBridge).toBeGreaterThanOrEqual(p.sleeve.holes.minBridgeWidth - 1);
  });

  it('girih at the 0.5 mm export voxel: one sound body, bore pass', () => {
    const p = sleeve({ preset: 'girih10' });
    const b = buildSleeveMesh(p, 0.5);
    expectSoundSleeve(b, 'girih 0.5');
    expect(analyze(b, p).issues.map((i) => i.id)).toContain('bore-ok');
  });

  it('exact geometry (teardrop off) reports the overhang; printable mode (teardrop on) keeps roofs printable', () => {
    const exact = sleeve({ preset: 'khatam', autoRotate: false }, { teardropTops: false });
    const printable = sleeve({ preset: 'khatam', autoRotate: false }, { teardropTops: true });
    const re = analyze(buildSleeveMesh(exact, 2), exact);
    const rp = analyze(buildSleeveMesh(printable, 2), printable);
    expect(re.overhang.redFraction).toBeGreaterThanOrEqual(rp.overhang.redFraction);
  });
});
