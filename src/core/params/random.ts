import { mulberry32 } from '../random';
import { EFFECT_FIELDS, PARAMS, type ParamInfo } from './meta';
import { normalizeParams } from './normalize';
import { getPath, setPath } from './paths';
import type { VaseParams } from './schema';

const PHASE1_SHAPES = ['circle', 'polygon', 'star', 'flower', 'superellipse'];
const SAFE_PROFILES = ['taper', 'convex', 'teardrop', 'jar', 'tulip', 'sCurve', 'bottle', 'amphora', 'straight'];

/** Safe sub-ranges used by randomize/surprise (subset of the schema range). */
const SAFE: Record<string, [number, number]> = {
  'dimensions.height': [120, 220],
  'dimensions.baseDiameter': [60, 110],
  'dimensions.topDiameter': [50, 110],
  'dimensions.maxDiameter': [80, 140],
  'dimensions.neckDiameter': [45, 100],
  'dimensions.bellyPosition': [25, 55],
  'dimensions.neckPosition': [65, 90],
  'profile.strength': [20, 80],
  'twist.total': [-180, 180],
  'twist.lobes.depth': [0, 15],
  'section.bottom.cornerRadius': [1, 5],
  'section.bottom.starInnerRatio': [0.7, 0.9],
  'section.bottom.petalDepth': [5, 25],
};

/** Paths randomize touches (top-level design params; effects get their own fields). */
const RANDOM_PATHS = [
  'dimensions.height', 'dimensions.baseDiameter', 'dimensions.topDiameter', 'dimensions.maxDiameter',
  'dimensions.neckDiameter', 'dimensions.bellyPosition', 'dimensions.neckPosition',
  'profile.preset', 'profile.strength',
  'section.bottom.shape', 'section.bottom.sides', 'section.bottom.cornerRadius', 'section.bottom.starPoints',
  'section.bottom.starInnerRatio', 'section.bottom.petals', 'section.bottom.petalDepth',
  'section.bottom.superellipseExponent', 'section.bottom.aspectXY',
  'twist.total', 'twist.curve', 'twist.lobes.count', 'twist.lobes.depth', 'twist.lobes.swirl',
];

const isLocked = (locks: readonly string[], path: string) => locks.some((l) => path === l || path.startsWith(`${l}.`));

function pick(info: ParamInfo, rnd: () => number, path: string): unknown {
  const [lo, hi] = SAFE[path] ?? [info.meta.min ?? 0, info.meta.max ?? 1];
  switch (info.kind) {
    case 'number': {
      const step = info.meta.step ?? 0.01;
      return Math.round((lo + rnd() * (hi - lo)) / step) * step;
    }
    case 'int':
      return Math.floor(lo + rnd() * (hi - lo + 1));
    case 'bool':
      return rnd() < 0.5;
    case 'enum': {
      let opts = info.options!;
      if (path.endsWith('section.bottom.shape')) opts = PHASE1_SHAPES;
      if (path === 'profile.preset') opts = SAFE_PROFILES;
      if (path === 'twist.curve') opts = opts.filter((o) => o !== 'custom');
      return opts[Math.floor(rnd() * opts.length)];
    }
    default:
      return undefined;
  }
}

/** Randomize the design (not print/render settings), respecting locks. Deterministic for a given seed. */
export function randomize(p: VaseParams, seed = p.random.seed): VaseParams {
  const rnd = mulberry32(seed);
  const locks = p.random.locks;
  let out = p;
  for (const path of RANDOM_PATHS) {
    if (isLocked(locks, path)) continue;
    const info = PARAMS.find((x) => x.path === path)!;
    const v = pick(info, rnd, path);
    if (v !== undefined) out = setPath(out, path, v);
  }
  out.effects.forEach((e, i) => {
    for (const f of EFFECT_FIELDS[e.type]) {
      const path = `effects.${i}.${f.path}`;
      if (['enabled', 'start', 'end', 'fade', 'seed'].includes(f.path) || isLocked(locks, path)) continue;
      if (f.kind !== 'number' && f.kind !== 'int') continue;
      const cur = getPath(out, path) as number;
      // effects: stay within ±60 % of the current value so presets keep their character
      const lo = Math.max(f.meta.min ?? 0, cur * 0.4);
      const hi = Math.min(f.meta.max ?? cur * 1.6, cur * 1.6);
      let v = lo + rnd() * (hi - lo);
      if (f.kind === 'int') v = Math.round(v);
      out = setPath(out, path, v);
    }
    if (!isLocked(locks, `effects.${i}.seed`) && 'seed' in e) out = setPath(out, `effects.${i}.seed`, Math.floor(rnd() * 1e6));
  });
  return normalizeParams(setPath(out, 'random.seed', (seed + 1) >>> 0));
}

/** ±amount (default 10 %) around the current value for every unlocked numeric design parameter. */
export function mutate(p: VaseParams, amount = 0.1, seed = p.random.seed): VaseParams {
  const rnd = mulberry32(seed ^ 0x5bd1e995);
  const locks = p.random.locks;
  let out = p;
  const jitter = (path: string, info: ParamInfo) => {
    if (isLocked(locks, path) || (info.kind !== 'number' && info.kind !== 'int')) return;
    const cur = getPath(out, path) as number;
    const span = (info.meta.max ?? 1) - (info.meta.min ?? 0);
    const delta = (rnd() * 2 - 1) * amount * Math.max(Math.abs(cur), span * 0.05);
    let v = cur + delta;
    if (info.kind === 'int') v = Math.round(v);
    out = setPath(out, path, v);
  };
  for (const path of RANDOM_PATHS) jitter(path, PARAMS.find((x) => x.path === path)!);
  out.effects.forEach((e, i) => {
    for (const f of EFFECT_FIELDS[e.type]) {
      if (['start', 'end', 'fade', 'seed'].includes(f.path)) continue;
      jitter(`effects.${i}.${f.path}`, f);
    }
  });
  return normalizeParams(setPath(out, 'random.seed', (seed + 1) >>> 0));
}
