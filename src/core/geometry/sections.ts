import { TAU } from '../math';
import type { Section } from '../params/schema';
import { periodicSpline } from './spline';

/**
 * Normalised polar section ρ(θ) with max = 1 (circumscribed radius).
 * `cn` = corner radius / R(t) for shapes that have mm-sized corners.
 * See docs/GEOMETRY.md §2.
 */
export interface SectionEval {
  (theta: number, cn: number): number;
  /** Repetitions around the circumference (for auto-raise and feature checks). */
  repetitions: number;
  /** Radial groove depth as a fraction of R (feature-size check). */
  grooveDepth: number;
  /** True when ρ depends on cn (so per-row evaluation is needed). */
  usesCorner: boolean;
}

/** Polar equation of the straight segment between (r1, θ1) and (r2, θ2). */
export function polarLine(r1: number, t1: number, r2: number, t2: number, theta: number): number {
  return (r1 * r2 * Math.sin(t2 - t1)) / (r1 * Math.sin(theta - t1) + r2 * Math.sin(t2 - theta));
}

const wrap = (x: number, period: number) => x - Math.floor(x / period) * period;

function polygon(n: number): (theta: number, cn: number) => number {
  const alpha = Math.PI / n;
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  return (theta, cnRaw) => {
    const c = cnRaw < 0 ? 0 : cnRaw > 1 ? 1 : cnRaw;
    const psi = Math.abs(wrap(theta + alpha, 2 * alpha) - alpha);
    const d = 1 - c;
    if (c > 0) {
      const psiT = Math.atan2(c * sa, d + c * ca);
      if (psi <= psiT) {
        const s = d * Math.sin(psi);
        return d * Math.cos(psi) + Math.sqrt(Math.max(0, c * c - s * s));
      }
    }
    const a = d * ca + c;
    return a / Math.cos(alpha - psi);
  };
}

function star(p: number, k: number): (theta: number) => number {
  const half = Math.PI / p;
  const num = k * Math.sin(half);
  return (theta) => {
    let psi = wrap(theta, 2 * half);
    if (psi > half) psi = 2 * half - psi;
    return num / (Math.sin(psi) + k * Math.sin(half - psi));
  };
}

function supershape(s: Section['supershape']): (theta: number) => number {
  let m = s.m;
  const symmetric = s.n2 === s.n3 && s.a === s.b;
  if (!symmetric && m % 2 !== 0) m = m + 1 <= 20 ? m + 1 : m - 1;
  const raw = (theta: number) => {
    const c = Math.abs(Math.cos((m * theta) / 4) / s.a);
    const si = Math.abs(Math.sin((m * theta) / 4) / s.b);
    // log-space to avoid overflow for large exponents
    const lc = c > 0 ? s.n2 * Math.log(c) : -Infinity;
    const ls = si > 0 ? s.n3 * Math.log(si) : -Infinity;
    const mx = Math.max(lc, ls);
    const lsum = mx + Math.log(Math.exp(lc - mx) + Math.exp(ls - mx));
    return -lsum / s.n1; // log ρ
  };
  const N = 2048;
  let maxLog = -Infinity;
  for (let i = 0; i < N; i++) maxLog = Math.max(maxLog, raw((TAU * i) / N));
  return (theta) => Math.max(0.05, Math.exp(raw(theta) - maxLog));
}

function custom(c: Section['custom']): (theta: number) => number {
  const f = periodicSpline(c.points);
  const N = 1024;
  let mx = 0;
  const sample = (theta: number) => {
    let u = wrap((c.symmetry * theta) / TAU, 1);
    if (c.mirror) u = 1 - Math.abs(2 * u - 1);
    return f(u);
  };
  for (let i = 0; i < N; i++) mx = Math.max(mx, sample((TAU * i) / N));
  return (theta) => Math.max(0.05, sample(theta) / mx);
}

function polarTable(samples: readonly number[]): (theta: number) => number {
  const n = samples.length;
  let mx = 0;
  for (const s of samples) mx = Math.max(mx, s);
  return (theta) => {
    const x = wrap(theta / TAU, 1) * n;
    const i = Math.floor(x);
    const u = x - i;
    return (samples[i % n] * (1 - u) + samples[(i + 1) % n] * u) / mx;
  };
}

export function makeSection(sec: Section): SectionEval {
  let base: (theta: number, cn: number) => number;
  let repetitions = 1;
  let grooveDepth = 0;
  let usesCorner = false;
  switch (sec.shape) {
    case 'circle':
      base = () => 1;
      break;
    case 'polygon':
      base = polygon(sec.sides);
      repetitions = sec.sides;
      usesCorner = sec.cornerRadius > 0;
      break;
    case 'star': {
      const f = star(sec.starPoints, sec.starInnerRatio);
      base = (t) => f(t);
      repetitions = sec.starPoints;
      grooveDepth = 1 - sec.starInnerRatio;
      break;
    }
    case 'flower': {
      const p = sec.petals;
      const dpt = sec.petalDepth / 100;
      base = (t) => 1 - dpt * (1 - Math.abs(Math.cos((p * t) / 2)));
      repetitions = p;
      grooveDepth = dpt;
      break;
    }
    case 'superellipse': {
      const n = sec.superellipseExponent;
      const norm = Math.pow(2, 0.5 - 1 / n);
      base = (t) => Math.pow(Math.pow(Math.abs(Math.cos(t)), n) + Math.pow(Math.abs(Math.sin(t)), n), -1 / n) / norm;
      repetitions = 4;
      break;
    }
    case 'supershape': {
      const f = supershape(sec.supershape);
      base = (t) => f(t);
      repetitions = Math.max(1, sec.supershape.m);
      break;
    }
    case 'custom': {
      const f = custom(sec.custom);
      base = (t) => f(t);
      repetitions = sec.custom.symmetry;
      break;
    }
    case 'svg': {
      if (sec.svg.samples.length >= 32) {
        const f = polarTable(sec.svg.samples);
        base = (t) => f(t);
      } else base = () => 1;
      break;
    }
  }

  const A = sec.aspectXY;
  let evalFn: (theta: number, cn: number) => number;
  if (A === 1) {
    evalFn = base;
  } else {
    // Linear stretch along X, then renormalise to max = 1 (cached per corner value).
    const stretched = (theta: number, cn: number) => {
      const phi = Math.atan2(A * Math.sin(theta), Math.cos(theta));
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      return base(phi, cn) * Math.sqrt(A * A * c * c + s * s);
    };
    const cache = new Map<number, number>();
    const maxFor = (cn: number) => {
      const key = Math.round(cn * 2000);
      let m = cache.get(key);
      if (m === undefined) {
        m = 0;
        for (let i = 0; i < 720; i++) m = Math.max(m, stretched((TAU * i) / 720, cn));
        cache.set(key, m);
      }
      return m;
    };
    evalFn = (theta, cn) => stretched(theta, cn) / maxFor(cn);
  }
  const out = evalFn as SectionEval;
  out.repetitions = repetitions;
  out.grooveDepth = grooveDepth;
  out.usesCorner = usesCorner;
  return out;
}
