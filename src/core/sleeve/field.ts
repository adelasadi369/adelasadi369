import { bottomHoleRadius, boreProfile, type BoreProfile } from '../insert';
import { TAU } from '../math';
import type { Lattice, SampledField } from '../mc/extract';
import type { VaseParams } from '../params/schema';
import { smax, smin } from '../sdf';
import { buildHoleMap, type HoleMap } from './holes';
import { buildSkinMap, lipschitzMap, skinRadii, type SkinMap } from './skin';
import { buildStrands, type Strands } from './strands';
import { buildTopEdge, type TopEdge } from './topEdge';

/**
 * Sleeve SDF (docs/sleeve-integration.md §3; order fixed):
 *   shell = max(skin, min(inner, (inner + ρ − Rc − G)/2, z − z_floor))   thin skin T (S4), when T > 0:
 *           inner = (r_in − ρc)·L with r_in = r − T/L swept self-supporting (innerMap), so the shell keeps the outer
 *           T mm of the skin; solid below the floor ring and where the gap to the core is < G = max(T, k)
 *   body = smin(skin', fingers ∪ drips, fingers.blend)  skin' = smax(shell, z − z_body, 2.5) with fingers (strands.ts)
 *   body = smin(body, core tube' R_bore + coreWall, coreBlend)   core' capped at z_body like the skin
 *   body = smax(body, (z − Htop(φ)) / sqrt(1 + (Htop'/ρ)²), 2.5 mm)   top edge (z − H when flat)
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
  strands: Strands;
  H: number;
  /** Bore radius, core-tube radius, bore wall start, bottom opening radius (0 = none), blend radius. */
  R: number;
  Rc: number;
  zb: number;
  hr: number;
  k: number;
  /** No material beyond this radius about the axis. */
  reach: number;
  /** Thin-shell thickness (0 = solid) and the floor ring height that closes the gap at the bottom. */
  T: number;
  zFloor: number;
  at(x: number, y: number, z: number): number;
  sampled(lat: Lattice): SampledField;
}

/** Bore features (chamfers, grooves, ribs) stay within this distance of R_bore, so farther out R(φ, z) = R. */
const FEATURE_BAND = 4;
/** Thin shell: lowest floor ring (mm) and the fillet between the floor ring and the shell's inner face. */
const FLOOR_MIN = 3;
const FLOOR_BLEND = 2;

/** Height of the solid floor ring that closes the shell–core gap at the bottom (thin shell only). */
export const floorRingHeight = (p: VaseParams, zb: number) => Math.max(p.sleeve.holes.keepOutBottom, FLOOR_MIN, zb + 1);

export function createSleeveField(params: VaseParams, voxel: number): SleeveField {
  const skin = buildSkinMap(params, voxel);
  const H = skin.H;
  const prof = boreProfile(params, H, H);
  const R = prof.bore.radius;
  const Rc = R + params.insert.coreWall;
  const zb = prof.zBottom;
  const hr = bottomHoleRadius(params.insert, R);
  const k = params.sleeve.coreBlend;
  const T = params.sleeve.skinThickness;
  const zFloor = floorRingHeight(params, zb);
  const G = Math.max(T, k);
  const { nT, nZ, r: rMap, L: lMap, cx, cy } = skin;
  const inn = T > 0 ? innerMap(skin, T, params.print.maxOverhang) : null;
  const top = buildTopEdge(params, H);
  // voxel-independent radii, so the cached hole map is the same at every voxel
  const radii = skinRadii(params);
  const strands = buildStrands(params, { field: skin.field, H, R, Rc, top });
  const zBody = strands.zBody;
  const capped = zBody < H;
  const anyStrand = strands.list.length > 0;
  const holes = buildHoleMap(params, {
    H,
    R,
    zb,
    rRef: radii.mean,
    rOut: Math.max(radii.outer, Rc, Math.min(strands.reach, radii.outer * 1.5)),
    top,
    cap: zBody,
  });
  // a thin shell's cut edges (rim, holes) are rounded by at most T/2: a larger smooth max would neck the wall
  const kTop = T > 0 ? Math.min(top.k, T / 2) : top.k;
  const kHole = holes ? (T > 0 ? Math.min(holes.k, T / 2) : holes.k) : 0;
  const tScale = nT / TAU;
  const vScale = (nZ - 1) / H;

  const rowJ = (z: number) => {
    const v = Math.min(nZ - 1, Math.max(0, z * vScale));
    return Math.min(nZ - 2, Math.floor(v));
  };
  const rowF = (z: number, j0: number) => Math.min(nZ - 1, Math.max(0, z * vScale)) - j0;

  /** Composed value from axis polar coords (ρ, φ), slice-centre polar coords (ρc, θc) and the skin row. */
  const value = (
    x: number,
    y: number,
    rho: number,
    phi: number,
    rhoC: number,
    thC: number,
    z: number,
    j0: number,
    fv: number,
  ) => {
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
    let skinD = (rhoC - (r0 + (r1 - r0) * fv)) * (l0 + (l1 - l0) * fv);
    let core = rho - Rc;
    if (inn) {
      // thin draped shell: keep the skin down to its self-supporting inner face, plus the floor ring and gaps to the
      // core narrower than G = max(T, coreBlend) (the smooth union below would otherwise web them with thin films)
      const { r: rI, L: lI } = inn;
      const n0 = rI[a + i0] + (rI[a + i1] - rI[a + i0]) * fu;
      const n1 = rI[b + i0] + (rI[b + i1] - rI[b + i0]) * fu;
      const m0 = lI[a + i0] + (lI[a + i1] - lI[a + i0]) * fu;
      const m1 = lI[b + i0] + (lI[b + i1] - lI[b + i0]) * fu;
      let inner = (n0 + (n1 - n0) * fv - rhoC) * (m0 + (m1 - m0) * fv);
      const gap = (inner + core - G) / 2;
      if (gap < inner) inner = gap;
      inner = smin(inner, z - zFloor, FLOOR_BLEND);
      if (inner > skinD) skinD = inner;
    }
    if (capped) {
      skinD = smax(skinD, z - zBody, kTop);
      core = smax(core, z - zBody, kTop);
    }
    let d = anyStrand ? smin(skinD, strands.at(x, y, z), strands.k) : skinD;
    d = smin(d, core, k);
    if (top.flat) d = smax(d, z - H, kTop);
    else {
      const s = top.slopeAt(phi) / Math.max(rho, 1e-6);
      d = smax(d, (z - top.at(phi)) / Math.sqrt(1 + s * s), kTop);
    }
    if (holes) d = smax(d, -holes.at(phi, z), kHole);
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
    if (!skin.bent) return value(x, y, rho, phi, rho, phi, z, j0, fv);
    const dx = x - (cx[j0] + (cx[j0 + 1] - cx[j0]) * fv);
    const dy = y - (cy[j0] + (cy[j0 + 1] - cy[j0]) * fv);
    return value(x, y, rho, phi, Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx), z, j0, fv);
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
          const x = x0 + (s % nx) * h;
          const y = y0 + Math.floor(s / nx) * h;
          if (!skin.bent) out[s] = value(x, y, rho, phi, rho, phi, z, j0, fv);
          else {
            const u = x - ccx;
            const w = y - ccy;
            out[s] = value(x, y, rho, phi, Math.sqrt(u * u + w * w), Math.atan2(w, u), z, j0, fv);
          }
        }
      },
    };
  };

  const reach = Math.max(skin.reach, Rc, strands.reach) + Math.max(k, strands.k) / 4;
  return { skin, prof, top, holes, strands, H, R, Rc, zb, hr, k, reach, T, zFloor, at, sampled };
}

