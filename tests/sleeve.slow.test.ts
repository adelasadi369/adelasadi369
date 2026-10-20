// Slow sleeve tests (seconds each). They run in CI with the rest of `npm test`; the file name only marks them.
import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { normalizeParams } from '../src/core/params/normalize';
import { randomize } from '../src/core/params/random';
import { signedVolume } from '../src/core/printability/sanity';
import { buildSleeveMesh, DRAG_VOXEL } from '../src/core/sleeve';
import { PRESETS, VASE_PRESETS } from '../src/presets';
import { expectSoundSleeve, sleeveParams, strandWall } from './sleeveHelpers';

const SLOW = 120_000;

/** Seeded random designs (same generator as the Randomize button) turned into sleeves. */
const randomSleeve = (seed: number) => {
  const base = VASE_PRESETS[seed % VASE_PRESETS.length].params;
  return sleeveParams(randomize({ ...base, random: { ...base.random, seed, locks: [] } }, seed));
};

describe('sleeve mode: every preset at the preview voxel (1.0 mm)', () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))(
    '%s: manifold, one body',
    (_id, preset) => {
      const b = buildSleeveMesh(sleeveParams(preset.params), 1);
      expectSoundSleeve(b, preset.id);
      expect(b.mesh.sleeve.islands.removedFraction).toBeLessThan(0.01);
    },
    SLOW,
  );
});

describe('sleeve mode: random seeds', () => {
  it(
    '20 seeds at the drag voxel (2 mm)',
    () => {
      for (let seed = 1; seed <= 20; seed++)
        expectSoundSleeve(buildSleeveMesh(randomSleeve(seed), DRAG_VOXEL), `seed ${seed}`);
    },
    SLOW,
  );
  it(
    '5 seeds at the preview voxel (1.0 mm)',
    () => {
      for (let seed = 101; seed <= 105; seed++)
        expectSoundSleeve(buildSleeveMesh(randomSleeve(seed), 1), `seed ${seed}`);
    },
    SLOW,
  );
});

describe('sleeve mode: export voxel (0.5 mm), what actually gets printed', () => {
  it.each(['japandi-ribbed', 'silk-drape', 'stone-glitch'])(
    '%s',
    (id) => {
      const p = sleeveParams(PRESETS.find((x) => x.id === id)!.params);
      const b = buildSleeveMesh(p, p.sleeve.mesh.exportVoxel);
      expect(b.mesh.sleeve.voxel).toBe(0.5);
      expectSoundSleeve(b, id);
    },
    SLOW,
  );
});

describe('cross-check with the S1 shell + bore liner', () => {
  it.each(['twisted-hex', 'fluted-column', 'planter-classic'])(
    '%s: sleeve volume within 3 % of shell + bore',
    (id) => {
      const preset = PRESETS.find((x) => x.id === id)!.params;
      // like for like: flat rim and no outer base chamfer on the shell side, same insert and chamfers
      const common = { ...preset, rim: { ...preset.rim, round: false }, base: { ...preset.base, chamfer: 0 } };
      const sleeve = sleeveParams(common);
      const shell = normalizeParams({
        ...common,
        insert: sleeve.insert,
        print: { ...preset.print, outputMode: 'shell', innerSurface: 'bore' },
      });
      const vs = signedVolume(buildSleeveMesh(sleeve, 1).mesh);
      const vb = signedVolume(buildMesh(shell, 'high').mesh);
      expect(Math.abs(vs / vb - 1)).toBeLessThan(0.03);
    },
    SLOW,
  );
});

/** Random sleeves with organic holes (coverage 10–34 %) and 0–3 rim peaks, seeded. */
const holedSleeve = (seed: number) => {
  const p = randomSleeve(seed);
  return normalizeParams({
    ...p,
    sleeve: {
      ...p.sleeve,
      holes: { ...p.sleeve.holes, mode: 'organicNoise', coverage: 10 + (seed % 4) * 8 },
      topEdge: { ...p.sleeve.topEdge, peakCount: seed % 4, amplitude: 25 },
    },
  });
};

describe('sleeve holes: manifold across random seeds', () => {
  it(
    '10 seeds with holes at the drag voxel (2 mm)',
    () => {
      for (let seed = 201; seed <= 210; seed++) {
        const b = buildSleeveMesh(holedSleeve(seed), DRAG_VOXEL);
        expectSoundSleeve(b, `seed ${seed}`);
        expect(b.mesh.sleeve.holes!.thinBridges, `seed ${seed}`).toBeNull();
      }
    },
    SLOW,
  );
  it(
    '3 seeds with holes at 1.0 mm',
    () => {
      for (let seed = 301; seed <= 303; seed++)
        expectSoundSleeve(buildSleeveMesh(holedSleeve(seed), 1), `seed ${seed}`);
    },
    SLOW,
  );
  it(
    'sleeve-starter at the export voxel (0.5 mm)',
    () => {
      const p = PRESETS.find((x) => x.id === 'sleeve-starter')!.params;
      const b = buildSleeveMesh(p, p.sleeve.mesh.exportVoxel);
      expectSoundSleeve(b, 'sleeve-starter');
      expect(b.mesh.sleeve.islands.removedFraction).toBeLessThan(0.01);
    },
    SLOW,
  );
});

/** Random sleeves with fingers (3–8, any lean/curl/twist/tip/taper) and some drips, seeded. */
const fingered = (seed: number) => {
  const p = randomSleeve(seed);
  const r = (k: number) => ((seed * 7919 + k * 104729) % 1000) / 1000;
  return normalizeParams({
    ...p,
    sleeve: {
      ...p.sleeve,
      fingers: {
        count: 3 + (seed % 6),
        width: 6 + 18 * r(1),
        widthVariation: 100 * r(2),
        freeLength: 20 + 100 * r(3),
        lean: 40 * r(4),
        curl: -40 + 80 * r(5),
        twist: -180 + 360 * r(6),
        taper: 80 * r(7),
        tipShape: (['round', 'pointed', 'dripBulb'] as const)[seed % 3],
      },
      drips: { count: seed % 5, placement: (['rim', 'fingers', 'random'] as const)[seed % 3], bulbSize: 4 + 12 * r(8) },
    },
  });
};

describe('fingers and drips: connected and thick enough across random seeds', () => {
  it(
    '10 seeds at the drag voxel (2 mm)',
    () => {
      for (let seed = 401; seed <= 410; seed++) {
        const p = fingered(seed);
        const b = buildSleeveMesh(p, DRAG_VOXEL);
        expectSoundSleeve(b, `seed ${seed}`);
        expect(b.mesh.sleeve.islands.removedFraction, `seed ${seed}`).toBeLessThan(0.01);
        expect(strandWall(b), `seed ${seed}`).toBeGreaterThanOrEqual(2 * p.print.lineWidth);
      }
    },
    SLOW,
  );
  it(
    '2 seeds at 1.0 mm',
    () => {
      for (let seed = 501; seed <= 502; seed++) {
        const p = fingered(seed);
        const b = buildSleeveMesh(p, 1);
        expectSoundSleeve(b, `seed ${seed}`);
        expect(b.mesh.sleeve.islands.removedFraction, `seed ${seed}`).toBeLessThan(0.01);
        expect(strandWall(b), `seed ${seed}`).toBeGreaterThanOrEqual(2 * p.print.lineWidth);
      }
    },
    SLOW,
  );
});
