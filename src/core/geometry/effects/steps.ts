import { TAU } from '../../math';
import type { Effect } from '../../params/schema';
import type { ModifyFn, PrevEval } from './types';

type Steps = Extract<Effect, { type: 'steps' }>;

const SAMPLES = 2048;

/**
 * Terraces: inside step k the radius is frozen at level t_k; in the upper `bevel` fraction it ramps
 * linearly to level t_{k+1}. Levels are cached as θ-rings so evaluation is O(1) per vertex.
 */
export function stepsModifier(e: Steps, prev: PrevEval): { modify: ModifyFn; rowBreaks: number[] } {
  const s = e.start / 100;
  const en = e.end / 100;
  const c = e.count;
  const b = e.bevel / 100;
  const levels: Float64Array[] = [];
  const rowBreaks: number[] = [];
  for (let k = 0; k <= c; k++) {
    const t = s + ((en - s) * k) / c;
    const ring = new Float64Array(SAMPLES + 1);
    for (let i = 0; i <= SAMPLES; i++) ring[i] = prev((TAU * i) / SAMPLES, Math.min(t, 1));
    levels.push(ring);
    rowBreaks.push(t);
    if (k < c && b > 0 && b < 1) rowBreaks.push(s + ((en - s) * (k + 1 - b)) / c);
  }
  const at = (ring: Float64Array, thetaW: number) => {
    let u = (thetaW / TAU) % 1;
    if (u < 0) u += 1;
    const x = u * SAMPLES;
    const i = Math.floor(x);
    return ring[i] + (ring[i + 1] - ring[i]) * (x - i);
  };
  const modify: ModifyFn = (thetaW, _c, _s, t, v) => {
    if (t < s || t > en) return v;
    const w = ((t - s) / (en - s)) * c;
    const k = Math.min(c - 1, Math.floor(w));
    const sigma = w - k;
    const r0 = at(levels[k], thetaW);
    if (b <= 0 || sigma < 1 - b) return r0;
    const u = (sigma - (1 - b)) / b;
    return r0 + (at(levels[k + 1], thetaW) - r0) * u;
  };
  return { modify, rowBreaks };
}
