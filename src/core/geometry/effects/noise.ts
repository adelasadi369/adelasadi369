import { createSimplex3, fbm3 } from '../../random';
import type { Effect } from '../../params/schema';
import type { EffectCtx, OffsetFn } from './types';

type Noise = Extract<Effect, { type: 'noise' }>;

/** Seamless cylindrical simplex fBm: sampled on (R̄cosθ, R̄sinθ, z) / scale. */
export function noiseOffset(e: Noise, ctx: EffectCtx): OffsetFn {
  if (e.amplitude === 0) return () => 0;
  const noise = createSimplex3(e.seed);
  const k = ctx.refRadius / e.scale;
  const kz = ctx.height / e.scale;
  const A = e.amplitude;
  const oct = e.octaves;
  return (_t, cosW, sinW, t) => A * fbm3(noise, k * cosW, k * sinW, kz * t, oct);
}
