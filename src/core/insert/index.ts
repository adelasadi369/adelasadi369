import { clamp, TAU } from '../math';
import { paramInfo } from '../params/meta';
import type { VaseParams } from '../params/schema';

/**
 * Tube insert → bore geometry, shared by the shell bore liner and (S2) the sleeve SDF.
 * Conventions: the bore axis is vertical through the origin (base centre); angles are world angles about it.
 * See GEOMETRY.md §7b.
 */

type Insert = VaseParams['insert'];
type Printer = VaseParams['print']['printer'];

/** Default clearance per side for each fit (mm). Picking a fit copies this into `insert.clearance`. */
export const FIT_CLEARANCE: Record<Insert['fit'], number> = { press: 0.1, snug: 0.18, slip: 0.25 };

/** Bore accuracy the printability check enforces (mm, radial). */
export const BORE_TOLERANCE = 0.05;
/** Chord sag budget for the facetted bore (mm); the grid is raised until it holds. */
export const BORE_SAG = 0.01;
/** Columns across one grip rib. */
const RIB_SAMPLES = 6;
/** Vertical ramp at both ends of a grip rib (mm). */
export const RIB_RAMP = 1;
/** Height of the Fit Test Ring (mm). */
export const FIT_RING_HEIGHT = 10;

export interface Bore {
  /** Design radius R_bore = OD/2 + clearance + tolerance/2 + holeCompensation. */
  radius: number;
  diameter: number;
  /** Radius the printed hole should end up with (R_bore without hole compensation). */
  targetRadius: number;
  targetDiameter: number;
  holeCompensation: number;
}

export function computeBore(insert: Insert, printer: Pick<Printer, 'holeCompensation'>): Bore {
  const targetRadius = insert.od / 2 + insert.clearance + insert.odTolerance / 2;
  const radius = targetRadius + printer.holeCompensation;
  return {
    radius,
    diameter: 2 * radius,
    targetRadius,
    targetDiameter: 2 * targetRadius,
    holeCompensation: printer.holeCompensation,
  };
}

export const isBoreLiner = (p: VaseParams) => p.print.outputMode === 'shell' && p.print.innerSurface === 'bore';

/** Height where the bore wall starts: 0 for an open bottom, else the top of the lip / floor. */
export function boreBottom(insert: Insert): number {
  switch (insert.bottom) {
    case 'open':
      return 0;
    case 'lip':
      return insert.lipThickness;
    default:
      return insert.floorThickness;
  }
}

/** Radius of the opening in the bottom (0 = closed floor). Never closer than 1 mm to the bore wall. */
export function bottomHoleRadius(insert: Insert, boreRadius: number): number {
  const hr =
    insert.bottom === 'lip' ? boreRadius - insert.lipWidth : insert.bottom === 'drain' ? insert.drainDiameter / 2 : 0;
  return hr > 0 ? Math.min(hr, boreRadius - 1) : 0;
}

/** Bore radius as a function of world angle and height, with chamfers, O-ring grooves and grip ribs. */
export interface BoreProfile {
  bore: Bore;
  /** Bore wall start (see boreBottom). */
  zBottom: number;
  /** Radius at world angle φ and height z, for a column whose bore top is at zTop. */
  radiusAt(phi: number, z: number, zTop: number): number;
  /** Heights where the profile has kinks (row breakpoints). */
  breaks: number[];
}

