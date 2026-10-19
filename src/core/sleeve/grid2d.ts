/**
 * Small toolkit for periodic 2D maps over (φ, z) (docs/GEOMETRY.md §13b). Cell (i, j) is index j · nx + i; x (φ) wraps
 * around, z does not. Spacings are anisotropic (mm per cell along x and z), so one map serves several metrics.
 */
export interface Grid2 {
  nx: number;
  nz: number;
}

const INF = 1e30;

/**
 * Exact squared Euclidean distance transform to the cells where `site[c]` is set (Felzenszwalb–Huttenlocher, two
 * separable passes), periodic in x. Returns squared distances (mm²) and, per cell, the index of its nearest site.
 */
export function edt(g: Grid2, site: Uint8Array, dx: number, dz: number): { d2: Float64Array; near: Int32Array } {
  const { nx, nz } = g;
  const n = nx * nz;
  // pass 1, along z: distance (in rows) to the nearest site in the same column, by two scans
  const colRow = new Int32Array(n).fill(-1);
  for (let i = 0; i < nx; i++) {
    let last = -1;
    for (let j = 0; j < nz; j++) {
      if (site[j * nx + i]) last = j;
      colRow[j * nx + i] = last;
    }
    last = -1;
    for (let j = nz - 1; j >= 0; j--) {
      const c = j * nx + i;
      if (site[c]) last = j;
      if (last >= 0 && (colRow[c] < 0 || last - j < j - colRow[c])) colRow[c] = last;
    }
  }
  // pass 2, along x (periodic): the nearest site is within half a turn, so the lower envelope of parabolas only
  // needs columns −nx/2 … 1.5·nx (index q ↔ column q − off)
  const d2 = new Float64Array(n);
  const near = new Int32Array(n);
  const off = nx >> 1;
  const m = nx + 2 * off;
  const v = new Int32Array(m);
  const zb = new Float64Array(m + 1);
  const f = new Float64Array(nx);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const r = colRow[j * nx + i];
      f[i] = r < 0 ? INF : ((r - j) * dz) ** 2;
    }
    let k = -1;
    for (let q = 0; q < m; q++) {
      const fq = f[(q - off + nx) % nx];
      if (fq >= INF) continue;
      const xq = (q - off) * dx;
      while (k >= 0) {
        const p = v[k];
        const xp = (p - off) * dx;
        const s = (fq + xq * xq - (f[(p - off + nx) % nx] + xp * xp)) / (2 * (xq - xp));
        if (s <= zb[k]) k--;
        else {
          k++;
          v[k] = q;
          zb[k] = s;
          zb[k + 1] = INF;
          break;
        }
      }
      if (k < 0) {
        k = 0;
        v[0] = q;
        zb[0] = -INF;
        zb[1] = INF;
      }
    }
    const row = j * nx;
    if (k < 0) {
      for (let i = 0; i < nx; i++) {
        d2[row + i] = INF;
        near[row + i] = -1;
      }
      continue;
    }
    let s = 0;
    for (let i = 0; i < nx; i++) {
      const x = i * dx;
      while (zb[s + 1] < x) s++;
      const p = v[s];
      const xp = (p - off) * dx;
      const pi = (p - off + nx) % nx;
      d2[row + i] = (x - xp) ** 2 + f[pi];
      near[row + i] = colRow[row + pi] * nx + pi;
    }
  }
  return { d2, near };
}

/**
 * Signed distance (mm) to the set `inside` (negative inside), with the boundary half a cell from the cell centres.
 * Lipschitz ≤ 1 in the (dx, dz) metric up to the half-cell offset.
 */
export function signedDistance(g: Grid2, inside: Uint8Array, dx: number, dz: number): Float32Array {
  const n = g.nx * g.nz;
  const out = new Uint8Array(n);
  let any = false;
  let all = true;
  for (let c = 0; c < n; c++) {
    out[c] = inside[c] ? 0 : 1;
    if (inside[c]) any = true;
    else all = false;
  }
  const half = 0.5 * Math.min(dx, dz);
  const res = new Float32Array(n);
  if (!any || all) return res.fill(any ? -INF : INF);
  const a = edt(g, inside, dx, dz).d2;
  const b = edt(g, out, dx, dz).d2;
  for (let c = 0; c < n; c++) res[c] = inside[c] ? half - Math.sqrt(b[c]) : Math.sqrt(a[c]) - half;
  return res;
}

/** Connected components of `on` cells (8-connected if `diag`, else 4-connected), periodic in x. Labels start at 1. */
export function label(g: Grid2, on: Uint8Array, diag: boolean): { labels: Int32Array; count: number; area: number[] } {
  const { nx, nz } = g;
  const labels = new Int32Array(nx * nz);
  const area = [0];
  const stack: number[] = [];
  let count = 0;
  for (let c0 = 0; c0 < nx * nz; c0++) {
    if (!on[c0] || labels[c0]) continue;
    count++;
    let a = 0;
    labels[c0] = count;
    stack.push(c0);
    while (stack.length) {
      const c = stack.pop()!;
      a++;
      const i = c % nx;
      const j = (c - i) / nx;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= nz) continue;
        for (let di = -1; di <= 1; di++) {
          if ((di === 0 && dj === 0) || (!diag && di !== 0 && dj !== 0)) continue;
          let ii = i + di;
          if (ii < 0) ii += nx;
          else if (ii >= nx) ii -= nx;
          const cc = jj * nx + ii;
          if (on[cc] && !labels[cc]) {
            labels[cc] = count;
            stack.push(cc);
          }
        }
      }
    }
    area.push(a);
  }
  return { labels, count, area };
}

/** One [1 2 1]/4 binomial blur pass in each direction (periodic x, clamped z); keeps a Lipschitz bound. */
export function blur(g: Grid2, src: Float32Array): Float32Array {
  const { nx, nz } = g;
  const tmp = new Float32Array(nx * nz);
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const r = j * nx;
    for (let i = 0; i < nx; i++)
      tmp[r + i] = (src[r + ((i + nx - 1) % nx)] + 2 * src[r + i] + src[r + ((i + 1) % nx)]) / 4;
  }
  for (let j = 0; j < nz; j++) {
    const a = Math.max(0, j - 1) * nx;
    const b = Math.min(nz - 1, j + 1) * nx;
    const r = j * nx;
    for (let i = 0; i < nx; i++) out[r + i] = (tmp[a + i] + 2 * tmp[r + i] + tmp[b + i]) / 4;
  }
  return out;
}
