import {
  boreBottom,
  boreMinColumns,
  bottomHoleRadius,
  boreProfile,
  boreRay,
  FIT_RING_HEIGHT,
  isBoreLiner,
  type BoreProfile,
} from '../insert';
import { DEG, TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { compileField, R_MIN, type Field, type Row } from './field';
import { buildRows, MAX_THETA, planGrid, rowBreakpoints, type GridPlan, type Quality } from './grid';
import { QUALITY_GRID } from '../params/schema';

export type SurfaceKind =
  'outer' | 'inner' | 'rim' | 'top' | 'bottom' | 'floor' | 'bottomRing' | 'hole' | 'seam' | 'slit';

export interface Surface {
  kind: SurfaceKind;
  firstVertex: number;
  /** Grid rows (fans: 1 ring + centre; raw faces: 0). */
  rows: number;
  /** Vertices per grid row. */
  cols: number;
  fan: boolean;
  firstTri: number;
  triCount: number;
}

export interface VaseMesh {
  mode: VaseParams['print']['outputMode'];
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Maps split (render-only) vertices to the canonical welded vertex. */
  canonical: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  nTheta: number;
  nZ: number;
  surfaces: Surface[];
  /** Outer row heights (before ruffle/slant remapping). */
  rows: Float64Array;
  height: number;
  /** Vertices where r was clamped to R_MIN. */
  clamped: number;
  /** Inner vertices narrower than 2 mm (shell). */
  innerTooNarrow: number;
  /** Drainage hole had to be shrunk to fit inside the floor. */
  holeClamped: boolean;
  plan: GridPlan;
  /** Shell bore liner only. */
  bore?: BoreInfo;
}

/** What the printability checks need to know about the bore liner (all lengths mm). */
export interface BoreInfo {
  radius: number;
  /** Bore wall start (top of floor/lip, 0 when open). */
  zBottom: number;
  /** Nominal flat bore top (before ruffle/slant). */
  zTop: number;
  coreWall: number;
  /** Smallest horizontal wall r_outer − r_bore along the slice rays. */
  minWall: number;
  /** Height range where the wall is thinner than coreWall, or null. */
  thin: [number, number] | null;
  /** Uniform scale of the outer radii that restores coreWall everywhere (≥ 1). */
  scaleNeeded: number;
  /** Vertices whose slice centre lies outside the bore (bend too strong for a straight tube). */
  offAxis: number;
}

export interface BuildResult {
  mesh: VaseMesh;
  field: Field;
  /** Saucer body (separate object) when enabled. */
  saucer?: VaseMesh;
}

const RIM_SEGMENTS = 6;
const DOME_RINGS = 8;
/** Double-wall slit width in mm (merged by the slicer, splits the contour into one C-shape). */
export const SLIT_WIDTH = 0.0001;

type Ring = Float64Array; // x,y,z interleaved

class Builder {
  pos = new Float32Array(3 * 4096);
  nrm = new Float32Array(3 * 4096);
  idx = new Uint32Array(3 * 8192);
  canon = new Uint32Array(4096);
  v = 0;
  t = 0;
  surfaces: Surface[] = [];

  private reserve(nv: number, nt: number) {
    if (this.v + nv > this.canon.length) {
      let cap = this.canon.length;
      while (cap < this.v + nv) cap *= 2;
      const grow = <T extends Float32Array | Uint32Array>(a: T, n: number): T => {
        const b = new (a.constructor as { new (n: number): T })(n);
        b.set(a);
        return b;
      };
      this.pos = grow(this.pos, cap * 3);
      this.nrm = grow(this.nrm, cap * 3);
      this.canon = grow(this.canon, cap);
    }
    if (this.t + nt > this.idx.length / 3) {
      let cap = this.idx.length / 3;
      while (cap < this.t + nt) cap *= 2;
      const b = new Uint32Array(cap * 3);
      b.set(this.idx);
      this.idx = b;
    }
  }

  private tri(a: number, b: number, c: number) {
    const o = this.t * 3;
    this.idx[o] = a;
    this.idx[o + 1] = b;
    this.idx[o + 2] = c;
    this.t++;
  }

  private put(vi: number, x: number, y: number, z: number, canon: number) {
    this.pos[vi * 3] = x;
    this.pos[vi * 3 + 1] = y;
    this.pos[vi * 3 + 2] = z;
    this.canon[vi] = canon;
  }

  private d2(p: number, q: number) {
    const P = this.pos;
    const dx = P[p * 3] - P[q * 3];
    const dy = P[p * 3 + 1] - P[q * 3 + 1];
    const dz = P[p * 3 + 2] - P[q * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Grid surface from rows of rings. `canonRows[r]` is the first vertex of an already-emitted ring this row
   * duplicates (or −1). Winding gives normals = dθ × drow. Non-periodic grids have no closing column quad.
   * Returns the first vertex index.
   */
  grid(kind: SurfaceKind, rings: Ring[], canonRows: number[], periodic = true): number {
    const nC = rings[0].length / 3;
    const nR = rings.length;
    this.reserve(nR * nC, 2 * nR * nC);
    const first = this.v;
    const firstTri = this.t;
    for (let r = 0; r < nR; r++) {
      const ring = rings[r];
      const c0 = canonRows[r];
      for (let i = 0; i < nC; i++) {
        const vi = first + r * nC + i;
        this.put(vi, ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], c0 >= 0 ? c0 + i : vi);
      }
    }
    for (let r = 0; r < nR; r++) {
      const rp = rings[Math.min(nR - 1, r + 1)];
      const rm = rings[Math.max(0, r - 1)];
      const ring = rings[r];
      for (let i = 0; i < nC; i++) {
        const ipI = periodic ? (i + 1) % nC : Math.min(nC - 1, i + 1);
        const imI = periodic ? (i - 1 + nC) % nC : Math.max(0, i - 1);
        const ip = ipI * 3;
        const im = imI * 3;
        const ax = ring[ip] - ring[im];
        const ay = ring[ip + 1] - ring[im + 1];
        const az = ring[ip + 2] - ring[im + 2];
        const o = i * 3;
        const bx = rp[o] - rm[o];
        const by = rp[o + 1] - rm[o + 1];
        const bz = rp[o + 2] - rm[o + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const vi = (first + r * nC + i) * 3;
        this.nrm[vi] = nx;
        this.nrm[vi + 1] = ny;
        this.nrm[vi + 2] = nz;
      }
    }
    const last = periodic ? nC : nC - 1;
    for (let r = 0; r < nR - 1; r++) {
      for (let i = 0; i < last; i++) {
        const i1 = (i + 1) % nC;
        const a = first + r * nC + i;
        const b = first + r * nC + i1;
        const c = first + (r + 1) * nC + i1;
        const d = first + (r + 1) * nC + i;
        if (this.d2(a, c) <= this.d2(b, d)) {
          this.tri(a, b, c);
          this.tri(a, c, d);
        } else {
          this.tri(a, b, d);
          this.tri(b, c, d);
        }
      }
    }
    this.v += nR * nC;
    this.surfaces.push({
      kind,
      firstVertex: first,
      rows: nR,
      cols: nC,
      fan: false,
      firstTri,
      triCount: this.t - firstTri,
    });
    return first;
  }

  /** Flat cap fan around (cx, cy, z) over a closed ring. up=true → normal +z. */
  fan(kind: SurfaceKind, ring: Ring, canonFirst: number, cx: number, cy: number, z: number, up: boolean) {
    const nC = ring.length / 3;
    this.reserve(nC + 1, nC);
    const first = this.v;
    const firstTri = this.t;
    const nz = up ? 1 : -1;
    for (let i = 0; i < nC; i++) {
      this.put(first + i, ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], canonFirst + i);
      this.nrm[(first + i) * 3 + 2] = nz;
    }
    const c = first + nC;
    this.put(c, cx, cy, z, c);
    this.nrm[c * 3 + 2] = nz;
    for (let i = 0; i < nC; i++) {
      const i1 = (i + 1) % nC;
      if (up) this.tri(c, first + i, first + i1);
      else this.tri(c, first + i1, first + i);
    }
    this.v += nC + 1;
    this.surfaces.push({ kind, firstVertex: first, rows: 1, cols: nC, fan: true, firstTri, triCount: nC });
  }

  /**
   * Planar faces made of duplicates of existing vertices (flat-shaded). Triangles are given as canonical
   * vertex triples; the whole set is flipped if its first normal disagrees with `facing`.
   */
  faces(kind: SurfaceKind, tris: [number, number, number][], facing: [number, number, number]) {
    if (!tris.length) return;
    this.reserve(tris.length * 3, tris.length);
    const firstTri = this.t;
    const first = this.v;
    const P = this.pos;
    // orientation from the largest triangle
    let best = 0;
    let bestA = -1;
    const cross = (t: [number, number, number]) => {
      const [a, b, c] = t;
      const ux = P[b * 3] - P[a * 3],
        uy = P[b * 3 + 1] - P[a * 3 + 1],
        uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3],
        vy = P[c * 3 + 1] - P[a * 3 + 1],
        vz = P[c * 3 + 2] - P[a * 3 + 2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    tris.forEach((t, k) => {
      const [x, y, z] = cross(t);
      const a = x * x + y * y + z * z;
      if (a > bestA) {
        bestA = a;
        best = k;
      }
    });
    const [nx, ny, nz] = cross(tris[best]);
    const flip = nx * facing[0] + ny * facing[1] + nz * facing[2] < 0;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const s = flip ? -1 / l : 1 / l;
    for (const t of tris) {
      const ids = flip ? [t[0], t[2], t[1]] : t;
      const vs = ids.map((src) => {
        const vi = this.v++;
        this.put(vi, P[src * 3], P[src * 3 + 1], P[src * 3 + 2], this.canon[src]);
        this.nrm[vi * 3] = nx * s;
        this.nrm[vi * 3 + 1] = ny * s;
        this.nrm[vi * 3 + 2] = nz * s;
        return vi;
      });
      this.tri(vs[0], vs[1], vs[2]);
    }
    this.surfaces.push({
      kind,
      firstVertex: first,
      rows: 0,
      cols: 0,
      fan: false,
      firstTri,
      triCount: this.t - firstTri,
    });
  }

  finish() {
    return {
      positions: this.pos.slice(0, this.v * 3),
      normals: this.nrm.slice(0, this.v * 3),
      indices: this.idx.slice(0, this.t * 3),
      canonical: this.canon.slice(0, this.v),
      vertexCount: this.v,
      triangleCount: this.t,
    };
  }
}

function smooth01(x: number) {
  const u = x < 0 ? 0 : x > 1 ? 1 : x;
  return u * u * (3 - 2 * u);
}

/** Per-vertex placement data (columns may carry their own z/twist inside the ruffle/slant zone). */
interface Grid {
  nC: number;
  nZ: number;
  /** Warped evaluation angle θw. */
  thw: Float64Array;
  /** Actual placement angle (θw + twist) including slit offsets. */
  ang: Float64Array;
  z: Float64Array;
  cx: Float64Array;
  cy: Float64Array;
}

function ringOf(g: Grid, rad: Float64Array, j: number, angOffset?: (i: number, r: number) => number): Ring {
  const ring = new Float64Array(g.nC * 3);
  for (let i = 0; i < g.nC; i++) {
    const o = j * g.nC + i;
    const r = rad[o];
    const a = g.ang[o] + (angOffset ? angOffset(i, r) : 0);
    ring[i * 3] = g.cx[o] + r * Math.cos(a);
    ring[i * 3 + 1] = g.cy[o] + r * Math.sin(a);
    ring[i * 3 + 2] = g.z[o];
  }
  return ring;
}

/** Points scaled about (cx, cy) by s, at height z. */
function scaledRing(src: Ring, cx: number, cy: number, s: number, z: number): Ring {
  const n = src.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = cx + s * (src[i * 3] - cx);
    out[i * 3 + 1] = cy + s * (src[i * 3 + 1] - cy);
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Circle of radius hr around (cx, cy) using the angular directions of `src` about the same centre. */
function circleRing(src: Ring, cx: number, cy: number, hr: number, z: number): Ring {
  const n = src.length / 3;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(src[i * 3 + 1] - cy, src[i * 3] - cx);
    out[i * 3] = cx + hr * Math.cos(a);
    out[i * 3 + 1] = cy + hr * Math.sin(a);
    out[i * 3 + 2] = z;
  }
  return out;
}

function minRadius(ring: Ring, cx: number, cy: number): number {
  let m = Infinity;
  for (let i = 0; i < ring.length; i += 3) m = Math.min(m, Math.hypot(ring[i] - cx, ring[i + 1] - cy));
  return m;
}

/** Build the printable mesh for the given params. Pure and deterministic. */
export function buildMesh(params: VaseParams, quality: Quality): BuildResult {
  const field = compileField(params);
  const plan = planGrid(field, quality);
  const { nTheta: nT, nZ } = plan;
  const mode = params.print.outputMode;
  const shell = mode !== 'solidVase';
  const doubleWall = mode === 'doubleWallVase';
  const fullShell = mode === 'shell';
  const boreMode = isBoreLiner(params);
  const H = field.H;
  const wall = params.print.wallThickness;
  const lip = shell && !boreMode ? params.rim.lipThickness : 0;
  const round = shell && params.rim.round;
  const rho = round ? (wall + lip) / 2 : 0;
  const Hw = H - rho;
  const concave = fullShell && !boreMode ? params.base.concave : 0;
  let zFloor = shell ? Math.min(boreMode ? boreBottom(params.insert) : params.base.bottomThickness, Hw * 0.5) : 0;
  if (doubleWall) zFloor = Math.max(zFloor, 0.8);
  if (concave > 0) zFloor = Math.max(zFloor, concave + 1.2);

  // ---- ruffle / slanted rim (shell only): per-column top height
  const ruffle = fullShell && params.rim.ruffle.count > 0 && params.rim.ruffle.depth > 0 ? params.rim.ruffle : null;
  const slant = fullShell ? params.rim.slant.height : 0;
  const cutDepth = (ruffle ? ruffle.depth : 0) + slant;
  const zS = cutDepth > 0 ? Math.max(zFloor + 2, Hw - cutDepth - 2) : Hw;

  const breaks = rowBreakpoints(params, H, zFloor, field);
  if (cutDepth > 0) breaks.push(zS);
  const prof: BoreProfile | null = boreMode ? boreProfile(params, Hw, H) : null;
  if (prof) breaks.push(...prof.breaks);
  const rows = buildRows(nZ, Hw, breaks);
  let jFloor = 0;
  if (zFloor > 0) {
    let best = 1;
    for (let j = 1; j < nZ - 1; j++) if (Math.abs(rows[j] - zFloor) < Math.abs(rows[best] - zFloor)) best = j;
    rows[best] = zFloor;
    jFloor = best;
  }

  const rowCtx: Row[] = new Array(nZ);
  for (let j = 0; j < nZ; j++) rowCtx[j] = field.row(rows[j]);

  // ---- per-vertex grid (double wall adds a duplicated seam column)
  const nC = doubleWall ? nT + 1 : nT;
  const N = nZ * nC;
  const g: Grid = {
    nC,
    nZ,
    thw: new Float64Array(N),
    ang: new Float64Array(N),
    z: new Float64Array(N),
    cx: new Float64Array(N),
    cy: new Float64Array(N),
  };
  const topTwist = field.twistFn(1) + plan.shear(1);
  const zTopCol = (thw: number) => {
    let z = Hw;
    if (ruffle) z -= (ruffle.depth * (1 - Math.cos(ruffle.count * thw))) / 2;
    if (slant > 0) z -= slant / 2 + (slant / 2) * Math.cos(thw + topTwist - params.rim.slant.angle * DEG);
    return z;
  };
  const rOut = new Float64Array(N);
  const rBase = shell ? new Float64Array(N) : null;
  let clamped = 0;
  for (let j = 0; j < nZ; j++) {
    const row0 = rowCtx[j];
    const sh = plan.shear(row0.t);
    for (let i = 0; i < nC; i++) {
      const o = j * nC + i;
      const thw = (TAU * i) / nT + sh;
      let row = row0;
      let z = rows[j];
      if (cutDepth > 0 && z > zS) {
        z = zS + ((z - zS) * (zTopCol(thw) - zS)) / (Hw - zS);
        row = field.row(z);
      }
      const c = Math.cos(thw);
      const s = Math.sin(thw);
      let r = field.outerRaw(thw, c, s, row);
      if (r < R_MIN) {
        r = R_MIN;
        clamped++;
      }
      rOut[o] = r;
      if (rBase) rBase[o] = Math.max(R_MIN, field.base(thw, row));
      g.thw[o] = thw;
      g.ang[o] = thw + row.twist;
      g.z[o] = z;
      g.cx[o] = row.cx;
      g.cy[o] = row.cy;
    }
  }

  // 45° chamfer line from the row at z = c; never makes the wall lean more than max(profile, 45°).
  const chamfer = params.base.chamfer;
  if (chamfer > 0) {
    let jc = 0;
    for (let j = 0; j < nZ; j++) if (Math.abs(rows[j] - chamfer) < Math.abs(rows[jc] - chamfer)) jc = j;
    const zc = rows[jc];
    for (let j = 0; j < jc; j++) {
      const drop = zc - rows[j];
      for (let i = 0; i < nC; i++) {
        const line = rOut[jc * nC + i] - drop;
        if (line < rOut[j * nC + i]) rOut[j * nC + i] = Math.max(R_MIN, line);
      }
    }
  }

  // slit: columns 0 and nT are pushed ±(w/2) apart along the circumference
  const slitOffset = doubleWall
    ? (i: number, r: number) => (i === 0 ? 1 : i === nT ? -1 : 0) * (SLIT_WIDTH / 2 / r)
    : undefined;
  const outerRings: Ring[] = [];
  for (let j = 0; j < nZ; j++) outerRings.push(ringOf(g, rOut, j, slitOffset));

  const B = new Builder();
  const outerFirst = B.grid(
    'outer',
    outerRings,
    outerRings.map(() => -1),
    !doubleWall,
  );
  const outerAt = (j: number, i: number) => outerFirst + j * nC + i;
  let innerTooNarrow = 0;
  let holeClamped = false;
  let bore: BoreInfo | undefined;

  if (!shell) {
    const r0 = rowCtx[0];
    const rt = rowCtx[nZ - 1];
    B.fan('bottom', outerRings[0], outerFirst, r0.cx, r0.cy, 0, false);
    B.fan('top', outerRings[nZ - 1], outerAt(nZ - 1, 0), rt.cx, rt.cy, rows[nZ - 1], true);
  } else {
    const rIn = innerRadii();
    const innerRingsUp: Ring[] = [];
    for (let j = jFloor; j < nZ; j++) innerRingsUp.push(ringOf(g, rIn, j, slitOffset));
    const nIn = innerRingsUp.length;

    // rim (outer top → inner top)
    const rimRings: Ring[] = [outerRings[nZ - 1]];
    const arcRad = new Float64Array(N);
    const arcZ = new Float64Array(nC);
    if (round) {
      for (let k = 1; k < RIM_SEGMENTS; k++) {
        const phi = (Math.PI * k) / RIM_SEGMENTS;
        const o = (nZ - 1) * nC;
        for (let i = 0; i < nC; i++) {
          const ro = rOut[o + i];
          const ri = rIn[o + i];
          arcRad[o + i] = (ro + ri) / 2 + ((ro - ri) / 2) * Math.cos(phi);
          arcZ[i] = g.z[o + i];
        }
        const ring = ringOf(g, arcRad, nZ - 1, slitOffset);
        for (let i = 0; i < nC; i++) ring[i * 3 + 2] = arcZ[i] + rho * Math.sin(phi);
        rimRings.push(ring);
      }
    }
    rimRings.push(innerRingsUp[nIn - 1]);
    const rimCanon = rimRings.map(() => -1);
    rimCanon[0] = outerAt(nZ - 1, 0);
    const rimFirst = B.v;
    const innerFirst = rimFirst + rimRings.length * nC;
    rimCanon[rimRings.length - 1] = innerFirst; // inner grid row 0 = top ring
    B.grid('rim', rimRings, rimCanon, !doubleWall);

    const innerDown = innerRingsUp.slice().reverse();
    B.grid(
      'inner',
      innerDown,
      innerDown.map(() => -1),
      !doubleWall,
    );
    const innerAt = (jj: number, i: number) => innerFirst + (nZ - 1 - jj) * nC + i; // jj = outer row index
    const innerBottom = innerAt(jFloor, 0);
    const r0 = rowCtx[0];
    const rf = rowCtx[jFloor];

    if (doubleWall) {
      // seam strip below the floor joins the two slit sides
      const seamRings = outerRings.slice(0, jFloor + 1).map((ring) => {
        const out = new Float64Array(6);
        out.set(ring.subarray(nT * 3, nT * 3 + 3), 0);
        out.set(ring.subarray(0, 3), 3);
        return out;
      });
      const seamFirst = B.v;
      B.grid(
        'seam',
        seamRings,
        seamRings.map(() => -1),
        false,
      );
      // weld the strip to the outer grid
      for (let j = 0; j <= jFloor; j++) {
        B.canon[seamFirst + j * 2] = outerAt(j, nT);
        B.canon[seamFirst + j * 2 + 1] = outerAt(j, 0);
      }
      // slit faces: radial strips from the floor to the rim on both sides of the cut
      for (const [col, dir] of [
        [0, -1],
        [nT, 1],
      ] as const) {
        const tris: [number, number, number][] = [];
        for (let j = jFloor; j < nZ - 1; j++) {
          const o0 = outerAt(j, col);
          const o1 = outerAt(j + 1, col);
          const i0 = innerAt(j, col);
          const i1 = innerAt(j + 1, col);
          tris.push([o0, o1, i1], [o0, i1, i0]);
        }
        const oTop = outerAt(nZ - 1, col);
        const arc: number[] = [];
        for (let k = 1; k < rimRings.length - 1; k++) arc.push(rimFirst + k * nC + col);
        const chain = [...arc, innerAt(nZ - 1, col)];
        for (let k = 0; k < chain.length - 1; k++) tris.push([oTop, chain[k], chain[k + 1]]);
        const a = g.ang[(nZ - 1) * nC + col];
        // facing the slit gap: −θ̂ for the +δ side (col 0), +θ̂ for the −δ side (col nT)
        B.faces('slit', tris, [-dir * Math.sin(a), dir * Math.cos(a), 0]);
      }
      // floor: fan over the inner ring (its wedge closes the seam) + the slit gap at floor height
      B.fan('floor', innerDown[nIn - 1], innerBottom, rf.cx, rf.cy, zFloor, true);
      B.faces(
        'floor',
        [
          [outerAt(jFloor, nT), outerAt(jFloor, 0), innerAt(jFloor, 0)],
          [outerAt(jFloor, nT), innerAt(jFloor, 0), innerAt(jFloor, nT)],
        ],
        [0, 0, 1],
      );
      B.fan('bottom', outerRings[0], outerFirst, r0.cx, r0.cy, 0, false);
    } else if (zFloor <= 0) {
      B.grid('bottomRing', [innerDown[nIn - 1], outerRings[0]], [innerBottom, outerFirst]);
    } else {
      bottomAndFloor(innerDown[nIn - 1], innerBottom, rf);
    }

    // ------------------------------------------------------------------
    function bottomAndFloor(innerFloorRing: Ring, innerFloorFirst: number, rfl: Row) {
      const c0x = r0.cx;
      const c0y = r0.cy;
      const outer0 = outerRings[0];
      const rminOuter = minRadius(outer0, c0x, c0y);
      const rminFloor = minRadius(innerFloorRing, rfl.cx, rfl.cy);
      let hr = prof ? bottomHoleRadius(params.insert, prof.bore.radius) : fullShell ? params.base.drainageHole / 2 : 0;
      // a bore lip only needs to stay inside the bore; a drainage hole keeps 40 % of the floor
      const hrMax = prof ? Math.min(rminOuter, rminFloor) - 1 : 0.6 * Math.min(rminOuter, rminFloor);
      if (hr > hrMax) {
        hr = hrMax;
        holeClamped = true;
      }
      const dome = (s: number) => (concave > 0 ? concave * Math.max(0, 1 - (s / 0.8) ** 2) : 0);
      const domeAtRadius = (r: number) => dome(r / rminOuter);

      // floor (normal up, rows outer → inner)
      let floorHoleFirst = -1;
      if (hr > 0) {
        const holeTop = circleRing(innerFloorRing, c0x, c0y, hr, zFloor);
        floorHoleFirst = B.grid('floor', [innerFloorRing, holeTop], [innerFloorFirst, -1]) + nC;
      } else {
        B.fan('floor', innerFloorRing, innerFloorFirst, rfl.cx, rfl.cy, zFloor, true);
      }

      // bottom (normal down, rows inner → outer)
      const ringsIn: Ring[] = [];
      const sMin = hr > 0 ? Math.min(0.95, (hr / rminOuter) * 1.15) : 0.1;
      const K = concave > 0 ? DOME_RINGS : 0;
      const holeBottom = hr > 0 ? circleRing(outer0, c0x, c0y, hr, domeAtRadius(hr)) : null;
      if (holeBottom) ringsIn.push(holeBottom);
      for (let k = 0; k < K; k++) {
        const s = sMin + ((1 - sMin) * k) / K;
        ringsIn.push(scaledRing(outer0, c0x, c0y, s, dome(s)));
      }
      if (!holeBottom && K === 0) {
        B.fan('bottom', outer0, outerFirst, c0x, c0y, 0, false);
        return;
      }
      const bottomRings = [...ringsIn, outer0];
      const canon = bottomRings.map(() => -1);
      canon[bottomRings.length - 1] = outerFirst;
      const bottomFirst = B.grid('bottom', bottomRings, canon);
      if (!holeBottom) {
        // dome centre
        B.fan('bottom', ringsIn[0], bottomFirst, c0x, c0y, dome(0), false);
      } else {
        // hole wall (normal into the hole, rows top → bottom)
        B.grid('hole', [circleRing(innerFloorRing, c0x, c0y, hr, zFloor), holeBottom], [floorHoleFirst, bottomFirst]);
      }
    }
  }

  // ---- inner radii (shell): smooth liner, follow (exact sampled erosion) or bore, see GEOMETRY.md §7
  function innerRadii(): Float64Array {
    const rIn = new Float64Array(N);
    if (prof) return boreRadii(rIn, prof);
    const dTheta = TAU / nT;
    const lipZone = Math.max(3 * lip, 4);
    const follow = params.print.innerSurface === 'follow';
    const cosBeta = (rad: Float64Array, j: number, i: number) => {
      const o = j * nC;
      const r = rad[o + i];
      const fT = (rad[o + ((i + 1) % nT)] - rad[o + ((i - 1 + nT) % nT)]) / (2 * dTheta);
      const jp = Math.min(nZ - 1, j + 1);
      const jm = Math.max(0, j - 1);
      const dz = g.z[jp * nC + i] - g.z[jm * nC + i] || 1e-6;
      const fZ = (rad[jp * nC + i] - rad[jm * nC + i]) / dz;
      const dTw = (g.ang[jp * nC + i] - g.thw[jp * nC + i] - (g.ang[jm * nC + i] - g.thw[jm * nC + i])) / dz;
      const rz = fZ - fT * dTw;
      return 1 / Math.sqrt(1 + (fT / r) * (fT / r) + rz * rz);
    };
    for (let j = jFloor; j < nZ; j++) {
      let inward = 0;
      for (let i = 0; i < nT; i++) inward = Math.max(inward, rBase![j * nC + i] - rOut[j * nC + i]);
      for (let i = 0; i < nC; i++) {
        const o = j * nC + i;
        const ic = i % nT;
        const lipCut = lip > 0 ? lip * smooth01((g.z[o] - (g.z[(nZ - 1) * nC + i] - lipZone)) / lipZone) : 0;
        let r: number;
        if (follow) r = erosion(j, ic);
        else {
          const liner = rBase![j * nC + ic] - wall / Math.max(0.3, cosBeta(rBase!, j, ic)) - inward;
          const fol = rOut[j * nC + ic] - wall / Math.max(0.3, cosBeta(rOut, j, ic));
          r = Math.min(liner, fol);
        }
        r -= lipCut;
        if (r < 2) innerTooNarrow++;
        if (r < 0.5) r = 0.5;
        rIn[o] = r;
      }
    }
    return rIn;

    /** Exact bore: each ray from the slice centre stops on the bore profile about the vertical axis. */
    function boreRadii(out: Float64Array, pr: BoreProfile): Float64Array {
      const coreWall = params.insert.coreWall;
      let minWall = Infinity;
      let scaleNeeded = 1;
      let offAxis = 0;
      let thin: [number, number] | null = null;
      for (let j = jFloor; j < nZ; j++) {
        for (let i = 0; i < nC; i++) {
          const o = j * nC + i;
          const zTop = g.z[(nZ - 1) * nC + i];
          let r = boreRay(pr, g.cx[o], g.cy[o], g.ang[o], g.z[o], zTop);
          if (Number.isNaN(r)) {
            offAxis++;
            r = Math.max(0.5, rOut[o] - wall);
          }
          out[o] = r;
          const w = rOut[o] - r;
          if (w < minWall) minWall = w;
          if (w < coreWall) {
            const z = g.z[o];
            thin = thin ? [Math.min(thin[0], z), Math.max(thin[1], z)] : [z, z];
            scaleNeeded = Math.max(scaleNeeded, (r + coreWall) / rOut[o]);
          }
        }
      }
      bore = { radius: pr.bore.radius, zBottom: pr.zBottom, zTop: Hw, coreWall, minWall, thin, scaleNeeded, offAxis };
      return out;
    }

    /** Inner boundary of the outer solid eroded by a ball of radius `wall`, sampled on the grid. */
    function erosion(j: number, i: number): number {
      const o = j * nC + i;
      const z0 = g.z[o];
      const a0 = g.ang[o];
      const cx0 = g.cx[o];
      const cy0 = g.cy[o];
      let best = rOut[o] - wall;
      for (let jj = j; jj >= 0 && z0 - g.z[jj * nC + i] < wall; jj--) scanRow(jj);
      for (let jj = j + 1; jj < nZ && g.z[jj * nC + i] - z0 < wall; jj++) scanRow(jj);
      return best;
      function scanRow(jj: number) {
        const dz = g.z[jj * nC + i] - z0;
        const w2 = wall * wall - dz * dz;
        if (w2 <= 0) return;
        const rq = rOut[jj * nC + i];
        const span = Math.min(nT >> 1, Math.ceil(Math.sqrt(w2) / (rq * dTheta)) + 1);
        for (let di = -span; di <= span; di++) {
          const q = jj * nC + ((i + di + nT) % nT);
          const r = rOut[q];
          // q relative to this ray's centre
          const qx = g.cx[q] + r * Math.cos(g.ang[q]) - cx0;
          const qy = g.cy[q] + r * Math.sin(g.ang[q]) - cy0;
          const along = qx * Math.cos(a0) + qy * Math.sin(a0);
          const perp2 = qx * qx + qy * qy - along * along;
          if (perp2 >= w2) continue;
          const near = along - Math.sqrt(w2 - perp2);
          if (near < best) best = near;
        }
      }
    }
  }

  const raw = B.finish();
  let maxZ = 0;
  for (let i = 2; i < raw.positions.length; i += 3) if (raw.positions[i] > maxZ) maxZ = raw.positions[i];
  const mesh: VaseMesh = {
    mode,
    ...raw,
    nTheta: nT,
    nZ,
    surfaces: B.surfaces,
    rows,
    height: maxZ,
    clamped,
    innerTooNarrow,
    holeClamped,
    plan,
    bore,
  };
  const saucer = params.base.saucer.enabled ? buildSaucer(params, outerRings[0], rowCtx[0]) : undefined;
  return { field, mesh, saucer };
}

/**
 * Saucer: a separate shell body whose inner wall follows the vase's base contour offset by `gap`.
 * Built at the origin; exporters place it next to the vase.
 */
export function buildSaucer(params: VaseParams, base: Ring, r0: Row): VaseMesh {
  const { gap, height: h, rim } = params.base.saucer;
  const w = Math.max(1.6, 2 * params.print.lineWidth);
  const floor = 1.6;
  const n = base.length / 3;
  const cx = r0.cx;
  const cy = r0.cy;
  const radial = new Float64Array(n);
  const ang = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = base[i * 3] - cx;
    const dy = base[i * 3 + 1] - cy;
    radial[i] = Math.hypot(dx, dy) + gap;
    ang[i] = Math.atan2(dy, dx);
  }
  const ROWS = 8;
  const ring = (extra: (u: number) => number, z: number, u: number) => {
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = radial[i] + extra(u);
      out[i * 3] = r * Math.cos(ang[i]);
      out[i * 3 + 1] = r * Math.sin(ang[i]);
      out[i * 3 + 2] = z;
    }
    return out;
  };
  const flare = (u: number) => rim * u * u;
  const outer: Ring[] = [];
  for (let k = 0; k <= ROWS; k++) {
    const u = k / ROWS;
    const chamfer = k === 0 ? -0.4 : 0;
    outer.push(ring((uu) => w + flare(uu) + chamfer, h * u, u));
  }
  const inner: Ring[] = [];
  for (let k = ROWS; k >= 0; k--) {
    const u = k / ROWS;
    const z = floor + (h - floor) * u;
    inner.push(ring((uu) => flare(uu), z, (z / h) * 1));
  }
  const B = new Builder();
  const outerFirst = B.grid(
    'outer',
    outer,
    outer.map(() => -1),
  );
  const rimFirst = B.v;
  const innerFirst = rimFirst + 2 * n;
  B.grid('rim', [outer[ROWS], inner[0]], [outerFirst + ROWS * n, innerFirst]);
  B.grid(
    'inner',
    inner,
    inner.map(() => -1),
  );
  B.fan('floor', inner[ROWS], innerFirst + ROWS * n, 0, 0, floor, true);
  B.fan('bottom', outer[0], outerFirst, 0, 0, 0, false);
  const raw = B.finish();
  return {
    mode: 'shell',
    ...raw,
    nTheta: n,
    nZ: ROWS + 1,
    surfaces: B.surfaces,
    rows: new Float64Array(outer.map((_, k) => (h * k) / ROWS)),
    height: h,
    clamped: 0,
    innerTooNarrow: 0,
    holeClamped: false,
    plan: { nTheta: n, nZ: ROWS + 1, shear: () => 0, k: 1 },
  };
}

/**
 * Fit Test Ring: the bottom FIT_RING_HEIGHT mm of the bore (from z = 0, with the bottom chamfer, the chosen bottom
 * type, ribs and any groove in range) inside a plain core-wall tube. Prints in minutes; measure it to calibrate
 * holeCompensation. Built about the bore axis at the origin.
 */
export function buildFitTestRing(params: VaseParams, quality: Quality = params.render.exportQuality): VaseMesh {
  const ins = params.insert;
  const H = params.dimensions.height;
  // same bore profile as the sleeve; the ring top is a cut, so the entry chamfer never reaches it
  const zTopSleeve = H - (params.rim.round ? params.print.wallThickness / 2 : 0);
  const prof = boreProfile(params, zTopSleeve, H);
  const R = prof.bore.radius;
  const top = FIT_RING_HEIGHT;
  const zb = Math.min(prof.zBottom, top / 2);

  const k = ins.ribs.count > 0 && ins.ribs.interference > 0 ? ins.ribs.count : 1;
  let nT = Math.max(QUALITY_GRID[quality].nTheta, boreMinColumns(ins, R));
  nT = Math.min(k * Math.floor(MAX_THETA / k), k * Math.ceil(nT / k));

  // bore rows: uniform ≤ 0.25 mm plus the profile kinks
  const n = Math.ceil((top - zb) / 0.25);
  const zs = [zb, top];
  for (let j = 1; j < n; j++) zs.push(zb + ((top - zb) * j) / n);
  for (const b of prof.breaks) if (b > zb && b < top) zs.push(b);
  zs.sort((a, b) => a - b);
  const zRows = zs.filter((z, j) => j === 0 || z - zs[j - 1] > 1e-6);

  const ring = (rad: (phi: number) => number, z: number): Ring => {
    const out = new Float64Array(nT * 3);
    for (let i = 0; i < nT; i++) {
      const phi = (TAU * i) / nT;
      const r = rad(phi);
      out[i * 3] = r * Math.cos(phi);
      out[i * 3 + 1] = r * Math.sin(phi);
      out[i * 3 + 2] = z;
    }
    return out;
  };
  const innerDown = zRows
    .slice()
    .reverse()
    .map((z) => ring((phi) => prof.radiusAt(phi, z, zTopSleeve), z));
  let widest = R;
  for (const rg of innerDown)
    for (let i = 0; i < nT; i++) widest = Math.max(widest, Math.hypot(rg[i * 3], rg[i * 3 + 1]));
  const Ro = widest + ins.coreWall;
  const outer = [ring(() => Ro, 0), ring(() => Ro, top)];

  const B = new Builder();
  const outerFirst = B.grid(
    'outer',
    outer,
    outer.map(() => -1),
  );
  const innerFirst = B.v + 2 * nT;
  B.grid('rim', [outer[1], innerDown[0]], [outerFirst + nT, innerFirst]);
  B.grid(
    'inner',
    innerDown,
    innerDown.map(() => -1),
  );
  const innerBottom = innerFirst + (innerDown.length - 1) * nT;
  const boreRing = innerDown[innerDown.length - 1];
  const hr = bottomHoleRadius(ins, R);
  if (zb <= 0) {
    B.grid('bottomRing', [boreRing, outer[0]], [innerBottom, outerFirst]);
  } else if (hr > 0) {
    const holeTop = ring(() => hr, zb);
    const holeBottom = ring(() => hr, 0);
    const floorHoleFirst = B.grid('floor', [boreRing, holeTop], [innerBottom, -1]) + nT;
    const bottomFirst = B.grid('bottom', [holeBottom, outer[0]], [-1, outerFirst]);
    B.grid('hole', [holeTop, holeBottom], [floorHoleFirst, bottomFirst]);
  } else {
    B.fan('floor', boreRing, innerBottom, 0, 0, zb, true);
    B.fan('bottom', outer[0], outerFirst, 0, 0, 0, false);
  }
  const raw = B.finish();
  return {
    mode: 'shell',
    ...raw,
    nTheta: nT,
    nZ: zRows.length,
    surfaces: B.surfaces,
    rows: new Float64Array(zRows),
    height: top,
    clamped: 0,
    innerTooNarrow: 0,
    holeClamped: false,
    plan: { nTheta: nT, nZ: zRows.length, shear: () => 0, k },
    bore: {
      radius: R,
      zBottom: zb,
      zTop: top,
      coreWall: ins.coreWall,
      minWall: ins.coreWall,
      thin: null,
      scaleNeeded: 1,
      offAxis: 0,
    },
  };
}