/** `zTopNominal` is the flat bore top (H minus the round-rim allowance); `H` scales groove positions. */
export function boreProfile(
  p: VaseParams,
  zTopNominal: number,
  H: number,
  opts: { entry?: boolean } = {},
): BoreProfile {
  const ins = p.insert;
  const bore = computeBore(ins, p.print.printer);
  const R = bore.radius;
  const zb = boreBottom(ins);
  const breaks: number[] = [];

  const cb = ins.bottom === 'open' || ins.bottom === 'lip' ? ins.bottomChamfer : 0;
  if (cb > 0) breaks.push(zb + cb);
  const ce = opts.entry === false ? 0 : Math.min(ins.entryChamfer, (zTopNominal - zb) / 4);
  if (ce > 0) breaks.push(zTopNominal - ce);

  // O-ring grooves: trapezoids with 45° flanks
  const grooves: { zc: number; half: number; flank: number }[] = [];
  const { grooves: g } = ins;
  for (let k = 0; k < g.count; k++) {
    const zc = (H * (k === 0 ? g.z1 : g.z2)) / 100;
    const half = g.width / 2;
    const flank = Math.min(g.depth, half);
    if (zc - half <= zb + cb || zc + half >= zTopNominal - ce) continue;
    grooves.push({ zc, half, flank });
    breaks.push(zc - half, zc - half + flank, zc + half - flank, zc + half);
  }

  // grip ribs: cos² bumps centred on φ = 2πk/n, from just above the bottom chamfer for heightFraction of the bore
  const rb = ins.ribs;
  const ribOn = rb.count > 0 && rb.interference > 0;
  const rz0 = zb + cb;
  const rz1 = Math.min(zTopNominal - ce, zb + ((zTopNominal - zb) * rb.heightFraction) / 100);
  const ribHalf = rb.width / 2 / R; // half angular width
  const ribPitch = TAU / Math.max(1, rb.count);
  const ribs = ribOn && rz1 - rz0 > 2 * RIB_RAMP;
  if (ribs) breaks.push(rz0, rz0 + RIB_RAMP, rz1 - RIB_RAMP, rz1);

  return {
    bore,
    zBottom: zb,
    breaks,
    radiusAt(phi, z, zTop) {
      let r = R;
      if (cb > 0 && z < zb + cb) r += zb + cb - Math.max(z, zb);
      if (ce > 0 && z > zTop - ce) r += Math.min(z, zTop) - (zTop - ce);
      for (const q of grooves) {
        const d = q.half - Math.abs(z - q.zc);
        if (d > 0) r += g.depth * Math.min(1, d / q.flank);
      }
      if (ribs && z > rz0 && z < rz1) {
        const v = Math.min(1, (z - rz0) / RIB_RAMP, (rz1 - z) / RIB_RAMP);
        const off = phi - ribPitch * Math.round(phi / ribPitch);
        if (Math.abs(off) < ribHalf) r -= v * rb.interference * 0.5 * (1 + Math.cos((Math.PI * off) / ribHalf));
      }
      return r;
    },
  };
}

/** Columns needed so the facetted bore stays within BORE_SAG and each grip rib gets RIB_SAMPLES columns. */
export function boreMinColumns(insert: Insert, boreRadius: number): number {
  let n = Math.ceil(Math.PI / Math.acos(1 - Math.min(0.5, BORE_SAG / boreRadius)));
  if (insert.ribs.count > 0 && insert.ribs.interference > 0)
    n = Math.max(n, Math.ceil((RIB_SAMPLES * TAU * boreRadius) / insert.ribs.width));
  return n;
}

/**
 * Distance s along the ray from slice centre (cx, cy) in direction `ang` to the bore wall, so that the hit point
 * lies at the profile radius for its own world angle. Returns NaN when the centre is outside the bore.
 */
export function boreRay(prof: BoreProfile, cx: number, cy: number, ang: number, z: number, zTop: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const cu = cx * ux + cy * uy;
  const c2 = cx * cx + cy * cy;
  let phi = ang;
  let s = NaN;
  for (let it = 0; it < 2; it++) {
    const r = prof.radiusAt(phi, z, zTop);
    const disc = cu * cu - c2 + r * r;
    if (disc < 0 || c2 >= r * r) return NaN;
    s = -cu + Math.sqrt(disc);
    if (c2 === 0) break;
    phi = Math.atan2(cy + s * uy, cx + s * ux);
  }
  return s;
}

export interface Calibration {
  old: number;
  next: number;
  /** True when the result hit the schema range of holeCompensation. */
  clamped: boolean;
}

/**
 * Calibration from a printed Fit Test Ring: the ring was designed at `bore.diameter` with `bore.holeCompensation`;
 * the hole should measure `bore.targetDiameter`. Shrinkage is linear per side, so
 * c_new = c_old + (target Ø − measured Ø) / 2.
 */
export function calibrateHoleCompensation(bore: Bore, measuredDiameter: number): Calibration {
  const m = paramInfo('print.printer.holeCompensation')!.meta;
  const raw = bore.holeCompensation + (bore.targetDiameter - measuredDiameter) / 2;
  const next = Math.round(clamp(raw, m.min!, m.max!) * 1000) / 1000;
  return { old: bore.holeCompensation, next, clamped: Math.abs(next - raw) > 5e-4 };
}
