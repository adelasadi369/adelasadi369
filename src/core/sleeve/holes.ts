import { DEG, TAU } from '../math';
import type { VaseParams } from '../params/schema';
import { blur, edt, label, signedDistance, type Grid2 } from './grid2d';
import { holeField } from './holeFields';
import { skinKey } from './skin';
import type { TopEdge } from './topEdge';

/**
 * Sleeve openings (sleeve-spec §4.7, integration doc §3, GEOMETRY.md §13b). The hole set is built once on a periodic
 * map over (φ about the bore axis, z) and turned into a signed distance g (mm, negative inside a hole) that the SDF
 * samples, so holes are radial through-holes and every voxel size sees the same holes. Each step works in the metric
 * where its constraint is tightest:
 *   size/noise at the mean skin radius r_ref, teardrop slope at the outermost radius r_out (roofs are steeper further
 *   in), bridges and the final g at the bore radius R (bridges between radial holes are thinnest there, and g is then
 *   1-Lipschitz in 3D for ρ ≥ R, which keeps the narrow band valid).
 */
export interface HoleStats {
  /** Open share of the side area (0 ≤ z < Htop), keep-out bands included; and the target. */
  coverage: number;
  target: number;
  threshold: number;
  /** Solid share of the bore surface between the bore bottom and the local rim. */
  boreContact: number;
  /** Thinnest bridge (mm, at the bore radius) between two holes or a hole and the rim; Infinity with < 2 parts. */
  minBridge: number;
  /** Height range (mm) of bridges thinner than minBridgeWidth (null if none). */
  thinBridges: [number, number] | null;
  holes: number;
  merged: number;
  removed: number;
  islands: number;
  iterations: number;
  ms: number;
}

export interface HoleMap extends Grid2 {
  dphi: number;
  dz: number;
  H: number;
  /** Metric radius of g (the bore radius) and the smooth-subtraction radius in that metric. */
  R: number;
  k: number;
  /** Hole cells (1 = open), and g (mm at radius R) per cell. */
  open: Uint8Array;
  g: Float32Array;
  stats: HoleStats;
  /** Signed distance to the holes at axis angle φ and height z (bilinear, periodic in φ). */
  at(phi: number, z: number): number;
  /**
   * Teardrop-tip zone: within 2 mm of a hole edge, where the hole (a roof apex) or the material between two merged
   * roofs (a ∨ tip) is narrower than 2·d at this height, measured at r_out. A rounded tip has a short flat patch there.
   */
  tip(phi: number, z: number, d: number): boolean;
}

export interface HoleInputs {
  H: number;
  /** Bore radius, bore wall start, mean skin radius, outermost material radius. */
  R: number;
  zb: number;
  rRef: number;
  rOut: number;
  top: TopEdge;
  /** Body cap (fingers stand free above it): no holes above min(Htop, cap). */
  cap?: number;
}

/** Map cell size at r_ref (mm); the map does not depend on the voxel. */
const PITCH = 0.5;
/** Merge rounds (teardrop → bridges → merge) per threshold, also the cap on finisher passes. */
const MAX_ROUNDS = 4;
/** Threshold runs of the coverage search. */
const MAX_ITER = 6;
const COVERAGE_TOL = 0.01;
const FINE_TOL = 0.002;
const FINE_STEPS = 8;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let cache: { key: string; map: HoleMap | null } | null = null;

/** Hole map for the params (null when there are no holes), cached while only non-hole params change. */
export function buildHoleMap(params: VaseParams, inp: HoleInputs): HoleMap | null {
  const h = params.sleeve.holes;
  if (h.mode === 'none' || h.coverage <= 0) return null;
  const key = JSON.stringify([
    h,
    params.sleeve.topEdge,
    params.random.seed,
    params.print.maxOverhang,
    inp.H,
    inp.R,
    inp.zb,
    inp.rRef,
    inp.rOut,
    inp.cap ?? inp.H,
    h.mode === 'foldGaps' ? skinKey(params, -1) : 0,
    h.mode === 'pattern' ? [params.motif, params.print.lineWidth] : 0,
  ]);
  if (cache?.key === key) return cache.map;
  const map = build(params, inp);
  cache = { key, map };
  return map;
}

