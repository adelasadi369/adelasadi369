import { describe, expect, it } from 'vitest';
import { BORE_TOLERANCE } from '../src/core/insert';
import { normalizeParams } from '../src/core/params/normalize';
import { DEFAULT_PARAMS, type VaseParamsInput } from '../src/core/params/schema';
import { analyze } from '../src/core/printability';
import { measureSleeveBore } from '../src/core/printability/sleeve';
import { buildSleeveMesh, DRAG_VOXEL, meshVoxel } from '../src/core/sleeve';
import { createSleeveField, type SleeveField } from '../src/core/sleeve/field';
import { PRESETS } from '../src/presets';
import { slice } from './helpers';
import { expectSoundSleeve } from './sleeveHelpers';

/** Straight Ø100 sleeve around a Ø50 glass tube (gap ≈ 22 mm between core and skin). */
const shell = (sleeve: VaseParamsInput['sleeve'] = {}, extra: VaseParamsInput = {}) =>
  normalizeParams({
    dimensions: { height: 150, baseDiameter: 100, topDiameter: 100, maxDiameter: 100 },
    profile: { preset: 'straight' },
    ...extra,
    print: { outputMode: 'sleeve' },
    insert: { od: 50 },
    sleeve,
  });

/** Material intervals [from, to] along the radial ray at angle φ, height z. */
function intervals(f: SleeveField, phi: number, z: number, step = 0.02): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let r = 0.5; r < f.reach + 2; r += step) {
    const inside = f.at(r * Math.cos(phi), r * Math.sin(phi), z) < 0;
    if (inside && start < 0) start = r;
    if (!inside && start >= 0) {
      out.push([start, r]);
      start = -1;
    }
  }
  return out;
}

describe('thin draped shell: params', () => {
  it('new designs get 2.4 mm, stored v5 designs stay solid, 0 < T < 1.6 snaps to 1.6', () => {
    expect(DEFAULT_PARAMS.sleeve.skinThickness).toBe(2.4);
    expect(normalizeParams({ version: 5, print: { outputMode: 'sleeve' } }).sleeve.skinThickness).toBe(0);
    expect(normalizeParams({ version: 5, sleeve: { skinThickness: 3 } }).sleeve.skinThickness).toBe(3);
    expect(normalizeParams({ sleeve: { skinThickness: 1 } }).sleeve.skinThickness).toBe(1.6);
    expect(normalizeParams({ sleeve: { skinThickness: 0 } }).sleeve.skinThickness).toBe(0);
    expect(normalizeParams({ sleeve: { skinThickness: 9 } }).sleeve.skinThickness).toBe(6);
    expect(DEFAULT_PARAMS.sleeve.fingers.crossSection).toBe('round');
  });

  it('meshes a thin shell with ≥ 1.5 samples across the thinner of skin and core wall', () => {
    expect(meshVoxel(shell({ skinThickness: 0 }), 2)).toBe(2);
    expect(meshVoxel(shell({ skinThickness: 2.4 }), 2)).toBeCloseTo(2 / 1.5);
    expect(meshVoxel(shell({ skinThickness: 6 }), 0.5)).toBe(0.5);
  });
});

describe('thin draped shell: field', () => {
  const p = shell({ skinThickness: 2.4 });
  const f = createSleeveField(p, 1);
  const T = p.sleeve.skinThickness;

  it('core tube and a T-thick shell at the skin, with an open gap between them', () => {
    for (const phi of [0, 1, 2.5, 4]) {
      const iv = intervals(f, phi, 75);
      expect(iv).toHaveLength(2);
      const [core, sk] = iv;
      expect(core[0]).toBeCloseTo(f.R, 1);
      expect(core[1]).toBeLessThan(f.Rc + 1);
      expect(sk[1]).toBeCloseTo(50, 0);
      expect(sk[1] - sk[0]).toBeGreaterThan(T - 0.1);
      expect(sk[1] - sk[0]).toBeLessThan(T + 0.1);
    }
  });

  it('the floor ring closes the gap at the bottom; the gap is open just below the rim', () => {
    expect(f.zFloor).toBe(Math.max(p.sleeve.holes.keepOutBottom, 3));
    for (const phi of [0, 2, 4]) {
      expect(intervals(f, phi, f.zFloor / 2)).toHaveLength(1);
      expect(intervals(f, phi, f.H - 4)).toHaveLength(2);
    }
  });

  it('T = 0 keeps the solid sleeve: one interval from the bore to the skin', () => {
    const s = createSleeveField(shell({ skinThickness: 0 }), 1);
    const iv = intervals(s, 1, 75);
    expect(iv).toHaveLength(1);
    expect(iv[0][1]).toBeCloseTo(50, 0);
  });

  it('holes cut through both the shell and the core', () => {
    const h = createSleeveField(shell({ skinThickness: 2.4, holes: { mode: 'organicNoise', coverage: 25 } }), 1);
    let checked = 0;
    for (let a = 0; a < 90 && checked < 20; a++)
      for (let z = 30; z < 120 && checked < 20; z += 3) {
        const phi = (a / 90) * 2 * Math.PI;
        if (h.holes!.at(phi, z) > -3) continue;
        expect(intervals(h, phi, z, 0.1)).toEqual([]);
        checked++;
      }
    expect(checked).toBe(20);
  });
});

