import { EDGES, TRI_COUNT, TRI_TABLE } from './tables';

/** Sample (i, j, k) sits at (x0 + i·h, y0 + j·h, z0 + k·h). (n − 1) must be a multiple of COARSE on every axis. */
export interface Lattice {
  x0: number;
  y0: number;
  z0: number;
  h: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface SampledField {
  /** Exact value at a point (used for the coarse narrow-band lattice). */
  at(x: number, y: number, z: number): number;
  /**
   * Fill one z-plane (out[j·nx + i]). Only samples with mask[j·nx + i] = 1 need exact values; the others already
   * hold a same-sign estimate from the coarse lattice and may be left alone.
   */
  plane(k: number, out: Float32Array, mask: Uint8Array): void;
}

export interface ExtractOptions {
  /** Narrow-band safety factor on the coarse cell diagonal (0 = evaluate every sample exactly). */
  band?: number;
  onProgress?: (fraction: number) => void;
  /** Checked once per plane; throws 'aborted' when set. */
  signal?: { aborted: boolean };
}

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  /** Samples evaluated exactly (narrow band) vs all lattice samples. */
  exactSamples: number;
  totalSamples: number;
}

/** Coarse narrow-band step in voxels. */
export const COARSE = 4;
/** Crossing positions stay off the corners so no two vertices can collapse in Float32. */
const T_MIN = 0.01;

class Grow {
  pos = new Float32Array(3 * 65536);
  idx = new Uint32Array(3 * 131072);
  v = 0;
  t = 0;
  vert(x: number, y: number, z: number): number {
    if ((this.v + 1) * 3 > this.pos.length) {
      const b = new Float32Array(this.pos.length * 2);
      b.set(this.pos);
      this.pos = b;
    }
    const o = this.v * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    return this.v++;
  }
  tri(a: number, b: number, c: number) {
    if ((this.t + 1) * 3 > this.idx.length) {
      const n = new Uint32Array(this.idx.length * 2);
      n.set(this.idx);
      this.idx = n;
    }
    const o = this.t * 3;
    this.idx[o] = a;
    this.idx[o + 1] = b;
    this.idx[o + 2] = c;
    this.t++;
  }
}

/**
 * Marching cubes over the lattice, one z-slab at a time. Vertices on shared edges are created once through
 * per-plane edge caches, so the output is already welded. Inside is field < 0; exact zeros count as outside (the
 * crossing clamp keeps their vertices off the corner).
 */
