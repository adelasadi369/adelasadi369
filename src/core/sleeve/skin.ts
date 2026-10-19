import { compileField, R_MIN, type Field } from '../geometry/field';
import { MAX_ROWS, MAX_THETA, planGrid, type Quality } from '../geometry/grid';
import { TAU } from '../math';
import { QUALITY_GRID, type VaseParams } from '../params/schema';

/**
 * The vase master field r(θ, z) rasterised on a dense periodic grid in world angles about the slice centre C(z)
 * (docs/sleeve-integration.md §2). Every vase style and effect therefore works on sleeves.
 *
 * d_skin = (ρ_c − r) · L with L = 1 / sqrt(1 + (r_θ / r)² + r_z²), the Lipschitz correction of ρ − r(θ, z).
 * Approximations (documented in GEOMETRY.md §13): L uses r instead of ρ_c (exact on the surface) and the bend's
 * dC/dz is left out of the gradient. The narrow band carries a 1.5× safety factor for both.
 */
export interface SkinMap {
  field: Field;
  H: number;
  nT: number;
  nZ: number;
  /** r and L, row-major [j · nT + i]; column i is the world angle 2πi / nT, row j the height H·j / (nZ − 1). */
  r: Float32Array;
  L: Float32Array;
  cx: Float64Array;
  cy: Float64Array;
  /** Any slice centre off the axis (bend). */
  bent: boolean;
  /** max over the map of r + |C|: the skin never reaches beyond this radius about the axis. */
  reach: number;
}

/**
 * Mean and outermost skin radius about the axis, sampled on a fixed 256 × 64 grid so they do not depend on the
 * voxel (the hole map is keyed on them and must be the same at every voxel). The outer radius gets a 2 % + 0.5 mm
 * margin for peaks between samples; a larger r_out only makes teardrop roofs steeper.
 */
export function skinRadii(params: VaseParams): { mean: number; outer: number } {
  const key = skinKey(params, -1);
  if (radiiCache?.key === key) return radiiCache.radii;
  const field = compileField(params);
  const nT = 256;
  const nZ = 64;
  let sum = 0;
  let outer = 0;
  for (let j = 0; j < nZ; j++) {
    const row = field.row((field.H * j) / (nZ - 1));
    const off = Math.hypot(row.cx, row.cy);
    for (let i = 0; i < nT; i++) {
      let tw = (TAU * i) / nT - row.twist;
      tw -= TAU * Math.floor(tw / TAU);
      const r = Math.max(R_MIN, field.outerRaw(tw, Math.cos(tw), Math.sin(tw), row));
      sum += r;
      if (r + off > outer) outer = r + off;
    }
  }
  const radii = { mean: sum / (nT * nZ), outer: outer * 1.02 + 0.5 };
  radiiCache = { key, radii };
  return radii;
}
let radiiCache: { key: string; radii: { mean: number; outer: number } } | null = null;

const qualityFor = (voxel: number): Quality => (voxel >= 1.5 ? 'low' : voxel > 0.7 ? 'medium' : 'high');

/** Everything compileField reads; the map is a pure function of these and the voxel. */
export const skinKey = (p: VaseParams, voxel: number) =>
  JSON.stringify([
    voxel,
    p.dimensions,
    p.profile,
    p.section,
    p.twist,
    p.effects,
    p.rim.flare,
    p.rim.flareZone,
    p.base.footRing,
    p.print.maxOverhang,
  ]);
let cache: { key: string; map: SkinMap } | null = null;

/** Skin map, reused while only non-skin params change (insert, sleeve mesh, printer, …). */
export function buildSkinMap(params: VaseParams, voxel: number): SkinMap {
  const key = skinKey(params, voxel);
  if (cache?.key === key) return cache.map;
  const map = rasterise(params, voxel);
  cache = { key, map };
  return map;
}

function rasterise(params: VaseParams, voxel: number): SkinMap {
  const field = compileField(params);
  const H = field.H;
  const q = qualityFor(voxel);
  const plan = planGrid(field, q);
  const rRef = Math.max(params.dimensions.maxDiameter, params.dimensions.baseDiameter, params.dimensions.topDiameter);
  // half a voxel of arc at the widest radius, but never fewer columns than the grid path would use
  let nT = Math.max(plan.nTheta, Math.ceil((Math.PI * rRef) / (voxel / 2)));
  if (plan.k > 1) nT = plan.k * Math.ceil(nT / plan.k);
  nT = Math.min(nT, MAX_THETA);
  const nZ = Math.min(MAX_ROWS, Math.max(QUALITY_GRID[q].nZ, Math.ceil(H / (voxel / 2)) + 1));

  const r = new Float32Array(nT * nZ);
  const L = new Float32Array(nT * nZ);
  const cx = new Float64Array(nZ);
  const cy = new Float64Array(nZ);
  let reach = 0;
  let bent = false;
  for (let j = 0; j < nZ; j++) {
    const row = field.row((H * j) / (nZ - 1));
    cx[j] = row.cx;
    cy[j] = row.cy;
    if (row.cx !== 0 || row.cy !== 0) bent = true;
    const off = Math.hypot(row.cx, row.cy);
    for (let i = 0; i < nT; i++) {
      let tw = (TAU * i) / nT - row.twist;
      tw -= TAU * Math.floor(tw / TAU);
      const v = Math.max(R_MIN, field.outerRaw(tw, Math.cos(tw), Math.sin(tw), row));
      r[j * nT + i] = v;
      if (v + off > reach) reach = v + off;
    }
  }
  const dT = TAU / nT;
  const dZ = H / (nZ - 1);
  for (let j = 0; j < nZ; j++) {
    const jp = Math.min(nZ - 1, j + 1);
    const jm = Math.max(0, j - 1);
    for (let i = 0; i < nT; i++) {
      const o = j * nT + i;
      const rt = (r[j * nT + ((i + 1) % nT)] - r[j * nT + ((i - 1 + nT) % nT)]) / (2 * dT);
      const rz = (r[jp * nT + i] - r[jm * nT + i]) / ((jp - jm) * dZ);
      const g = rt / r[o];
      L[o] = 1 / Math.sqrt(1 + g * g + rz * rz);
    }
  }
  return { field, H, nT, nZ, r, L, cx, cy, bent, reach };
}
