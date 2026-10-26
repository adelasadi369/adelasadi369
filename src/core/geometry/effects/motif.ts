import { buildMotifMap } from '../../motif/map';
import type { Effect } from '../../params/schema';
import type { EffectCtx, OffsetFn } from './types';

type MotifEffect = Extract<Effect, { type: 'motif' }>;

/**
 * Relief from the Motif block (GEOMETRY.md §14): s = smoothstep of the signed distance over the edge softness
 * (1 inside the motif, 0 outside), sampled at the warped angle, so the motif follows twist like ribs do.
 *   raised    +depth·s·level        level < 1 where an interlaced strap passes under another (Persian, §15)
 *   engraved  −depth·s
 *   both      depth·(s·level − ½)    motif up, background down by half the depth each
 */
export function motifOffset(
  e: MotifEffect,
  ctx: EffectCtx,
): { offset: OffsetFn; repetitions: number; periodic: boolean } {
  const p = ctx.params;
  const map = p ? buildMotifMap(p, ctx.height, ctx.refRadius, Math.max(1.5, e.softness * 2 + 0.5)) : null;
  if (!map || !p) return { offset: () => 0, repetitions: 0, periodic: false };
  const soft = Math.max(0.05, e.softness);
  const H = ctx.height;
  const shape = (d: number) => {
    const u = Math.min(1, Math.max(0, 0.5 - d / soft));
    return u * u * (3 - 2 * u);
  };
  const D = e.depth;
  const offset: OffsetFn =
    e.relief === 'engraved'
      ? (th, _c, _s, t) => -D * shape(map.at(th, t * H))
      : e.relief === 'both'
        ? (th, _c, _s, t) => D * (shape(map.at(th, t * H)) * map.levelAt(th, t * H) - 0.5)
        : (th, _c, _s, t) => D * shape(map.at(th, t * H)) * map.levelAt(th, t * H);
  const repeat = p.motif.placement === 'repeat' || p.motif.source === 'persian';
  return { offset, repetitions: repeat ? p.motif.repeatsAround : 0, periodic: repeat };
}
