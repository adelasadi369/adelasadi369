import { createSimplex3, fbm3 } from '../../random';
import type { Effect } from '../../params/schema';
import type { EffectCtx, OffsetFn } from './types';

type Organic = Extract<Effect, { type: 'organic' }>;

/**
 * softBulges: low-frequency fBm. silkFolds: vertically stretched ridged noise (1 − |n|)².
 * blobs: domain-warped fBm, q' = q + warp · (n_x, n_y, n_z)(0.3·q), vertically stretched; lumps lean and merge.
 */
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
  if (e.style === 'blobs') {
    const W = e.warp;
    return (_t, c, s, t) => {
      const x = k * c;
      const y = k * s;
      const z = kz * t;
      // the warp field is smoother than the lumps (0.3 ×) so warp 1 bends them without folding the domain over
      const wx = noise(0.3 * x + 31.7, 0.3 * y, 0.3 * z);
      const wy = noise(0.3 * x, 0.3 * y + 47.3, 0.3 * z);
      const wz = noise(0.3 * x, 0.3 * y, 0.3 * z + 73.1);
      return A * fbm3(noise, x + W * wx, y + W * wy, z + W * wz, 2);
    };
  }
  return (_t, c, s, t) => {
    const n = noise(k * c, k * s, kz * t) * 0.75 + noise(2 * k * c + 17, 2 * k * s, 2 * kz * t) * 0.25;
    const r = 1 - Math.abs(n);
    return A * (r * r - 0.5);
  };
}