function build(params: VaseParams, inp: HoleInputs): HoleMap {
  const t0 = now();
  const hp = params.sleeve.holes;
  const { H, R, zb, rRef, rOut, top } = inp;
  const nx = Math.min(2048, Math.max(64, Math.round((TAU * rRef) / PITCH)));
  const nz = Math.min(1200, Math.max(16, Math.ceil(H / PITCH) + 1));
  const g2: Grid2 = { nx, nz };
  const n = nx * nz;
  const dphi = TAU / nx;
  const dz = H / (nz - 1);
  const w = hp.minBridgeWidth;
  const tanA = Math.tan(params.print.maxOverhang * DEG);
  const zLo = Math.max(hp.keepOutBottom, zb + w);

  // ---- per-cell regions: rim (outside, above the local top; the top row always), side, allowed band, bore band
  const rim = new Uint8Array(n);
  const allowed = new Uint8Array(n);
  const boreBand = new Uint8Array(n);
  let side = 0;
  for (let i = 0; i < nx; i++) {
    const ht = Math.min(top.at(i * dphi), inp.cap ?? H);
    for (let j = 0; j < nz; j++) {
      const z = j * dz;
      const c = j * nx + i;
      if (j === nz - 1 || z >= ht) rim[c] = 1;
      else {
        side++;
        if (z >= zLo && z <= ht - hp.keepOutTop) allowed[c] = 1;
        if (z >= zb) boreBand[c] = 1;
      }
    }
  }

  // ---- hole field for the mode (holeFields.ts); lower = opens first
  const field = holeField(params, { nx, nz, dphi, dz, rRef, allowed });
  const sorted: number[] = [];
  for (let c = 0; c < n; c++) if (allowed[c]) sorted.push(field[c]);
  sorted.sort((a, b) => a - b);

  // ---- teardrop tops: g_td(p) = min_t ( g(p − t·ẑ) + t·tan α ) with g the horizontal (per-layer) distance in the
  // r_out metric, evaluated at every map row (12 sparse samples leave flat shelves over wide holes). As a sweep from
  // the bed up: D_j = max(d_j, D_{j−1} − dz·tan α), hole where D > 0, i.e. each layer's hole contains the layer
  // below eroded by dz·tan α, which is exactly the printable (overhang ≤ α) closure layer by layer.
  const teardrop = (S: Uint8Array): Uint8Array => {
    if (!hp.teardropTops) return S;
    const px = dphi * rOut;
    const e = dz * tanA;
    const out = new Uint8Array(n);
    const D = new Float64Array(nx);
    const left = new Float64Array(nx);
    for (let j = 0; j < nz; j++) {
      const r = j * nx;
      // run length to the left (periodic: two laps), then to the right, in cells
      let run = 0;
      for (let k = 0; k < 2 * nx; k++) {
        const i = k % nx;
        run = S[r + i] ? run + 1 : 0;
        if (k >= nx) left[i] = run;
      }
      run = 0;
      for (let k = 2 * nx - 1; k >= 0; k--) {
        const i = k % nx;
        run = S[r + i] ? run + 1 : 0;
        if (k < nx) {
          const d = S[r + i] ? (Math.min(left[i], run) - 0.5) * px : 0;
          const v = Math.max(d, D[i] - e);
          D[i] = v;
          if (v > 0 && !rim[r + i]) out[r + i] = 1;
        }
      }
    }
    return out;
  };

  // ---- islands: material cut off from the base by holes becomes hole (it would fall off)
  const fillIslands = (S: Uint8Array): { S: Uint8Array; filled: number } => {
    const mat = new Uint8Array(n);
    for (let c = 0; c < n; c++) mat[c] = S[c] || rim[c] ? 0 : 1;
    const { labels, count } = label(g2, mat, false);
    if (count <= 1) return { S, filled: 0 };
    const base = labels[0];
    let filled = 0;
    const out = S.slice();
    for (let c = 0; c < n; c++)
      if (mat[c] && labels[c] !== base) {
        out[c] = 1;
        filled++;
      }
    return { S: out, filled };
  };

  // ---- bridges: gaps between distinct hole components (the rim counts as one), measured at the bore radius
  interface Conflict {
    a: number;
    b: number;
    gap: number;
    /** Nearest hole cells of a and b across the thinnest point. */
    pa: number;
    pb: number;
  }
  const bridges = (S: Uint8Array) => {
    const hole = new Uint8Array(n);
    for (let c = 0; c < n; c++) hole[c] = S[c] || rim[c] ? 1 : 0;
    const L = label(g2, hole, true);
    const { d2, near } = edt(g2, hole, dphi * R, dz);
    const pairs = new Map<number, Conflict>();
    let minGap = Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    const lab = (c: number) => L.labels[near[c]];
    const visit = (c: number, d: number) => {
      if (hole[c] && hole[d]) return;
      const la = lab(c);
      const lb = lab(d);
      if (la === lb) return;
      const gap = Math.sqrt(d2[c]) + Math.sqrt(d2[d]);
      if (gap < minGap) minGap = gap;
      if (gap >= w) return;
      const z = Math.floor(c / nx) * dz;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      const a = Math.min(la, lb);
      const b = Math.max(la, lb);
      const key = a * 65536 + b;
      const p = pairs.get(key);
      const [pa, pb] = la < lb ? [near[c], near[d]] : [near[d], near[c]];
      if (!p || gap < p.gap) pairs.set(key, { a, b, gap, pa, pb });
    };
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        visit(c, j * nx + ((i + 1) % nx));
        if (j + 1 < nz) visit(c, c + nx);
      }
    const conflicts = [...pairs.values()].sort((p, q) => p.gap - q.gap || p.a - q.a || p.b - q.b);
    return { L, conflicts, minGap, range: conflicts.length ? ([zMin, zMax] as [number, number]) : null };
  };

  // ---- merge thin bridges (closing at w/2), unless the merged hole would span > 1/3 of the circumference at the bore
  // radius or > 2.5 × size in height: then the smaller hole goes instead
  const resolve = (S: Uint8Array, br: ReturnType<typeof bridges>) => {
    const { labels, count, area } = br.L;
    const isRim = new Uint8Array(count + 1);
    const cols: Uint8Array[] = [];
    const zr: [number, number][] = [];
    for (let l = 0; l <= count; l++) {
      cols.push(new Uint8Array(nx));
      zr.push([Infinity, -Infinity]);
    }
    for (let c = 0; c < n; c++) {
      const l = labels[c];
      if (!l) continue;
      if (rim[c]) isRim[l] = 1;
      const i = c % nx;
      const j = (c - i) / nx;
      cols[l][i] = 1;
      if (j < zr[l][0]) zr[l][0] = j;
      if (j > zr[l][1]) zr[l][1] = j;
    }
    const parent = Array.from({ length: count + 1 }, (_, l) => l);
    const find = (l: number): number => (parent[l] === l ? l : (parent[l] = find(parent[l])));
    const removed = new Uint8Array(count + 1);
    const span = (c: Uint8Array) => {
      // occupied angular span = circumference minus the largest run of empty columns (periodic)
      let gap = 0;
      let run = 0;
      for (let k = 0; k < 2 * nx; k++) {
        if (c[k % nx]) run = 0;
        else if (++run > gap) gap = run;
      }
      return nx - Math.min(nx, gap);
    };
    let merged = 0;
    let dropped = 0;
    const joins: Conflict[] = [];
    for (const cf of br.conflicts) {
      const { a, b } = cf;
      const ra = find(a);
      const rb = find(b);
      if (ra === rb || removed[ra] || removed[rb]) continue;
      if (!isRim[ra] && !isRim[rb]) {
        const u = new Uint8Array(nx);
        for (let i = 0; i < nx; i++) u[i] = cols[ra][i] | cols[rb][i];
        const z0 = Math.min(zr[ra][0], zr[rb][0]);
        const z1 = Math.max(zr[ra][1], zr[rb][1]);
        if (span(u) > nx / 3 || (z1 - z0) * dz > 2.5 * hp.size) {
          removed[area[ra] < area[rb] || (area[ra] === area[rb] && ra > rb) ? ra : rb] = 1;
          dropped++;
          continue;
        }
        cols[ra] = u;
        zr[ra] = [z0, z1];
      }
      parent[rb] = ra;
      area[ra] += area[rb];
      isRim[ra] |= isRim[rb];
      joins.push(cf);
      merged++;
    }
    const keep = new Uint8Array(n);
    for (let c = 0; c < n; c++) keep[c] = rim[c] || (S[c] && !removed[find(labels[c])]) ? 1 : 0;
    // each merge opens a capsule of radius w/2 between the two nearest cells: a closing alone does not join a
    // pointed teardrop tip to the hole (or rim) above it
    const sx = dphi * R;
    const rad = w / 2;
    const wi = Math.ceil(rad / sx) + 1;
    const wj = Math.ceil(rad / dz) + 1;
    for (const { pa, pb } of joins) {
      if (removed[find(labels[pa])] || removed[find(labels[pb])]) continue;
      const ia = pa % nx;
      const ja = (pa - ia) / nx;
      let di = (pb % nx) - ia;
      if (di > nx / 2) di -= nx;
      else if (di < -nx / 2) di += nx;
      const dj = (pb - (pb % nx)) / nx - ja;
      const ex = di * sx;
      const ez = dj * dz;
      const len2 = ex * ex + ez * ez;
      for (let j = Math.min(0, dj) - wj; j <= Math.max(0, dj) + wj; j++) {
        const jj = ja + j;
        if (jj < 0 || jj >= nz) continue;
        for (let i = Math.min(0, di) - wi; i <= Math.max(0, di) + wi; i++) {
          const px = i * sx;
          const pz = j * dz;
          const u = len2 > 0 ? Math.min(1, Math.max(0, (px * ex + pz * ez) / len2)) : 0;
          if ((px - u * ex) ** 2 + (pz - u * ez) ** 2 <= rad * rad) keep[jj * nx + ((((ia + i) % nx) + nx) % nx)] = 1;
        }
      }
    }
    // closing with radius w/2 also fills thin material strips left between the merged parts
    const dil = edt(g2, keep, dphi * R, dz).d2;
    const outside = new Uint8Array(n);
    const r2 = (w / 2) ** 2;
    for (let c = 0; c < n; c++) outside[c] = dil[c] > r2 ? 1 : 0;
    const ero = edt(g2, outside, dphi * R, dz).d2;
    const out = new Uint8Array(n);
    for (let c = 0; c < n; c++) out[c] = !rim[c] && ero[c] > r2 ? 1 : 0;
    return { S: out, merged, dropped };
  };

  // ---- finisher: conflicts the merge rounds left drop their smaller hole (the hole, against the rim). Removing a
  // hole never thins another bridge or changes a roof, so this ends with every bridge ≥ w.
  const finish = (S0: Uint8Array, br0: ReturnType<typeof bridges>) => {
    let S = S0;
    let br = br0;
    let dropped = 0;
    for (let k = 0; k < MAX_ROUNDS && br.conflicts.length; k++) {
      const { labels, area } = br.L;
      const rimLabel = labels[n - 1];
      const drop = new Set<number>();
      for (const { a, b } of br.conflicts) {
        if (drop.has(a) || drop.has(b)) continue;
        drop.add(a === rimLabel ? b : b === rimLabel ? a : area[a] < area[b] || (area[a] === area[b] && a > b) ? a : b);
      }
      const out = S.slice();
      for (let c = 0; c < n; c++) if (out[c] && drop.has(labels[c])) out[c] = 0;
      S = out;
      dropped += drop.size;
      br = bridges(S);
    }
    return { S, br, dropped };
  };

  // ---- specks: threshold components narrower than 0.4 × size (a disc of that diameter, at r_ref) read as noise
  // motif patterns: the cells are drawn, so only crumbs below one line width (radius) count as specks
  const pattern = hp.mode === 'pattern';
  const speck = pattern ? 5 * params.print.lineWidth : hp.size;
  const minCells = (Math.PI * (0.2 * speck) ** 2) / (dphi * rRef * dz);
  const dropSpecks = (S: Uint8Array): Uint8Array => {
    const { labels, area } = label(g2, S, true);
    const out = S.slice();
    for (let c = 0; c < n; c++) if (out[c] && area[labels[c]] < minCells) out[c] = 0;
    return out;
  };

  const run = (frac: number, fixed?: number) => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(frac * sorted.length)));
    const tau = fixed ?? (frac <= 0 ? -Infinity : frac >= 1 ? Infinity : sorted[idx]);
    let S: Uint8Array = new Uint8Array(n);
    for (let c = 0; c < n; c++) if (allowed[c] && field[c] < tau) S[c] = 1;
    S = dropSpecks(S);
    let merged = 0;
    let dropped = 0;
    let islands = 0;
    let br: ReturnType<typeof bridges> | null = null;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const fi = fillIslands(teardrop(S));
      S = fi.S;
      islands += fi.filled;
      br = bridges(S);
      if (!br.conflicts.length) break;
      const rs = resolve(S, br);
      S = rs.S;
      merged += rs.merged;
      dropped += rs.dropped;
      br = null;
    }
    if (!br) {
      const fi = fillIslands(teardrop(S));
      S = fi.S;
      islands += fi.filled;
      br = bridges(S);
    }
    const fin = finish(S, br);
    S = fin.S;
    br = fin.br;
    dropped += fin.dropped;
    let open = 0;
    for (let c = 0; c < n; c++) open += S[c];
    return { S, tau, coverage: side ? open / side : 0, merged, dropped, islands, br };
  };

  let target = hp.coverage / 100;
  // threshold search: multiplicative until bracketed, then bisection; keep the closest run on each side
  let frac = Math.min(1, (target * side) / Math.max(1, sorted.length));
  let lo = 0;
  let hi = 1;
  let below: ReturnType<typeof run> | null = null;
  let above: ReturnType<typeof run> | null = null;
  let iterations = 0;
  // motif patterns open exactly their cells (field < 0): no coverage search; the result's coverage is reported
  if (pattern) {
    above = run(0, 0);
    target = above.coverage;
    iterations = 1;
  }
  while (!pattern && iterations < MAX_ITER) {
    const cur = run(frac);
    iterations++;
    if (cur.coverage < target) {
      lo = frac;
      if (!below || cur.coverage > below.coverage) below = cur;
    } else {
      hi = frac;
      if (!above || cur.coverage < above.coverage) above = cur;
    }
    if (Math.abs(cur.coverage - target) <= COVERAGE_TOL) break;
    frac =
      hi < 1 && lo > 0
        ? (lo + hi) / 2
        : Math.min(1, Math.max(0, cur.coverage > 0 ? (frac * target) / cur.coverage : frac * 2 + 0.01));
    if (frac >= hi || frac <= lo) frac = (lo + hi) / 2;
  }
  // shrinking reaches any lower coverage smoothly; growing is capped by the bridge slack, so prefer the run above
  const best =
    below && (!above || target - below.coverage <= COVERAGE_TOL || above.coverage - target > 0.15) ? below : above!;

  // ---- fine coverage: merges and dropped holes make the threshold response jumpy, so finish by offsetting the
  // hole set by δ along its distance (at R). Growing is capped by the bridge slack (each side gives δ).
  let open = best.S;
  let coverage = best.coverage;
  let br = best.br;
  if (Math.abs(coverage - target) > FINE_TOL) {
    // shrinking measures from holes ∪ rim, so notches stay open to the rim instead of growing a thin lid
    const withRim = new Uint8Array(n);
    for (let c = 0; c < n; c++) withRim[c] = open[c] | rim[c];
    const gR = signedDistance(g2, coverage > target ? withRim : open, dphi * R, dz);
    // every candidate ends like a run: shrinking can pinch a merged hole in two (domed ends, a thin gap), growing
    // re-points roofs that may reach the hole above
    const at = (d: number) => {
      const S0 = new Uint8Array(n);
      for (let c = 0; c < n; c++) S0[c] = gR[c] < d && !rim[c] ? 1 : 0;
      const S1 = fillIslands(teardrop(S0)).S;
      const f = finish(S1, bridges(S1));
      let o = 0;
      for (let c = 0; c < n; c++) o += f.S[c];
      return { S: f.S, coverage: o / side, br: f.br };
    };
    const cell = Math.max(dphi * R, dz);
    const slack = Number.isFinite(br.minGap) ? Math.max(0, (br.minGap - w) / 2 - cell) : hp.size / 2;
    let lo = coverage > target ? -hp.size / 2 : 0;
    let hi = coverage > target ? 0 : Math.min(slack, hp.size / 2);
    let pick = { S: open, coverage, br };
    for (let k = 0; k < FINE_STEPS && hi - lo > 0.01; k++) {
      const mid = (lo + hi) / 2;
      const r = at(mid);
      if (Math.abs(r.coverage - target) < Math.abs(pick.coverage - target)) pick = r;
      if (r.coverage < target) lo = mid;
      else hi = mid;
    }
    open = pick.S;
    coverage = pick.coverage;
    br = pick.br;
  }

  const S = open;
  let contact = 0;
  let band = 0;
  for (let c = 0; c < n; c++)
    if (boreBand[c]) {
      band++;
      if (!S[c]) contact++;
    }
  // rim cells next to a notch count as open too, else the distance field leaves a thin lid over the notch
  const F = S.slice();
  for (let c = 0; c < n; c++) {
    if (!rim[c]) continue;
    const i = c % nx;
    const j = (c - i) / nx;
    for (let dj = -2; dj <= 0 && !F[c]; dj++)
      for (let di = -2; di <= 2; di++) {
        const jj = j + dj;
        if (jj >= 0 && S[jj * nx + ((i + di + nx) % nx)]) {
          F[c] = 1;
          break;
        }
      }
  }
  const g = blur(g2, signedDistance(g2, F, dphi * R, dz));
  const at = (phi: number, z: number) => {
    let u = phi / dphi;
    u -= nx * Math.floor(u / nx);
    let i0 = Math.floor(u);
    const fu = u - i0;
    if (i0 >= nx) i0 -= nx;
    const i1 = i0 + 1 === nx ? 0 : i0 + 1;
    const v = Math.min(nz - 1, Math.max(0, z / dz));
    const j0 = Math.min(nz - 2, Math.floor(v));
    const fv = v - j0;
    const a = j0 * nx;
    const b = a + nx;
    const g0 = g[a + i0] + (g[a + i1] - g[a + i0]) * fu;
    const g1 = g[b + i0] + (g[b + i1] - g[b + i0]) * fu;
    return g0 + (g1 - g0) * fv;
  };
  const holes = label(g2, S, true).count;
  const tip = (phi: number, z: number, d: number) => {
    if (Math.abs(at(phi, z)) > 2) return false;
    let u = Math.round(phi / dphi) % nx;
    if (u < 0) u += nx;
    const row = Math.min(nz - 1, Math.max(0, Math.round(z / dz))) * nx;
    const o = S[row + u];
    let a = 0;
    let c = 0;
    while (a < nx && S[row + ((u - a - 1 + nx) % nx)] === o) a++;
    while (c < nx && S[row + ((u + c + 1) % nx)] === o) c++;
    return (a + c + 1) * dphi * rOut < 2 * d;
  };
  return {
    nx,
    nz,
    dphi,
    dz,
    H,
    R,
    k: (hp.edgeRoundness * R) / rRef,
    open: S,
    g,
    at,
    tip,
    stats: {
      coverage,
      target,
      threshold: best.tau,
      boreContact: band ? contact / band : 1,
      minBridge: br.minGap,
      thinBridges: br.range,
      holes,
      merged: best.merged,
      removed: best.dropped,
      islands: best.islands,
      iterations,
      ms: now() - t0,
    },
  };
}
