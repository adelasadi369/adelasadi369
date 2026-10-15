import { TAU, frac, smoothstep } from '../../math';
import type { Effect } from '../../params/schema';
import type { OffsetFn } from './types';

type Ribs = Extract<Effect, { type: 'ribs' }>;

const PROFILES: Record<Ribs['profile'], (x: number) => number> = {
  V: (x) => 1 - Math.abs(x),
  round: (x) => Math.sqrt(Math.max(0, 1 - x * x)),
  flat: () => 1,
  softSquare: (x) => smoothstep(0, 0.3, 1 - Math.abs(x)),
};

export function ribsOffset(e: Ribs): OffsetFn {
  const n = e.count;
  if (n === 0 || e.depth === 0) return () => 0;
  const p = PROFILES[e.profile];
  const half = e.widthRatio / 2;
  const sign = e.style === 'raised' ? 1 : -1;
  const D = sign * e.depth;
  const h = e.helixTurns;
  const at = (u: number) => {
    const x = (frac(u) - 0.5) / half;
    return x < -1 || x > 1 ? 0 : p(x);
  };
  if (e.crisscross && h !== 0) {
    return (thetaW, _c, _s, t) => {
      const base = (n * thetaW) / TAU;
      return D * Math.max(at(base + n * h * t), at(base - n * h * t));
    };
  }
  return (thetaW, _c, _s, t) => D * at(n * (thetaW / TAU + h * t));
}
