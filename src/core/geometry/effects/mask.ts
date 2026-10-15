import { smoothstep } from '../../math';

/** Height window with internal fade (fractions of height). */
export function windowMask(start: number, end: number, fade: number): (t: number) => number {
  const s = start / 100;
  const e = end / 100;
  const f = fade / 100;
  if (s <= 0 && e >= 1 && f === 0) return () => 1;
  return (t) => {
    if (t < s || t > e) return 0;
    if (f === 0) return 1;
    return smoothstep(s, s + f, t) * (1 - smoothstep(e - f, e, t));
  };
}
