import { DEG } from '../../math';
import { mulberry32 } from '../../random';
import type { Effect } from '../../params/schema';
import type { ModifyFn, PrevEval } from './types';

type Glitch = Extract<Effect, { type: 'glitch' }>;

interface Band {
  z0: number;
  z1: number;
  dr: number;
  dth: number;
  ramp: number;
}

/**
 * Glitch bands: seeded horizontal bands whose section is rotated by Δθ and pushed by Δr.
 * Band edges ramp over |Δr|/tan(α_max) + 0.5 mm so ledges are never horizontal.
 */
export function glitchModifier(
  e: Glitch,
  height: number,
  refRadius: number,
  maxOverhang: number,
  prev: PrevEval,
): { modify: ModifyFn; rowBreaks: number[]; bands: Band[] } {
  const rnd = mulberry32(e.seed);
  const zs = (e.start / 100) * height;
  const ze = (e.end / 100) * height;
  const tanA = Math.tan(Math.min(80, maxOverhang) * DEG);
  const bands: Band[] = [];
  let attempts = 0;
  while (bands.length < e.bands && attempts++ < e.bands * 20) {
    const h = 3 + rnd() * 9;
    const z0 = zs + rnd() * Math.max(0, ze - zs - h);
    const z1 = z0 + h;
    const dr = (2 * rnd() - 1) * e.maxOffset;
    const dth = (2 * rnd() - 1) * e.maxShift * DEG;
    const ramp = (Math.abs(dr) + Math.abs(dth) * refRadius * 0.3) / tanA + 0.5;
    if (z1 - z0 < 2 * ramp + 0.5) continue;
    if (bands.some((b) => z0 < b.z1 + 0.5 && z1 > b.z0 - 0.5)) continue;
    bands.push({ z0, z1, dr, dth, ramp });
  }
  bands.sort((a, b) => a.z0 - b.z0);
  const rowBreaks: number[] = [];
  for (const b of bands)
    rowBreaks.push(b.z0 / height, (b.z0 + b.ramp) / height, (b.z1 - b.ramp) / height, b.z1 / height);

  const modify: ModifyFn = (thetaW, _c, _s, t, v) => {
    const z = t * height;
    for (const b of bands) {
      if (z < b.z0 || z > b.z1) continue;
      const w = Math.min(1, (z - b.z0) / b.ramp, (b.z1 - z) / b.ramp);
      if (w <= 0) return v;
      const shifted = b.dth !== 0 ? prev(thetaW - b.dth * w, t) : v;
      return shifted + b.dr * w;
    }
    return v;
  };
  return { modify, rowBreaks, bands };
}