/**
 * Inner face of the thin shell as its own radius map: the skin eroded by a ball of radius T in map coordinates,
 *   r_in(θ, z) = min over |s| < T of  r(θ + Δθ, z + Δz) − sqrt(T² − s²),   s² = (r̄_row·Δθ)² + Δz²
 * (every point within T of the outer face, so the wall is T thick along the normal; a plain radial offset r − T/L
 * leaves fins under steep rib flanks). Then made self-supporting: sweeping down each column,
 * r_in(j) ≤ r_in(j + 1) + dz·tan(maxOverhang − 2°). Where the skin leans inward faster than that, the shell thickens
 * below the lean instead of hanging over the gap (supports could never be removed from there); the outer face is
 * untouched. It gets its own Lipschitz map (L of the skin is wrong T mm inside it).
 */
function innerMap(skin: SkinMap, T: number, maxOverhang: number) {
  const { nT, nZ, r: rS, H } = skin;
  const r = new Float32Array(nT * nZ);
  const dT = TAU / nT;
  const dZ = H / (nZ - 1);
  const J = Math.floor(T / dZ);
  // at fine voxels the ball spans hundreds of cells: sample it every `sz` rows / `st` columns (≤ ~7 per radius);
  // the skipped cells are at most a map cell away from a sampled one, far below the wall tolerance
  const sz = Math.max(1, Math.ceil(J / 7));
  const di: number[] = [];
  const dj: number[] = [];
  const cap: number[] = [];
  for (let j = 0; j < nZ; j++) {
    let mean = 0;
    for (let i = 0; i < nT; i++) mean += rS[j * nT + i];
    const arc = Math.max(1e-3, (mean / nT) * dT);
    const I = Math.min(nT >> 1, Math.floor(T / arc));
    const st = Math.max(1, Math.ceil(I / 7));
    di.length = dj.length = cap.length = 0;
    for (let b = -J; b <= J; b++) {
      const jj = j + b;
      if (jj < 0 || jj >= nZ || b % sz !== 0) continue;
      for (let a = -I; a <= I; a++) {
        if (a % st !== 0) continue;
        const s2 = (a * arc) ** 2 + (b * dZ) ** 2;
        if (s2 >= T * T) continue;
        di.push(a);
        dj.push(jj * nT);
        cap.push(Math.sqrt(T * T - s2));
      }
    }
    const n = cap.length;
    for (let i = 0; i < nT; i++) {
      let m = Infinity;
      for (let q = 0; q < n; q++) {
        let ii = i + di[q];
        if (ii < 0) ii += nT;
        else if (ii >= nT) ii -= nT;
        const v = rS[dj[q] + ii] - cap[q];
        if (v < m) m = v;
      }
      r[j * nT + i] = m;
    }
  }
  const g = dZ * Math.tan((maxOverhang - 2) * (Math.PI / 180));
  for (let j = nZ - 2; j >= 0; j--)
    for (let i = 0; i < nT; i++) {
      const lim = r[(j + 1) * nT + i] + g;
      if (r[j * nT + i] > lim) r[j * nT + i] = lim;
    }
  const L = new Float32Array(nT * nZ);
  lipschitzMap(r, L, nT, nZ, H);
  return { r, L };
}
