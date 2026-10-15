import { TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { compileField, R_MIN, type Field, type Row } from './field';
import { buildRows, planGrid, rowBreakpoints, type GridPlan, type Quality } from './grid';

export type SurfaceKind = 'outer' | 'inner' | 'rim' | 'top' | 'bottom' | 'floor' | 'bottomRing';

export interface Surface {
  kind: SurfaceKind;
  firstVertex: number;
  /** Grid rows (fans: 1 ring + centre). */
  rows: number;
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
  /** Outer row heights. */
  rows: Float64Array;
  height: number;
  /** Vertices where r was clamped to R_MIN. */
  clamped: number;
  /** Inner vertices narrower than 2 mm (shell). */
  innerTooNarrow: number;
  plan: GridPlan;
}

export interface BuildResult {
  mesh: VaseMesh;
  field: Field;
}

const RIM_SEGMENTS = 6;

class Builder {
  pos: Float32Array;
  nrm: Float32Array;
  idx: Uint32Array;
  canon: Uint32Array;
  v = 0;
  t = 0;
  surfaces: Surface[] = [];
  constructor(vCount: number, tCount: number) {
    this.pos = new Float32Array(vCount * 3);
    this.nrm = new Float32Array(vCount * 3);
    this.idx = new Uint32Array(tCount * 3);
    this.canon = new Uint32Array(vCount);
  }
  tri(a: number, b: number, c: number) {
    const o = this.t * 3;
    this.idx[o] = a;
    this.idx[o + 1] = b;
    this.idx[o + 2] = c;
    this.t++;
  }

  /**
   * Grid surface from rows of rings (each ring nθ points, x,y,z interleaved). `canonRows[r]` is the first vertex
   * of an already-emitted ring this row duplicates (or -1). Winding gives normals = dθ × drow.
   */
  grid(kind: SurfaceKind, nT: number, rings: Float64Array[], canonRows: number[]) {
    const first = this.v;
    const firstTri = this.t;
    const nR = rings.length;
    for (let r = 0; r < nR; r++) {
      const ring = rings[r];
      const c0 = canonRows[r];
      for (let i = 0; i < nT; i++) {
        const vi = first + r * nT + i;
        this.pos[vi * 3] = ring[i * 3];
        this.pos[vi * 3 + 1] = ring[i * 3 + 1];
        this.pos[vi * 3 + 2] = ring[i * 3 + 2];
        this.canon[vi] = c0 >= 0 ? c0 + i : vi;
      }
    }
    // normals from central differences
    for (let r = 0; r < nR; r++) {
      const rp = rings[Math.min(nR - 1, r + 1)];
      const rm = rings[Math.max(0, r - 1)];
      const ring = rings[r];
      for (let i = 0; i < nT; i++) {
        const ip = ((i + 1) % nT) * 3;
        const im = ((i - 1 + nT) % nT) * 3;
        const ax = ring[ip] - ring[im], ay = ring[ip + 1] - ring[im + 1], az = ring[ip + 2] - ring[im + 2];
        const o = i * 3;
        const bx = rp[o] - rm[o], by = rp[o + 1] - rm[o + 1], bz = rp[o + 2] - rm[o + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const vi = (first + r * nT + i) * 3;
        this.nrm[vi] = nx;
        this.nrm[vi + 1] = ny;
        this.nrm[vi + 2] = nz;
      }
    }
    const P = this.pos;
    const d2 = (p: number, q: number) => {
      const dx = P[p * 3] - P[q * 3], dy = P[p * 3 + 1] - P[q * 3 + 1], dz = P[p * 3 + 2] - P[q * 3 + 2];
      return dx * dx + dy * dy + dz * dz;
    };
    for (let r = 0; r < nR - 1; r++) {
      for (let i = 0; i < nT; i++) {
        const i1 = (i + 1) % nT;
        const a = first + r * nT + i;
        const b = first + r * nT + i1;
        const c = first + (r + 1) * nT + i1;
        const d = first + (r + 1) * nT + i;
        if (d2(a, c) <= d2(b, d)) {
          this.tri(a, b, c);
          this.tri(a, c, d);
        } else {
          this.tri(a, b, d);
          this.tri(b, c, d);
        }
      }
    }
    this.v += nR * nT;
    this.surfaces.push({ kind, firstVertex: first, rows: nR, fan: false, firstTri, triCount: this.t - firstTri });
  }

  /** Flat cap fan around (cx, cy, z). up=true → normal +z. */
  fan(kind: SurfaceKind, nT: number, ring: Float64Array, canonFirst: number, cx: number, cy: number, z: number, up: boolean) {
    const first = this.v;
    const firstTri = this.t;
    const nz = up ? 1 : -1;
    for (let i = 0; i < nT; i++) {
      const vi = first + i;
      this.pos[vi * 3] = ring[i * 3];
      this.pos[vi * 3 + 1] = ring[i * 3 + 1];
      this.pos[vi * 3 + 2] = ring[i * 3 + 2];
      this.nrm[vi * 3 + 2] = nz;
      this.canon[vi] = canonFirst + i;
    }
    const c = first + nT;
    this.pos[c * 3] = cx;
    this.pos[c * 3 + 1] = cy;
    this.pos[c * 3 + 2] = z;
    this.nrm[c * 3 + 2] = nz;
    this.canon[c] = c;
    for (let i = 0; i < nT; i++) {
      const i1 = (i + 1) % nT;
      if (up) this.tri(c, first + i, first + i1);
      else this.tri(c, first + i1, first + i);
    }
    this.v += nT + 1;
    this.surfaces.push({ kind, firstVertex: first, rows: 1, fan: true, firstTri, triCount: nT });
  }
}

interface Angles {
  cos: Float64Array;
  sin: Float64Array;
}

function ringFrom(rad: Float64Array, off: number, nT: number, angles: Angles, row: Row, z: number) {
  const ring = new Float64Array(nT * 3);
  const ct = Math.cos(row.twist);
  const st = Math.sin(row.twist);
  for (let i = 0; i < nT; i++) {
    const r = rad[off + i];
    const ca = angles.cos[i];
    const sa = angles.sin[i];
    // angle = θw + twist
    const c = ca * ct - sa * st;
    const s = sa * ct + ca * st;
    ring[i * 3] = row.cx + r * c;
    ring[i * 3 + 1] = row.cy + r * s;
    ring[i * 3 + 2] = z;
  }
  return ring;
}

/** Build the printable mesh for the given params. Pure and deterministic. */
export function buildMesh(params: VaseParams, quality: Quality): BuildResult {
  const field = compileField(params);
  const plan = planGrid(field, quality);
  const { nTheta: nT, nZ } = plan;
  const mode = params.print.outputMode;
  const shell = mode !== 'solidVase';
  const H = field.H;
  const wall = params.print.wallThickness;
  const lip = shell ? params.rim.lipThickness : 0;
  const round = shell && params.rim.round;
  const rho = round ? (wall + lip) / 2 : 0;
  const Hw = H - rho;
  const zFloor = shell ? Math.min(params.base.bottomThickness, Hw * 0.5) : 0;

  const rows = buildRows(nZ, Hw, rowBreakpoints(params, H, zFloor, field));
  let jFloor = 0;
  if (zFloor > 0) {
    let best = 1;
    for (let j = 1; j < nZ - 1; j++) if (Math.abs(rows[j] - zFloor) < Math.abs(rows[best] - zFloor)) best = j;
    rows[best] = zFloor;
    jFloor = best;
  }

  const rowCtx: Row[] = new Array(nZ);
  for (let j = 0; j < nZ; j++) rowCtx[j] = field.row(rows[j]);

  // θw per (row, column) — columns are fixed in the sheared/twist-aligned frame.
  const thetaI = new Float64Array(nT);
  for (let i = 0; i < nT; i++) thetaI[i] = (TAU * i) / nT;
  const colAngles: Angles = { cos: new Float64Array(nT), sin: new Float64Array(nT) };
  for (let i = 0; i < nT; i++) {
    colAngles.cos[i] = Math.cos(thetaI[i]);
    colAngles.sin[i] = Math.sin(thetaI[i]);
  }
  const angleRows: Angles[] = new Array(nZ);
  const rOut = new Float64Array(nZ * nT);
  const rBase = shell ? new Float64Array(nZ * nT) : null;
  let clamped = 0;
  for (let j = 0; j < nZ; j++) {
    const row = rowCtx[j];
    const sh = plan.shear(row.t);
    let ang = colAngles;
    if (sh !== 0) {
      ang = { cos: new Float64Array(nT), sin: new Float64Array(nT) };
      for (let i = 0; i < nT; i++) {
        ang.cos[i] = Math.cos(thetaI[i] + sh);
        ang.sin[i] = Math.sin(thetaI[i] + sh);
      }
    }
    for (let i = 0; i < nT; i++) {
      const tw = thetaI[i] + sh;
      let r = field.outerRaw(tw, ang.cos[i], ang.sin[i], row);
      if (r < R_MIN) {
        r = R_MIN;
        clamped++;
      }
      rOut[j * nT + i] = r;
      if (rBase) rBase[j * nT + i] = Math.max(R_MIN, field.base(tw, row));
    }
    angleRows[j] = ang;
  }

  // 45° chamfer line from the row at z = c; never makes the wall lean more than max(profile, 45°).
  const chamfer = params.base.chamfer;
  if (chamfer > 0) {
    let jc = 0;
    for (let j = 0; j < nZ; j++) if (Math.abs(rows[j] - chamfer) < Math.abs(rows[jc] - chamfer)) jc = j;
    const zc = rows[jc];
    for (let j = 0; j < jc; j++) {
      const drop = zc - rows[j];
      for (let i = 0; i < nT; i++) {
        const line = rOut[jc * nT + i] - drop;
        if (line < rOut[j * nT + i]) rOut[j * nT + i] = Math.max(R_MIN, line);
      }
    }
  }

  const outerRings = rowCtx.map((row, j) => ringFrom(rOut, j * nT, nT, angleRows[j], row, rows[j]));

  // ---- counts
  const nIn = shell ? nZ - jFloor : 0;
  const rimRows = shell ? (round ? RIM_SEGMENTS + 1 : 2) : 0;
  let vCount = nT * nZ + 2 * (nT + 1);
  let tCount = 2 * nT * (nZ - 1) + 2 * nT;
  if (shell) {
    vCount += nT * rimRows + nT * nIn;
    tCount += 2 * nT * (rimRows - 1) + 2 * nT * (nIn - 1);
    if (zFloor <= 0) {
      // open bottom: annulus instead of two fans
      vCount += 2 * nT - 2 * (nT + 1);
      tCount += 2 * nT - 2 * nT;
    }
  }
  const B = new Builder(vCount, tCount);

  B.grid('outer', nT, outerRings, outerRings.map(() => -1));
  const outerFirst = 0;
  const outerTop = outerFirst + (nZ - 1) * nT;
  let innerTooNarrow = 0;

  if (!shell) {
    const r0 = rowCtx[0];
    const rt = rowCtx[nZ - 1];
    B.fan('bottom', nT, outerRings[0], outerFirst, r0.cx, r0.cy, 0, false);
    B.fan('top', nT, outerRings[nZ - 1], outerTop, rt.cx, rt.cy, rows[nZ - 1], true);
  } else {
    // ---- inner radii (smooth liner): normal thickness ≥ wall, see GEOMETRY.md §7
    const rIn = new Float64Array(nZ * nT);
    const dTheta = TAU / nT;
    const lipZone = Math.max(3 * lip, 4);
    const cosBeta = (rad: Float64Array, j: number, i: number) => {
      const o = j * nT;
      const r = rad[o + i];
      const fT = (rad[o + ((i + 1) % nT)] - rad[o + ((i - 1 + nT) % nT)]) / (2 * dTheta);
      const jp = Math.min(nZ - 1, j + 1);
      const jm = Math.max(0, j - 1);
      const dz = rows[jp] - rows[jm];
      const fZ = (rad[jp * nT + i] - rad[jm * nT + i]) / dz;
      const dTw = (rowCtx[jp].twist + plan.shear(rowCtx[jp].t) - rowCtx[jm].twist - plan.shear(rowCtx[jm].t)) / dz;
      const rz = fZ - fT * dTw;
      return 1 / Math.sqrt(1 + (fT / r) * (fT / r) + rz * rz);
    };
    for (let j = jFloor; j < nZ; j++) {
      let inward = 0;
      for (let i = 0; i < nT; i++) inward = Math.max(inward, rBase![j * nT + i] - rOut[j * nT + i]);
      const lipCut = lip > 0 ? lip * smooth01((rows[j] - (Hw - lipZone)) / lipZone) : 0;
      for (let i = 0; i < nT; i++) {
        const o = j * nT + i;
        const liner = rBase![o] - wall / Math.max(0.3, cosBeta(rBase!, j, i)) - inward;
        const follow = rOut[o] - wall / Math.max(0.3, cosBeta(rOut, j, i));
        let r = Math.min(liner, follow) - lipCut;
        if (r < 2) innerTooNarrow++;
        if (r < 0.5) r = 0.5;
        rIn[o] = r;
      }
    }
    const innerRingsUp: Float64Array[] = [];
    for (let j = jFloor; j < nZ; j++) innerRingsUp.push(ringFrom(rIn, j * nT, nT, angleRows[j], rowCtx[j], rows[j]));

    // rim
    const top = rowCtx[nZ - 1];
    const rimRings: Float64Array[] = [outerRings[nZ - 1]];
    if (round) {
      const tmp = new Float64Array(nT);
      for (let k = 1; k < RIM_SEGMENTS; k++) {
        const phi = (Math.PI * k) / RIM_SEGMENTS;
        for (let i = 0; i < nT; i++) {
          const ro = rOut[(nZ - 1) * nT + i];
          const ri = rIn[(nZ - 1) * nT + i];
          tmp[i] = (ro + ri) / 2 + ((ro - ri) / 2) * Math.cos(phi);
        }
        rimRings.push(ringFrom(tmp, 0, nT, angleRows[nZ - 1], top, Hw + rho * Math.sin(phi)));
      }
    }
    rimRings.push(innerRingsUp[innerRingsUp.length - 1]);
    const rimCanon = rimRings.map(() => -1);
    rimCanon[0] = outerTop;
    const rimFirst = B.v;
    const innerFirst = rimFirst + rimRings.length * nT;
    rimCanon[rimRings.length - 1] = innerFirst; // inner grid row 0 = top ring
    B.grid('rim', nT, rimRings, rimCanon);

    const innerDown = innerRingsUp.slice().reverse();
    B.grid('inner', nT, innerDown, innerDown.map(() => -1));
    const innerBottom = innerFirst + (nIn - 1) * nT;

    if (zFloor > 0) {
      const rf = rowCtx[jFloor];
      B.fan('floor', nT, innerDown[nIn - 1], innerBottom, rf.cx, rf.cy, zFloor, true);
      const r0 = rowCtx[0];
      B.fan('bottom', nT, outerRings[0], outerFirst, r0.cx, r0.cy, 0, false);
    } else {
      B.grid('bottomRing', nT, [innerDown[nIn - 1], outerRings[0]], [innerBottom, outerFirst]);
    }
  }

  if (B.v !== vCount || B.t !== tCount) throw new Error(`mesh count mismatch v ${B.v}/${vCount} t ${B.t}/${tCount}`);

  let maxZ = 0;
  for (let i = 2; i < B.pos.length; i += 3) if (B.pos[i] > maxZ) maxZ = B.pos[i];
  return {
    field,
    mesh: {
      mode,
      positions: B.pos,
      normals: B.nrm,
      indices: B.idx,
      canonical: B.canon,
      vertexCount: vCount,
      triangleCount: tCount,
      nTheta: nT,
      nZ,
      surfaces: B.surfaces,
      rows,
      height: maxZ,
      clamped,
      innerTooNarrow,
      plan,
    },
  };
}

function smooth01(x: number) {
  const u = x < 0 ? 0 : x > 1 ? 1 : x;
  return u * u * (3 - 2 * u);
}
