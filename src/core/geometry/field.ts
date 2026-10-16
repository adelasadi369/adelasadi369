import { DEG, TAU, ease } from '../math';
import type { VaseParams } from '../params/schema';
import { compileEffect, type CompiledEffect } from './effects';
import { buildProfile, type Profile } from './profile';
import { makeSection, type SectionEval } from './sections';
import { buildLobes, buildTwist } from './twist';

export const R_MIN = 5;

/** Per-height quantities, computed once per mesh row. */
export interface Row {
  z: number;
  t: number;
  /** Twist (radians) at this height; vertex angle = θw + twist. */
  twist: number;
  cx: number;
  cy: number;
  /** Height fraction used for body evaluation (differs inside the foot ring). */
  tb: number;
  R: number;
  /** Corner radius / R for the bottom and top sections. */
  cn: number;
  cn1: number;
  /** Morph weight w(t) and renormaliser N(t) (1 when morphing is off). */
  mw: number;
  mnorm: number;
  flare: number;
  /** θ-independent base modifiers (foot ring), mm, ≤ 0. The chamfer is applied in mesh.ts. */
  radialOffset: number;
  masks: Float64Array;
}

export interface Field {
  params: VaseParams;
  H: number;
  profile: Profile;
  section: SectionEval;
  /** Active sections: [bottom] or [bottom, top] when morphing. */
  sections: { eval: SectionEval; shape: string }[];
  effects: CompiledEffect[];
  lobesCount: number;
  twistFn: (t: number) => number;
  row(z: number): Row;
  /** Smooth body: R·Ŝ·Lobes + flare (no effects, no base modifiers). */
  base(thetaW: number, row: Row): number;
  /** Final outer radius (unclamped); c, s = cos/sin θw. Clamp with R_MIN at the call site to count clamps. */
  outerRaw(thetaW: number, c: number, s: number, row: Row): number;
}

export function compileField(params: VaseParams): Field {
  const H = params.dimensions.height;
  const profile = buildProfile(params, R_MIN);
  const section = makeSection(params.section.bottom);
  const cornerMm = params.section.bottom.cornerRadius;
  const morph = params.section.morphEnabled;
  const top = morph ? makeSection(params.section.top) : null;
  const cornerTop = params.section.top.cornerRadius;
  const rotTop = params.section.rotationTop * DEG;
  const easing = params.section.morphEasing;
  /** lerp(S0, S1 rotated, w) before renormalisation. */
  const mixed = (thetaW: number, cn: number, cn1: number, w: number) =>
    w <= 0
      ? section(thetaW, cn)
      : w >= 1
        ? top!(thetaW - rotTop, cn1)
        : section(thetaW, cn) * (1 - w) + top!(thetaW - rotTop, cn1) * w;
  // N(t) = max_θ of the blend: 65-entry table over t, 512 θ samples each.
  const normTable = new Float64Array(65).fill(1);
  if (top) {
    for (let k = 0; k <= 64; k++) {
      const tt = k / 64;
      const R = profile.R(tt);
      const w = ease(easing, tt);
      let m = 0;
      for (let i = 0; i < 512; i++) m = Math.max(m, mixed((TAU * i) / 512, cornerMm / R, cornerTop / R, w));
      normTable[k] = m > 0 ? m : 1;
    }
  }
  const normAt = (tt: number) => {
    const x = Math.min(64, Math.max(0, tt * 64));
    const i = Math.min(63, Math.floor(x));
    return normTable[i] + (normTable[i + 1] - normTable[i]) * (x - i);
  };
  const lobes = buildLobes(params.twist.lobes);
  const twistFn = buildTwist(params.twist);
  const ctx = { height: H, refRadius: params.dimensions.maxDiameter / 2, maxOverhang: params.print.maxOverhang };
  const effects: CompiledEffect[] = [];
  const active: CompiledEffect[] = [];

  const bend = params.twist.bend.offset;
  const bdx = Math.cos(params.twist.bend.direction * DEG);
  const bdy = Math.sin(params.twist.bend.direction * DEG);

  const { flare, flareZone } = params.rim;
  const zone = flareZone / 100;
  const { footRing } = params.base;
  const footH = footRing.height;
  const footI = footRing.inset;

  const row = (z: number): Row => {
    const t = z / H;
    const zb = footH > 0 && z < footH ? footH : z;
    const tb = zb / H;
    const R = profile.R(tb);
    let fl = 0;
    if (flare !== 0 && zone > 0 && tb > 1 - zone) {
      const u = (tb - (1 - zone)) / zone;
      fl = flare * u * u;
    }
    let off = 0;
    if (footH > 0 && z < footH) off -= z < footH - footI ? footI : footH - z;
    const masks = new Float64Array(active.length);
    for (let k = 0; k < active.length; k++) masks[k] = active[k].mask(tb);
    const bt = bend * t * t;
    return {
      z,
      t,
      twist: twistFn(t),
      cx: bt * bdx,
      cy: bt * bdy,
      tb,
      R,
      cn: cornerMm / R,
      cn1: cornerTop / R,
      mw: top ? ease(easing, tb) : 0,
      mnorm: top ? normAt(tb) : 1,
      flare: fl,
      radialOffset: off,
      masks,
    };
  };

  const base = (thetaW: number, r: Row) => {
    let s = top ? mixed(thetaW, r.cn, r.cn1, r.mw) / r.mnorm : section(thetaW, r.cn);
    if (lobes) s *= lobes(thetaW, r.tb);
    return r.R * s + r.flare;
  };

  const applyEffects = (
    v: number,
    thetaW: number,
    c: number,
    s: number,
    tb: number,
    masks: ArrayLike<number>,
    n: number,
  ) => {
    for (let k = 0; k < n; k++) {
      const m = masks[k];
      if (m === 0) continue;
      const e = active[k];
      if (e.modify) v += m * (e.modify(thetaW, c, s, tb, v) - v);
      else v += m * e.offset(thetaW, c, s, tb);
    }
    return v;
  };

  // Compile effects in stack order; modifiers may sample the field built so far.
  for (const e of params.effects) {
    if (!e.enabled) continue;
    const n = active.length;
    let lastT = NaN;
    let lastRow: Row | null = null;
    let lastMasks: number[] = [];
    const prev = (thetaW: number, t: number) => {
      if (t !== lastT || !lastRow) {
        lastT = t;
        lastRow = row(t * H);
        const tb = lastRow.tb;
        lastMasks = active.slice(0, n).map((x) => x.mask(tb));
      }
      const r = lastRow;
      return applyEffects(base(thetaW, r), thetaW, Math.cos(thetaW), Math.sin(thetaW), r.tb, lastMasks, n);
    };
    const ce = compileEffect(e, ctx, prev);
    effects.push(ce);
    if (!ce.unsupported) active.push(ce);
  }

  const outerRaw = (thetaW: number, c: number, s: number, r: Row) =>
    applyEffects(base(thetaW, r), thetaW, c, s, r.tb, r.masks, active.length) + r.radialOffset;

  return {
    params,
    H,
    profile,
    section,
    sections: [
      { eval: section, shape: params.section.bottom.shape },
      ...(top ? [{ eval: top, shape: params.section.top.shape }] : []),
    ],
    effects,
    lobesCount: lobes ? params.twist.lobes.count : 0,
    twistFn,
    row,
    base,
    outerRaw,
  };
}