describe('thin draped shell: mesh and report', () => {
  it('one sound body, exact bore, walls ≥ two lines, far lighter than solid', () => {
    const p = shell({ skinThickness: 2.4, holes: { mode: 'organicNoise', coverage: 15 } });
    const b = buildSleeveMesh(p, 1);
    expectSoundSleeve(b);
    const m = measureSleeveBore(b);
    expect(m.deviation).toBeLessThanOrEqual(BORE_TOLERANCE);
    expect(m.sag).toBeLessThanOrEqual(BORE_TOLERANCE);
    const r = analyze(b, p);
    expect(r.issues.map((i) => i.id)).not.toContain('sleeve-wall');
    expect(r.issues.map((i) => i.id)).toContain('bore-ok');
    expect(r.score).toBeGreaterThanOrEqual(90);
    // three walls in a slice above the floor ring: bore, core outside, shell inside, shell outside
    expect(slice(b.mesh, 75).loops.length).toBeGreaterThanOrEqual(4);
    const solid = shell({ skinThickness: 0, holes: { mode: 'organicNoise', coverage: 15 } });
    const rs = analyze(buildSleeveMesh(solid, 1), solid);
    expect(r.stats.weightG).toBeLessThan(0.45 * rs.stats.weightG);
    expect(r.stats.printMinutes).toBeLessThan(0.6 * rs.stats.printMinutes);
  });

  it('the inner face is self-supporting where the skin leans inward (thicker below, never red)', () => {
    // a cone narrowing from Ø130 to Ø64 over 120 mm: the inner face would lean over the gap at ≈ 15°… and the
    // flare zone of a teardrop profile much steeper
    const p = normalizeParams({
      dimensions: { height: 140, baseDiameter: 110, maxDiameter: 140, topDiameter: 60, bellyPosition: 20 },
      profile: { preset: 'teardrop', strength: 80 },
      print: { outputMode: 'sleeve' },
      insert: { od: 40 },
      sleeve: { skinThickness: 2.4 },
    });
    const b = buildSleeveMesh(p, DRAG_VOXEL);
    expectSoundSleeve(b);
    expect(analyze(b, p).issues.filter((i) => i.id.startsWith('overhang-red'))).toEqual([]);
  });
});

describe('ribbon fingers', () => {
  const p = (cs: 'round' | 'ribbon') =>
    shell({
      skinThickness: 2.4,
      fingers: { count: 5, width: 24, freeLength: 70, lean: 0, curl: 0, taper: 20, crossSection: cs, ribbonRatio: 4 },
    });

  it('are squashed radially by the ratio (thickness ≈ width / ratio), never below two lines', () => {
    const f = createSleeveField(p('ribbon'), 1);
    expect(f.strands.list.every((s) => s.ribbon === 4)).toBe(true);
    const z = (f.strands.zBody + f.H) / 2 - 10;
    const fg = f.strands.list[0];
    // the path sample nearest z gives the finger's centre and radius there
    let k = 0;
    while (fg.pts[k * 3 + 5] < z) k++;
    const cx = fg.pts[k * 3];
    const cy = fg.pts[k * 3 + 1];
    const rad = fg.rad[k];
    const rho = Math.hypot(cx, cy);
    const ux = cx / rho;
    const uy = cy / rho;
    const extent = (dx: number, dy: number) => {
      let a = 0;
      while (f.strands.at(cx + dx * a, cy + dy * a, fg.pts[k * 3 + 2]) < 0) a += 0.02;
      let b = 0;
      while (f.strands.at(cx - dx * b, cy - dy * b, fg.pts[k * 3 + 2]) < 0) b += 0.02;
      return a + b;
    };
    const thick = extent(ux, uy);
    const wide = extent(-uy, ux);
    expect(thick).toBeCloseTo((2 * rad) / 4, 0);
    // measured along the straight tangent, which leaves the ribbon's arc (it curves with the tube): a bit less
    expect(wide).toBeGreaterThan(0.85 * 2 * rad);
    expect(wide).toBeLessThanOrEqual(2 * rad + 0.05);
    expect(thick).toBeGreaterThanOrEqual(2 * f.strands.rMin - 0.05);
    // the outer face follows the skin (Ø100) at the body cap
    expect(rho + rad / 4).toBeGreaterThan(45);
  });

  it('a ribbon finger sleeve is one sound body and lighter than round fingers', () => {
    const pr = p('ribbon');
    const b = buildSleeveMesh(pr, DRAG_VOXEL);
    expectSoundSleeve(b);
    const round = p('round');
    const vr = analyze(b, pr).stats.materialCm3;
    const vo = analyze(buildSleeveMesh(round, DRAG_VOXEL), round).stats.materialCm3;
    expect(vr).toBeLessThan(vo);
  });
});

describe('S4 presets', () => {
  it.each(['sleeve-silk-drape', 'sleeve-windswept', 'sleeve-fingers', 'sleeve-molten'])(
    '%s uses the thin shell',
    (id) => {
      const pp = PRESETS.find((x) => x.id === id)!.params;
      expect(pp.sleeve.skinThickness).toBeGreaterThan(0);
    },
  );
  it('sleeve-fingers uses ribbon fingers', () => {
    expect(PRESETS.find((x) => x.id === 'sleeve-fingers')!.params.sleeve.fingers.crossSection).toBe('ribbon');
  });
});
