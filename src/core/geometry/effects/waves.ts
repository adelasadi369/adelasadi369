import { DEG, TAU } from '../../math';
import type { Effect } from '../../params/schema';
import type { OffsetFn } from './types';

type Waves = Extract<Effect, { type: 'waves' }>;

export function wavesOffset(e: Waves): OffsetFn {
  if (e.amplitude === 0) return () => 0;
  const A = e.amplitude;
  const fz = TAU * e.freqZ;
  const ft = e.freqTheta;
  const ph = e.phase * DEG;
  return (thetaW, _c, _s, t) => A * Math.sin(fz * t + ft * thetaW + ph);
}
