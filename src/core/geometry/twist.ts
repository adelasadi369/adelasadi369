import { DEG, TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { monotoneSpline } from './spline';

/** Twist angle in radians as a function of t. */
export function buildTwist(tw: VaseParams['twist']): (t: number) => number {
  const total = tw.total * DEG;
  if (total === 0) return () => 0;
  switch (tw.curve) {
    case 'linear':
      return (t) => total * t;
    case 'easeIn':
      return (t) => total * t * t;
    case 'easeOut':
      return (t) => total * (1 - (1 - t) * (1 - t));
    case 'easeInOut':
      return (t) => total * t * t * (3 - 2 * t);
    case 'sineBackForth': {
      const osc = tw.oscillations;
      return (t) => total * Math.sin(TAU * osc * t);
    }
    case 'custom': {
      const s = monotoneSpline(tw.customCurve.map((p) => ({ t: p.t / 100, r: p.v })));
      return (t) => total * s(t);
    }
  }
}

/** Inward-normalised lobes: max = 1, valleys 1 − depth. */
export function buildLobes(lobes: VaseParams['twist']['lobes']): ((thetaW: number, t: number) => number) | null {
  const n = lobes.count;
  const d = lobes.depth / 100;
  if (n === 0 || d === 0) return null;
  const sw = TAU * lobes.swirl;
  return (thetaW, t) => 1 - (d * (1 - Math.cos(n * thetaW + sw * t))) / 2;
}
