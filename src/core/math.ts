export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const frac = (x: number) => x - Math.floor(x);
/** Unit triangle wave: 1 at integers, 0 at half-integers. */
export const tri = (x: number) => 1 - 2 * Math.abs(frac(x) - 0.5);

export function smoothstep(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const u = clamp((x - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
}

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'sine';
export function ease(kind: Easing, t: number): number {
  switch (kind) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t * t * (3 - 2 * t);
    case 'sine':
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
}
