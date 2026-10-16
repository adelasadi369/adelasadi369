import { TAU, clamp, frac, smoothstep, tri } from '../../math';
import { createSimplex3, fbm3, hash3 } from '../../random';
import type { Effect } from '../../params/schema';
import type { EffectCtx, OffsetFn } from './types';

type Texture = Extract<Effect, { type: 'texture' }>;
type Pattern = Texture['pattern'];

const SQRT3 = Math.sqrt(3);
const mod = (x: number, m: number) => x - m * Math.floor(x / m);

/** +1 = raised pattern, −1 = recessed pattern (before `invert`). */
export const TEXTURE_SIGN: Record<Pattern, 1 | -1> = {
  honeycomb: -1,
  knurl: 1,
  diamond: 1,
  basketweave: 1,
  chevron: 1,
  scales: 1,
  hammered: -1,
  bark: -1,
  rope: 1,
  dots: 1,
};

/** Patterns whose period in U is 2 cells (need an even repeat count). */
export const TEXTURE_PERIOD2: Pattern[] = ['basketweave'];

/** Unit-cell pattern T(U, V) ∈ [0, 1]; period 1 (or 2) in U so integer repeats are seamless. */
function patternFn(e: Texture, repeats: number): (U: number, V: number) => number {
  switch (e.pattern) {
    case 'honeycomb':
      return (U, V) => {
        // nearest hex centre on lattice (1,0), (½, √3/2); edge distance = apothem − hex norm
        const ax = mod(U, 1) - 0.5;
        const ay = mod(V, SQRT3) - SQRT3 / 2;
        const bx = mod(U - 0.5, 1) - 0.5;
        const by = mod(V - SQRT3 / 2, SQRT3) - SQRT3 / 2;
        const useA = ax * ax + ay * ay < bx * bx + by * by;
        const gx = Math.abs(useA ? ax : bx);
        const gy = Math.abs(useA ? ay : by);
        const d = Math.max(gx, gx * 0.5 + gy * (SQRT3 / 2));
        return 1 - smoothstep(0, 0.09, 0.5 - d);
      };
    case 'knurl':
      return (U, V) => Math.min(tri(U + V), tri(U - V));
    case 'diamond':
      return (U, V) => smoothstep(0, 0.15, 0.5 - (Math.abs(frac(U) - 0.5) + Math.abs(frac(V) - 0.5)) * 1.1);
    case 'basketweave':
      return (U, V) => {
        const i = Math.floor(U);
        const j = Math.floor(V);
        const a = U - i;
        const b = V - j;
        const horizontal = mod(i + j, 2) === 0;
        const across = horizontal ? b : a;
        const along = horizontal ? a : b;
        return tri(3 * across + 0.5) * (0.8 + 0.2 * Math.sin(Math.PI * along));
      };
    case 'chevron':
      return (U, V) => tri(V + 2 * Math.abs(frac(U) - 0.5));
    case 'scales':
      return (U, V) => {
        const rad = 0.72;
        const j0 = Math.floor(V);
        // upper rows overlap lower ones: test the higher row first
        for (const j of [j0 + 1, j0]) {
          const off = 0.5 * mod(j, 2);
          const cx = Math.round(U - off) + off;
          const dx = U - cx;
          const dy = V - j;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (dy <= 0 && d < rad) return Math.sqrt(1 - (d / rad) * (d / rad));
        }
        return 0;
      };
    case 'hammered':
      return (U, V) => {
        const i0 = Math.floor(U);
        const j0 = Math.floor(V);
        let f1 = 9;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const i = i0 + di;
            const j = j0 + dj;
            const iw = mod(i, repeats); // seamless wrap
            const px = i + 0.15 + 0.7 * hash3(e.seed, iw, j, 1);
            const py = j + 0.15 + 0.7 * hash3(e.seed, iw, j, 2);
            const d = (U - px) * (U - px) + (V - py) * (V - py);
            if (d < f1) f1 = d;
          }
        }
        return Math.max(0, 1 - f1 / (0.55 * 0.55));
      };
    case 'bark':
      return () => 0; // handled with cylindrical noise below
    case 'rope':
      return (U, V) => {
        const u = 2 * frac(U + 1.5 * V) - 1;
        return Math.sqrt(Math.max(0, 1 - u * u)) * (0.85 + 0.15 * Math.cos(TAU * V));
      };
    case 'dots':
      return (U, V) => {
        let best = 9;
        const j0 = Math.floor(V);
        for (const j of [j0, j0 + 1]) {
          const off = 0.5 * mod(j, 2);
          const cx = Math.floor(U - off) + 0.5 + off;
          for (const c of [cx - 1, cx, cx + 1]) {
            const d = (U - c) * (U - c) + (V - j) * (V - j);
            if (d < best) best = d;
          }
        }
        const r = Math.sqrt(best) / 0.3;
        return Math.sqrt(Math.max(0, 1 - r * r));
      };
  }
}

export function textureRepeats(e: Texture): number {
  return TEXTURE_PERIOD2.includes(e.pattern) && e.repeats % 2 ? e.repeats + 1 : e.repeats;
}

/** Seamless texture in cell space U = repeats·θ/2π, V = z / cell height. */
export function textureOffset(e: Texture, ctx: EffectCtx): { offset: OffsetFn; cellHeight: number } {
  const repeats = textureRepeats(e);
  const cellW = (TAU * ctx.refRadius) / repeats;
  const cellH = e.aspect * cellW;
  const sign = TEXTURE_SIGN[e.pattern] * (e.invert ? -1 : 1);
  const D = sign * e.depth;
  if (e.depth === 0) return { offset: () => 0, cellHeight: cellH };
  if (e.pattern === 'bark') {
    const noise = createSimplex3(e.seed);
    const k = ctx.refRadius / (2 * cellW);
    const kz = ctx.height / (8 * cellH);
    return {
      cellHeight: cellH,
      offset: (_t, c, s, t) => {
        const n = fbm3(noise, k * c, k * s, kz * t, 3);
        const crack = Math.pow(clamp(1 - Math.abs(n) * 3, 0, 1), 2);
        return D * crack;
      },
    };
  }
  const T = patternFn(e, repeats);
  const kU = repeats / TAU;
  const kV = ctx.height / cellH;
  return { cellHeight: cellH, offset: (thetaW, _c, _s, t) => D * T(kU * mod(thetaW, TAU), kV * t) };
}
