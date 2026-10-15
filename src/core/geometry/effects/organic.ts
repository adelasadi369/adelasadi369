import { createSimplex3, fbm3 } from '../../random';
import type { Effect } from '../../params/schema';
import type { EffectCtx, OffsetFn } from './types';

type Organic = Extract<Effect, { type: 'organic' }>;

/** softBulges: low-frequency fBm. silkFolds: vertically stretched ridged noise (1 − |n|)². */
export function organicOffset(e: Organic, ctx: EffectCtx): OffsetFn {
  if (e.amount === 0) return () => 0;
  const noise = createSimplex3(e.seed);
  const k = ctx.refRadius / e.scale;
  const A = e.amount;
  if (e.style === 'softBulges') {
    const kz = ctx.height / e.scale;
    return (_t, c, s, t) => A * fbm3(noise, k * c, k * s, kz * t, 2);
  }
  const kz = ctx.height / (e.scale * e.stretch);
  return (_t, c, s, t) => {
    const n = noise(k * c, k * s, kz * t) * 0.75 + noise(2 * k * c + 17, 2 * k * s, 2 * kz * t) * 0.25;
    const r = 1 - Math.abs(n);
    return A * (r * r - 0.5);
  };
}