export function extract(f: SampledField, lat: Lattice, opts: ExtractOptions = {}): RawMesh {
  const { nx, ny, nz, h, x0, y0, z0 } = lat;
  const band = opts.band ?? 1.5;
  const P = nx * ny;
  const ncx = (nx - 1) / COARSE;
  const ncy = (ny - 1) / COARSE;
  const ncz = (nz - 1) / COARSE;
  if (![ncx, ncy, ncz].every((n) => Number.isInteger(n) && n > 0)) throw new Error('lattice not coarse-aligned');

  // ---- coarse lattice + cells the surface may cross. A crossing point lies within half a cell diagonal of the
  // nearest corner, so with a Lipschitz bound of `band` a cell is "near" when min |corner| < band · diagonal / 2.
  const cx = ncx + 1;
  const cy = ncy + 1;
  const coarse = new Float32Array(cx * cy * (ncz + 1));
  const near = new Uint8Array(ncx * ncy * ncz);
  if (band > 0) {
    for (let c = 0; c <= ncz; c++)
      for (let b = 0; b < cy; b++)
        for (let a = 0; a < cx; a++)
          coarse[(c * cy + b) * cx + a] = f.at(x0 + a * COARSE * h, y0 + b * COARSE * h, z0 + c * COARSE * h);
    const thr = (band * COARSE * h * Math.sqrt(3)) / 2;
    for (let c = 0; c < ncz; c++)
      for (let b = 0; b < ncy; b++)
        for (let a = 0; a < ncx; a++) {
          let m = Infinity;
          for (let q = 0; q < 8; q++) {
            const v = coarse[((c + (q >> 2)) * cy + b + ((q >> 1) & 1)) * cx + a + (q & 1)];
            m = Math.min(m, Math.abs(v));
          }
          if (m < thr) near[(c * ncy + b) * ncx + a] = 1;
        }
  } else near.fill(1);

  // ---- second level: half-size cells, evaluated only inside near coarse cells (coarse corners are reused)
  const C2 = COARSE / 2;
  const mcx = (nx - 1) / C2;
  const mcy = (ny - 1) / C2;
  const mcz = (nz - 1) / C2;
  const mx = mcx + 1;
  const my = mcy + 1;
  const mid = new Float32Array(mx * my * (mcz + 1)).fill(NaN);
  const near2 = new Uint8Array(mcx * mcy * mcz);
  if (band > 0) {
    const thr2 = (band * C2 * h * Math.sqrt(3)) / 2;
    const midAt = (A: number, B: number, C: number) => {
      const o = (C * my + B) * mx + A;
      let v = mid[o];
      if (v !== v) {
        v =
          A % 2 === 0 && B % 2 === 0 && C % 2 === 0
            ? coarse[((C >> 1) * cy + (B >> 1)) * cx + (A >> 1)]
            : f.at(x0 + A * C2 * h, y0 + B * C2 * h, z0 + C * C2 * h);
        mid[o] = v;
      }
      return v;
    };
    for (let c = 0; c < ncz; c++)
      for (let b = 0; b < ncy; b++)
        for (let a = 0; a < ncx; a++) {
          if (!near[(c * ncy + b) * ncx + a]) continue;
          for (let q = 0; q < 8; q++) {
            const A2 = 2 * a + (q & 1);
            const B2 = 2 * b + ((q >> 1) & 1);
            const Cz = 2 * c + (q >> 2);
            let m = Infinity;
            for (let r = 0; r < 8; r++)
              m = Math.min(m, Math.abs(midAt(A2 + (r & 1), B2 + ((r >> 1) & 1), Cz + (r >> 2))));
            if (m < thr2) near2[(Cz * mcy + B2) * mcx + A2] = 1;
          }
        }
  } else near2.fill(1);
  /** Same-sign estimate for a sample in a far half-size cell: its corner, else its coarse cell's corner. */
  const farValue = (a2: number, b2: number, c2: number) => {
    const v = mid[(c2 * my + b2) * mx + a2];
    return v === v ? v : coarse[((c2 >> 1) * cy + (b2 >> 1)) * cx + (a2 >> 1)];
  };

  const cellOf = (i: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(i / C2)));
  /** Coarse cells within one voxel of each fine index: [cell(i − 1), cell(i), cell(i + 1)]. */
  const around = (n: number, nc: number) => {
    const t = new Int32Array(n * 3);
    for (let i = 0; i < n; i++) {
      t[i * 3] = cellOf(i - 1, nc);
      t[i * 3 + 1] = cellOf(i, nc);
      t[i * 3 + 2] = cellOf(i + 1, nc);
    }
    return t;
  };
  const ax = around(nx, mcx);
  const ay = around(ny, mcy);
  const rowNear = new Uint8Array(mcx);
  // fine samples one voxel around a near cell are exact too, so every edge that crosses the surface interpolates
  // between exact values
  const nearXY = new Uint8Array(mcx * mcy);
  let mask = new Uint8Array(P);
  let maskA = new Uint8Array(P);
  let A = new Float32Array(P);
  let B = new Float32Array(P);
  let xe0 = new Int32Array(P);
  let ye0 = new Int32Array(P);
  let xe1 = new Int32Array(P);
  let ye1 = new Int32Array(P);
  const ze = new Int32Array(P);
  const out = new Grow();
  let exact = 0;

  const fillPlane = (k: number, vals: Float32Array) => {
    const c = cellOf(k, mcz);
    nearXY.fill(0);
    for (let kk = k - 1; kk <= k + 1; kk++) {
      if (kk < 0 || kk >= nz) continue;
      const base = cellOf(kk, mcz) * mcx * mcy;
      for (let q = 0; q < mcx * mcy; q++) nearXY[q] |= near2[base + q];
    }
    for (let j = 0; j < ny; j++) {
      const b = ay[j * 3 + 1];
      let any = 0;
      for (let a = 0; a < mcx; a++)
        any |= rowNear[a] = nearXY[ay[j * 3] * mcx + a] | nearXY[b * mcx + a] | nearXY[ay[j * 3 + 2] * mcx + a];
      if (!any) {
        // whole row far from the surface: one value per half-size cell
        mask.fill(0, j * nx, (j + 1) * nx);
        for (let i = 0; i < nx; i++) vals[j * nx + i] = farValue(ax[i * 3 + 1], b, c);
        continue;
      }
      for (let i = 0; i < nx; i++) {
        const s = j * nx + i;
        const on = rowNear[ax[i * 3]] | rowNear[ax[i * 3 + 1]] | rowNear[ax[i * 3 + 2]];
        mask[s] = on;
        if (on) exact++;
        // far from the surface: one sign throughout the cell, reuse a corner value
        else vals[s] = farValue(ax[i * 3 + 1], b, c);
      }
    }
    f.plane(k, vals, mask);
  };

  const vertOnEdge = (va: number, vb: number, xa: number, ya: number, za: number, axis: number) => {
    let t = va / (va - vb);
    if (t < T_MIN) t = T_MIN;
    else if (t > 1 - T_MIN) t = 1 - T_MIN;
    const d = t * h;
    return out.vert(axis === 0 ? xa + d : xa, axis === 1 ? ya + d : ya, axis === 2 ? za + d : za);
  };

  fillPlane(0, A);
  [mask, maskA] = [maskA, mask];
  const cornerV = new Float64Array(8);
  const edgeV = new Int32Array(12);
  for (let k = 1; k < nz; k++) {
    if (opts.signal?.aborted) throw new Error('aborted');
    fillPlane(k, B);
    xe1.fill(-1);
    ye1.fill(-1);
    ze.fill(-1);
    if (k === 1) {
      xe0.fill(-1);
      ye0.fill(-1);
    }
    const zA = z0 + (k - 1) * h;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const s = j * nx + i;
        // a far corner means the whole cell is at least a voxel away from the surface
        if (!maskA[s]) continue;
        const v0 = A[s],
          v1 = A[s + 1],
          v2 = A[s + nx],
          v3 = A[s + nx + 1],
          v4 = B[s],
          v5 = B[s + 1],
          v6 = B[s + nx],
          v7 = B[s + nx + 1];
        const cs =
          (v0 < 0 ? 1 : 0) |
          (v1 < 0 ? 2 : 0) |
          (v2 < 0 ? 4 : 0) |
          (v3 < 0 ? 8 : 0) |
          (v4 < 0 ? 16 : 0) |
          (v5 < 0 ? 32 : 0) |
          (v6 < 0 ? 64 : 0) |
          (v7 < 0 ? 128 : 0);
        if (cs === 0 || cs === 255) continue;
        cornerV[0] = v0;
        cornerV[1] = v1;
        cornerV[2] = v2;
        cornerV[3] = v3;
        cornerV[4] = v4;
        cornerV[5] = v5;
        cornerV[6] = v6;
        cornerV[7] = v7;
        const xA = x0 + i * h;
        const yA = y0 + j * h;
        const tbl = TRI_TABLE[cs];
        edgeV.fill(-1);
        for (let n = 0; n < tbl.length; n++) {
          const e = tbl[n];
          if (edgeV[e] >= 0) continue;
          // cached edge slot
          let cache: Int32Array;
          let slot: number;
          switch (e) {
            case 0: cache = xe0; slot = s; break; // prettier-ignore
            case 1: cache = xe0; slot = s + nx; break; // prettier-ignore
            case 2: cache = xe1; slot = s; break; // prettier-ignore
            case 3: cache = xe1; slot = s + nx; break; // prettier-ignore
            case 4: cache = ye0; slot = s; break; // prettier-ignore
            case 5: cache = ye0; slot = s + 1; break; // prettier-ignore
            case 6: cache = ye1; slot = s; break; // prettier-ignore
            case 7: cache = ye1; slot = s + 1; break; // prettier-ignore
            case 8: cache = ze; slot = s; break; // prettier-ignore
            case 9: cache = ze; slot = s + 1; break; // prettier-ignore
            case 10: cache = ze; slot = s + nx; break; // prettier-ignore
            default: cache = ze; slot = s + nx + 1; // prettier-ignore
          }
          let v = cache[slot];
          if (v < 0) {
            const [ca, cb] = EDGES[e];
            const axis = e < 4 ? 0 : e < 8 ? 1 : 2;
            v = vertOnEdge(
              cornerV[ca],
              cornerV[cb],
              xA + (ca & 1) * h,
              yA + ((ca >> 1) & 1) * h,
              zA + ((ca >> 2) & 1) * h,
              axis,
            );
            cache[slot] = v;
          }
          edgeV[e] = v;
        }
        for (let n = 0; n < TRI_COUNT[cs]; n++)
          out.tri(edgeV[tbl[n * 3]], edgeV[tbl[n * 3 + 1]], edgeV[tbl[n * 3 + 2]]);
      }
    }
    // slide the slab: plane k becomes the lower plane
    [A, B] = [B, A];
    [mask, maskA] = [maskA, mask];
    [xe0, xe1] = [xe1, xe0];
    [ye0, ye1] = [ye1, ye0];
    opts.onProgress?.(k / (nz - 1));
  }
  return {
    positions: out.pos.slice(0, out.v * 3),
    indices: out.idx.slice(0, out.t * 3),
    vertexCount: out.v,
    triangleCount: out.t,
    exactSamples: exact,
    totalSamples: P * nz,
  };
}
