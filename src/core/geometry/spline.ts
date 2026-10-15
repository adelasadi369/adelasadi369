/**
 * Monotone cubic Hermite spline (Catmull-Rom-style tangents limited with
 * Fritsch–Carlson). Never overshoots between knots. Knots flagged `sharp`
 * use one-sided secant tangents, producing a crease.
 */
export interface Knot {
  t: number;
  r: number;
  sharp?: boolean;
}

export interface Spline {
  (t: number): number;
  knots: readonly Knot[];
}

export function monotoneSpline(knots: readonly Knot[]): Spline {
  const n = knots.length;
  const xs = knots.map((k) => k.t);
  const ys = knots.map((k) => k.r);
  const d = new Float64Array(Math.max(n - 1, 1));
  for (let k = 0; k < n - 1; k++) d[k] = (ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]);

  // Outgoing (mR) and incoming (mL) tangents per knot.
  const mL = new Float64Array(n);
  const mR = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (n === 1) break;
    if (k === 0) {
      mL[k] = mR[k] = d[0];
    } else if (k === n - 1) {
      mL[k] = mR[k] = d[n - 2];
    } else if (knots[k].sharp) {
      mL[k] = d[k - 1];
      mR[k] = d[k];
    } else if (d[k - 1] * d[k] <= 0) {
      mL[k] = mR[k] = 0;
    } else {
      const h0 = xs[k] - xs[k - 1];
      const h1 = xs[k + 1] - xs[k];
      // Weighted harmonic mean (Fritsch–Butland), monotone for non-uniform spacing.
      const w1 = 2 * h1 + h0;
      const w2 = h1 + 2 * h0;
      mL[k] = mR[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
    }
  }
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      mR[k] = 0;
      mL[k + 1] = 0;
      continue;
    }
    const a = mR[k] / d[k];
    const b = mL[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      mR[k] = tau * a * d[k];
      mL[k + 1] = tau * b * d[k];
    }
  }

  const f = ((t: number) => {
    if (n === 1) return ys[0];
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= t) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const u = (t - xs[lo]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[lo] +
      (u3 - 2 * u2 + u) * h * mR[lo] +
      (-2 * u3 + 3 * u2) * ys[hi] +
      (u3 - u2) * h * mL[hi]
    );
  }) as Spline;
  f.knots = knots;
  return f;
}

/** Periodic monotone-ish cubic over [0,1) for closed polar curves. */
export function periodicSpline(points: readonly { a: number; r: number }[]): (u: number) => number {
  const n = points.length;
  const ext: Knot[] = [];
  for (let k = -2; k < n + 2; k++) {
    const i = ((k % n) + n) % n;
    ext.push({ t: points[i].a + Math.floor(k / n), r: points[i].r });
  }
  const s = monotoneSpline(ext);
  return (u: number) => s(u - Math.floor(u));
}
