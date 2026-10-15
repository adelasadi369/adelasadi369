import { DEG } from '../math';
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
  cn: number;
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
  const lobes = buildLobes(params.twist.lobes);
  const twistFn = buildTwist(params.twist);
  const ctx = { height: H, refRadius: params.dimensions.maxDiameter / 2 };
  const effects = params.effects.filter((e) => e.enabled).map((e) => compileEffect(e, ctx));
  const active = effects.filter((e) => !e.unsupported);

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
      flare: fl,
      radialOffset: off,
      masks,
    };
  };

  const base = (thetaW: number, r: Row) => {
    let s = section(thetaW, r.cn);
    if (lobes) s *= lobes(thetaW, r.tb);
    return r.R * s + r.flare;
  };

  const outerRaw = (thetaW: number, c: number, s: number, r: Row) => {
    let v = base(thetaW, r);
    if (active.length) {
      for (let k = 0; k < active.length; k++) {
        const m = r.masks[k];
        if (m !== 0) v += m * active[k].offset(thetaW, c, s, r.tb);
      }
    }
    return v + r.radialOffset;
  };

  return {
    params,
    H,
    profile,
    section,
    effects,
    lobesCount: lobes ? params.twist.lobes.count : 0,
    twistFn,
    row,
    base,
    outerRaw,
  };
}
