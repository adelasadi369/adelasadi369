import type { Effect } from '../../params/schema';
import type { EffectCtx, OffsetFn } from './types';

type Muqarnas = Extract<Effect, { type: 'muqarnas' }>;

const D2R = Math.PI / 180;

/**
 * Muqarnas collar (GEOMETRY.md §16): `tiers` bands of `cells` niches at the rim (or the base), each tier shifted by
 * half a cell, every niche a pointed-arch half-dome recess. Printable by construction:
 *   corbel   the collar steps outward tier by tier as a continuous ramp of slope corbel / tierHeight, capped at
 *            tan(maxOverhang − 5°) (at the base it narrows going up, which never overhangs);
 *   niche    outline |x| ≤ 0.8 of the cell, from v = 0.08 up to the arch v_top(x) = v_s + (0.92 − v_s)·arch(|x|/0.8),
 *            arch(s) = (1 − p)·√(1 − s²) + p·(1 − s) (p = pointedness); depth = D·√(1 − (x/0.8)²) (half dome), capped
 *            under the arch by (v_top − v)·tierHeight·tan(maxOverhang − 3°), so the niche roof rises like a teardrop,
 *            and above the sill by (v − 0.08)·tierHeight·tan(maxOverhang − 3°) (inward leans count in vase modes).
 */
export function muqarnasOffset(e: Muqarnas, ctx: EffectCtx): OffsetFn {
  const H = ctx.height;
  const th = Math.min(e.tierHeight, H / e.tiers);
  const band = th * e.tiers;
  const rim = e.position === 'rim';
  const z0 = rim ? H - band : 0;
  const corbel = Math.min(e.corbel, th * Math.tan((ctx.maxOverhang - 5) * D2R));
  const roof = Math.tan((ctx.maxOverhang - 3) * D2R);
  const vs = 0.45;
  const C = e.cells;
  const p = e.pointedness;
  return (thetaW, _c, _s, t) => {
    const z = t * H;
    if (z < z0 || z > z0 + band) return 0;
    const zl = z - z0;
    const ramp = rim ? (corbel * zl) / th : corbel * (e.tiers - zl / th);
    const k = Math.min(e.tiers - 1, Math.floor(zl / th));
    const v = zl / th - k;
    let u = (thetaW * C) / (2 * Math.PI) + (k % 2 ? 0.5 : 0);
    u -= Math.floor(u);
    const x = Math.abs(2 * u - 1);
    if (x >= 0.8 || v <= 0.08) return ramp;
    const s = x / 0.8;
    const top = vs + (0.92 - vs) * ((1 - p) * Math.sqrt(1 - s * s) + p * (1 - s));
    if (v >= top) return ramp;
    const dome = e.nicheDepth * Math.sqrt(1 - s * s);
    // the floor ramps in at the same slope: in vase modes an inward lean counts as overhang too
    const depth = Math.min(dome, (top - v) * th * roof, (v - 0.08) * th * roof);
    return ramp - depth;
  };
}
