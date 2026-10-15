import { TAU } from '../math';
import { QUALITY_GRID, type VaseParams } from '../params/schema';
import type { Field } from './field';

export type Quality = keyof typeof QUALITY_GRID;

export const MAX_THETA = 4096;
export const MAX_ROWS = 2400;

export interface GridPlan {
  nTheta: number;
  nZ: number;
  /** Grid shear in radians: θw = θ_i + shear(t). Aligns columns with helical ribs. */
  shear: (t: number) => number;
  /** Feature repetition count that drove the auto-raise (k). */
  k: number;
}

export function planGrid(field: Field, quality: Quality): GridPlan {
  const q = QUALITY_GRID[quality];
  const { params, section, effects } = field;
  let k = 1;
  if (section.repetitions > 1 && params.section.bottom.shape !== 'circle') k = Math.max(k, section.repetitions);
  if (field.lobesCount) k = Math.max(k, field.lobesCount);
  let minCols = 0;
  for (const e of effects) {
    if (e.unsupported) continue;
    if (e.periodic) k = Math.max(k, e.repetitions);
    minCols = Math.max(minCols, e.samplesPerRep * e.repetitions);
  }

  // Align the grid with a helical rib if nothing else around the circumference needs alignment.
  const sectionFree = params.section.bottom.shape === 'circle' && !field.lobesCount;
  let aligned: (typeof effects)[number] | null = null;
  if (sectionFree) {
    for (const e of effects) {
      if (e.type !== 'ribs' || e.unsupported || e.helixTurns === 0 || e.verticalCycles !== 0) continue;
      if (!aligned || e.repetitions * e.depth > aligned.repetitions * aligned.depth) aligned = e;
    }
  }
  const h = aligned ? aligned.helixTurns : 0;
  const shear = h === 0 ? () => 0 : (t: number) => -TAU * h * t;

  let vCycles = params.profile.waveAmplitude > 0 ? params.profile.waveCycles : 0;
  for (const e of effects) {
    if (e.unsupported) continue;
    let c = e.verticalCycles;
    if (e.type === 'ribs' && e !== aligned && e.helixTurns !== 0 && c === 0) c = Math.abs(e.helixTurns) * e.repetitions;
    vCycles = Math.max(vCycles, c);
  }

  let nTheta = Math.max(q.nTheta, 8 * k, minCols);
  nTheta = k * Math.ceil(nTheta / k);
  if (nTheta > MAX_THETA) nTheta = Math.max(k, k * Math.floor(MAX_THETA / k));
  const nZ = Math.min(MAX_ROWS, Math.max(q.nZ, Math.min(4 * q.nZ, Math.ceil(8 * vCycles))));
  return { nTheta, nZ, shear, k };
}

/** Uniform rows in [0, top] with nearby rows snapped onto breakpoints. */
export function buildRows(nZ: number, top: number, breakpoints: number[]): Float64Array {
  const rows = new Float64Array(nZ);
  for (let j = 0; j < nZ; j++) rows[j] = (top * j) / (nZ - 1);
  const fixed = new Uint8Array(nZ);
  fixed[0] = fixed[nZ - 1] = 1;
  const dz = top / (nZ - 1);
  for (const b of breakpoints) {
    if (!(b > 1e-6 && b < top - 1e-6)) continue;
    let j = Math.round(b / dz);
    if (j <= 0) j = 1;
    if (j >= nZ - 1) j = nZ - 2;
    if (fixed[j]) {
      // try neighbour
      const alt = b / dz > j ? j + 1 : j - 1;
      if (alt <= 0 || alt >= nZ - 1 || fixed[alt]) continue;
      j = alt;
    }
    if (b <= rows[j - 1] || b >= rows[j + 1]) continue;
    rows[j] = b;
    fixed[j] = 1;
  }
  return rows;
}

export function rowBreakpoints(params: VaseParams, H: number, zFloor: number): number[] {
  const bp: number[] = [];
  if (zFloor > 0) bp.push(zFloor); // must win: the inner surface starts exactly on this row
  const { chamfer, footRing } = params.base;
  if (chamfer > 0) bp.push(chamfer);
  if (footRing.height > 0) bp.push(footRing.height, footRing.height - footRing.inset);
  if (params.rim.flare !== 0) bp.push(H * (1 - params.rim.flareZone / 100));
  for (const e of params.effects) {
    if (!e.enabled || e.fade > 0) continue;
    bp.push((H * e.start) / 100, (H * e.end) / 100);
  }
  for (const p of params.profile.preset === 'custom' ? params.profile.controlPoints : []) {
    if (p.sharp) bp.push((H * p.t) / 100);
  }
  return bp;
}
