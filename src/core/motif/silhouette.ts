import type { I18nText } from '../params/schema';

export type SilhouetteResult =
  { ok: true; points: { t: number; r: number }[]; heightToWidth: number } | { ok: false; message: I18nText };

/**
 * A drawn silhouette → normalised r(t) for the custom profile (GEOMETRY.md §14b). Input polylines are x, y pairs in
 * SVG units (y down). The tallest piece is used: a closed outline is read about its vertical centre line (both
 * halves, the wider side wins); an open path is a half profile with the axis at its leftmost point. 96 horizontal
 * cuts give the radius at each height; the curve is resampled to `n` control points (t 0 → 1 from the base).
 */
export function polylinesToProfile(polys: { pts: ArrayLike<number>; closed: boolean }[], n = 12): SilhouetteResult {
  const fail = (fa: string, en: string): SilhouetteResult => ({ ok: false, message: { fa, en } });
  let best: (typeof polys)[number] | null = null;
  let bestH = 0;
  for (const p of polys) {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 1; k < p.pts.length; k += 2) {
      y0 = Math.min(y0, p.pts[k]);
      y1 = Math.max(y1, p.pts[k]);
    }
    if (p.pts.length >= 4 && y1 - y0 > bestH) {
      bestH = y1 - y0;
      best = p;
    }
  }
  if (!best || bestH <= 0) return fail('هیچ خط عمودی در فایل نیست.', 'No path with any height in the file.');
  const P = best.pts;
  const m = P.length / 2;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; // prettier-ignore
  for (let k = 0; k < m; k++) {
    x0 = Math.min(x0, P[2 * k]);
    x1 = Math.max(x1, P[2 * k]);
    y0 = Math.min(y0, P[2 * k + 1]);
    y1 = Math.max(y1, P[2 * k + 1]);
  }
  const axis = best.closed ? (x0 + x1) / 2 : x0;
  const K = 96;
  const rs = new Float64Array(K + 1);
  const segs = best.closed ? m : m - 1;
  for (let s = 0; s <= K; s++) {
    // t = 0 at the base (largest SVG y)
    const y = y1 - ((y1 - y0) * s) / K;
    let r = 0;
    for (let k = 0; k < segs; k++) {
      const ax = P[2 * k], ay = P[2 * k + 1]; // prettier-ignore
      const b = (k + 1) % m;
      const bx = P[2 * b], by = P[2 * b + 1]; // prettier-ignore
      if ((ay - y) * (by - y) > 0 || ay === by) {
        if (ay === by && Math.abs(ay - y) < 1e-9) r = Math.max(r, Math.abs(ax - axis), Math.abs(bx - axis));
        continue;
      }
      const x = ax + ((y - ay) / (by - ay)) * (bx - ax);
      r = Math.max(r, Math.abs(x - axis));
    }
    rs[s] = r;
  }
  // rows the path misses (an open path that does not span every height) take the nearest radius
  for (let s = 1; s <= K; s++) if (rs[s] === 0) rs[s] = rs[s - 1];
  for (let s = K - 1; s >= 0; s--) if (rs[s] === 0) rs[s] = rs[s + 1];
  const rMax = Math.max(...rs);
  if (!(rMax > 0)) return fail('شکل پهنا ندارد.', 'The silhouette has no width.');
  const points: { t: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = t * K;
    const a = Math.floor(u);
    const b = Math.min(K, a + 1);
    const r = rs[a] + (rs[b] - rs[a]) * (u - a);
    points.push({ t, r: Math.min(1, Math.max(0.05, r / rMax)) });
  }
  return { ok: true, points, heightToWidth: (y1 - y0) / (2 * rMax) };
}
