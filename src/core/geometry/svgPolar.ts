import { TAU } from '../math';
import type { I18nText } from '../params/schema';

export type Pt = [number, number];

export type PolarResult =
  | {
      ok: true;
      samples: number[];
      centroid: Pt;
      /** Set when the outline was not star-shaped (outer envelope used). */ warning?: I18nText;
    }
  | { ok: false; reason: 'empty' | 'notStarShaped' | 'tooThin'; message: I18nText };

function areaCentroid(poly: Pt[]): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  a /= 2;
  return { area: Math.abs(a), cx: a ? cx / (6 * a) : 0, cy: a ? cy / (6 * a) : 0 };
}

/**
 * Convert a closed outline into a normalised polar table by ray casting from its area centroid, or from `centre`
 * (in the input's coordinates). The largest polyline is used (SVG y is flipped so the shape reads the same from
 * above). An outline that is not star-shaped about the centre (some ray crosses it more than once) falls back to its
 * outer envelope (the farthest crossing per ray) and carries a warning.
 */
export function polylinesToPolar(polylines: Pt[][], n = 720, centre?: Pt): PolarResult {
  const polys = polylines.filter((p) => p.length >= 3).map((p) => p.map(([x, y]) => [x, -y] as Pt));
  if (!polys.length) {
    return {
      ok: false,
      reason: 'empty',
      message: { fa: 'هیچ شکل بسته‌ای در فایل پیدا نشد.', en: 'No closed shape found in the file.' },
    };
  }
  let best = polys[0];
  let bestA = areaCentroid(best);
  for (const p of polys.slice(1)) {
    const a = areaCentroid(p);
    if (a.area > bestA.area) {
      best = p;
      bestA = a;
    }
  }
  const cx = centre ? centre[0] : bestA.cx;
  const cy = centre ? -centre[1] : bestA.cy;
  let scale = 0;
  for (const [x, y] of best) scale = Math.max(scale, Math.hypot(x - cx, y - cy));
  const eps = scale * 1e-7;
  const samples: number[] = [];
  let bad = 0;
  for (let k = 0; k < n; k++) {
    const th = (TAU * k) / n;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    const hits: number[] = [];
    for (let i = 0; i < best.length; i++) {
      const [ax, ay] = best[i];
      const [bx, by] = best[(i + 1) % best.length];
      const ex = bx - ax;
      const ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue;
      const wx = ax - cx;
      const wy = ay - cy;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dy - wy * dx) / den;
      if (t > eps && u >= -1e-9 && u <= 1 + 1e-9) hits.push(t);
    }
    hits.sort((a, b) => a - b);
    const uniq = hits.filter((h, i) => i === 0 || h - hits[i - 1] > eps * 10);
    if (uniq.length !== 1) bad++;
    samples.push(uniq.length ? uniq[uniq.length - 1] : 0);
  }
  if (samples.some((r) => r <= 0)) {
    return {
      ok: false,
      reason: 'notStarShaped',
      message: {
        fa: 'مرکز بیرون از شکل است؛ مرکز دیگری انتخاب کنید.',
        en: 'The centre lies outside the outline; pick another centre.',
      },
    };
  }
  const warning: I18nText | undefined =
    bad > 0
      ? {
          fa: 'این شکل از مرکزش «ستاره‌ای» نیست (بعضی پرتوها چند بار لبه را قطع می‌کنند)؛ پوستهٔ بیرونی آن به کار رفت و فرورفتگی‌های پنهان حذف شدند.',
          en: 'This outline is not star-shaped around its centre (some rays cross the edge more than once); its outer envelope is used and hidden recesses are dropped.',
        }
      : undefined;
  const mx = Math.max(...samples);
  const out = samples.map((r) => Math.round((r / mx) * 10000) / 10000);
  if (Math.min(...out) < 0.05) {
    return {
      ok: false,
      reason: 'tooThin',
      message: { fa: 'شکل در بخشی خیلی باریک است.', en: 'The outline is too thin somewhere.' },
    };
  }
  return { ok: true, samples: out, centroid: [cx, -cy], ...(warning && { warning }) };
}
