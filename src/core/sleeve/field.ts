import { bottomHoleRadius, boreProfile, type BoreProfile } from '../insert';
import { TAU } from '../math';
import type { Lattice, SampledField } from '../mc/extract';
import type { VaseParams } from '../params/schema';
import { smax, smin } from '../sdf';
import { buildHoleMap, type HoleMap } from './holes';
import { buildSkinMap, skinRadii, type SkinMap } from './skin';
import { buildTopEdge, type TopEdge } from './topEdge';

/**
 * Sleeve SDF (docs/sleeve-integration.md §3; order fixed; fingers and drips arrive in S3):
 *   body = smin(skin, core tube R_bore + coreWall, coreBlend)
 *   body = smax(body, (z − Htop(φ)) / sqrt(1 + (Htop'/ρ)²), 1 mm)   top edge (sharp max(z − H) when flat)
 *   body = smax(body, −g_holes(φ, z), edgeRoundness)               openings with teardrop tops (holes.ts)
 *   body = max(body, −z)                         flat base, sharp
 *   body = max(body, −hole)                      exact bore, sharp, LAST
 * hole = min( max(ρ − R(φ, z), z_b − z),  ρ − r_hole )  where R(φ, z) is the S1 bore profile (ribs, grooves, both
 * chamfers); the r_hole term exists only for lip and drain bottoms (open: z_b = 0, floor: no term at all).
 */
export interface SleeveField {
  skin: SkinMap;
  prof: BoreProfile;
  top: TopEdge;
  holes: HoleMap | null;
  H: number;
  /** Bore radius, core-tube radius, bore wall start, bottom opening radius (0 = none), blend radius. */
  R: number;
  Rc: number;
  zb: number;
  hr: number;
  k: number;
  /** No material beyond this radius about the axis. */
  reach: number;
  at(x: number, y: number, z: number): number;
  sampled(lat: Lattice): SampledField;
}

/** Bore features (chamfers, grooves, ribs) stay within this distance of R_bore, so farther out R(φ, z) = R. */
const FEATURE_BAND = 4;

export function createSleeveField(params: VaseParams, voxel: number): SleeveField {
  const skin = buildSkinMap(params, voxel);
  const H = skin.H;
  const prof = boreProfile(params, H, H);
  const R = prof.bore.radius;
  const Rc = R + params.insert.coreWall;
  const zb = prof.zBottom;
  const hr = bottomHoleRadius(params.insert, R);
  const k = params.sleeve.coreBlend;
  const { nT, nZ, r: rMap, L: lMap, cx, cy } = skin;
  const top = buildTopEdge(params, H);
  // voxel-independent radii, so the cached hole map is the same at every voxel
  const radii = skinRadii(params);
  const holes = buildHoleMap(params, { H, R, zb, rRef: radii.mean, rOut: Math.max(radii.outer, Rc), top });
  const tScale = nT / TAU;
  const vScale = (nZ - 1) / H;

  const rowJ = (z: number) => {
    const v = Math.min(nZ - 1, Math.max(0, z * vScale));
    return Math.min(nZ - 2, Math.floor(v));
  };
  const rowF = (z: number, j0: number) => Math.min(nZ - 1, Math.max(0, z * vScale)) - j0;

  /** Composed value from axis polar coords (ρ, φ), slice-centre polar coords (ρc, θc) and the skin row. */
  const value = (rho: number, phi: number, rhoC: number, thC: number, z: number, j0: number, fv: number) => {
    let u = thC * tScale;
    if (u < 0) u += nT;
    let i0 = Math.floor(u);
    const fu = u - i0;
    if (i0 >= nT) i0 -= nT;
    const i1 = i0 + 1 === nT ? 0 : i0 + 1;
    const a = j0 * nT;
    const b = a + nT;
    const r0 = rMap[a + i0] + (rMap[a + i1] - rMap[a + i0]) * fu;
    const r1 = rMap[b + i0] + (rMap[b + i1] - rMap[b + i0]) * fu;
    const l0 = lMap[a + i0] + (lMap[a + i1] - lMap[a + i0]) * fu;
    const l1 = lMap[b + i0] + (lMap[b + i1] - lMap[b + i0]) * fu;
    const skinD = (rhoC - (r0 + (r1 - r0) * fv)) * (l0 + (l1 - l0) * fv);
    let d = smin(skinD, rho - Rc, k);
    if (top.flat) {
      if (z - H > d) d = z - H;
    } else {
      const s = top.slopeAt(phi) / Math.max(rho, 1e-6);
      d = smax(d, (z - top.at(phi)) / Math.sqrt(1 + s * s), top.k);
    }
    if (holes) d = smax(d, -holes.at(phi, z), holes.k);
    if (-z > d) d = -z;
    const Rz = Math.abs(rho - R) < FEATURE_BAND ? prof.radiusAt(phi < 0 ? phi + TAU : phi, z, H) : R;
    let hole = rho - Rz;
    if (zb - z > hole) hole = zb - z;
    if (hr > 0 && rho - hr < hole) hole = rho - hr;
    if (-hole > d) d = -hole;
    return d;
  };

  const at = (x: number, y: number, z: number) => {
    const j0 = rowJ(z);
    const fv = rowF(z, j0);
    const rho = Math.sqrt(x * x + y * y);
    const phi = Math.atan2(y, x);
    if (!skin.bent) return value(rho, phi, rho, phi, z, j0, fv);
    const dx = x - (cx[j0] + (cx[j0 + 1] - cx[j0]) * fv);
    const dy = y - (cy[j0] + (cy[j0 + 1] - cy[j0]) * fv);
    return value(rho, phi, Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx), z, j0, fv);
  };

  const sampled = (lat: Lattice): SampledField => {
    const { nx, ny, x0, y0, z0, h } = lat;
    // per-column polar coordinates about the axis, reused on every plane
    const colRho = new Float64Array(nx * ny);
    const colPhi = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * h;
        const y = y0 + j * h;
        colRho[j * nx + i] = Math.sqrt(x * x + y * y);
        colPhi[j * nx + i] = Math.atan2(y, x);
      }
    return {
      at,
      plane(kk, out, mask) {
        const z = z0 + kk * h;
        const j0 = rowJ(z);
        const fv = rowF(z, j0);
        const ccx = cx[j0] + (cx[j0 + 1] - cx[j0]) * fv;
        const ccy = cy[j0] + (cy[j0 + 1] - cy[j0]) * fv;
        for (let s = 0; s < nx * ny; s++) {
          if (!mask[s]) continue;
          const rho = colRho[s];
          const phi = colPhi[s];
          if (!skin.bent) out[s] = value(rho, phi, rho, phi, z, j0, fv);
          else {
            const x = x0 + (s % nx) * h - ccx;
            const y = y0 + Math.floor(s / nx) * h - ccy;
            out[s] = value(rho, phi, Math.sqrt(x * x + y * y), Math.atan2(y, x), z, j0, fv);
          }
        }
      },
    };
  };

  return { skin, prof, top, holes, H, R, Rc, zb, hr, k, reach: Math.max(skin.reach, Rc) + k / 4, at, sampled };
}
