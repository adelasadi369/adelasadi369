import type { BoreInfo, VaseMesh } from '../geometry/mesh';
import { COARSE, extract, type Lattice } from '../mc/extract';
import {
  adjacency,
  countComponents,
  keepLargest,
  meshValidity,
  orientOutward,
  taubin,
  vertexNormals,
} from '../mc/post';
import type { VaseParams } from '../params/schema';
import { createSleeveField, type SleeveField } from './field';
import type { HoleStats } from './holes';

/** Voxel while a slider is dragged (docs/sleeve-integration.md §4). */
export const DRAG_VOXEL = 2;
/** Voxel for a preview quality: the drag voxel while dragging ('low'), else sleeve.mesh.previewVoxel. */
export const sleeveVoxel = (p: VaseParams, quality: string) =>
  quality === 'low' ? DRAG_VOXEL : p.sleeve.mesh.previewVoxel;

/** Sub-voxel lattice offsets: the default, then the deterministic retry. Never 0 (no sample on the axis). */
const OFFSETS = [0.5, 0.3];

export interface SleeveValidity {
  manifold: boolean;
  badEdges: number;
  flippedEdges: number;
  degenerate: number;
  badVertices: number;
  /** Components after island removal (must be 1). */
  bodies: number;
  volume: number;
  ok: boolean;
}

export interface SleeveInfo {
  voxel: number;
  /** Vertices snapped onto the bore profile (z > z_b) and onto the bottom opening, and onto the bed (z = 0). */
  boreVertices: Uint32Array;
  holeVertices: Uint32Array;
  baseVertices: Uint32Array;
  islands: { components: number; removedVolume: number; removedFraction: number };
  validity: SleeveValidity;
  /** True when the first lattice failed validation and the shifted lattice was used. */
  retried: boolean;
  log: string[];
  exactSamples: number;
  totalSamples: number;
  /** Hole map statistics (coverage, bridges, bore contact); null without holes. */
  holes: HoleStats | null;
  timings: { skin: number; extract: number; post: number; total: number };
}

export interface SleeveBuild {
  mesh: VaseMesh & { sleeve: SleeveInfo };
  sdf: SleeveField;
}

export interface SleeveOptions {
  onProgress?: (fraction: number) => void;
  signal?: { aborted: boolean };
  /** Test hook: force the lattice offset index. */
  offsetIndex?: number;
  /** Test hook: treat the first lattice as invalid to exercise the retry. */
  failFirst?: boolean;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Coarse-aligned lattice over the sleeve's bounds with a sub-voxel offset on every axis. */
export function sleeveLattice(f: SleeveField, h: number, off: number): Lattice {
  const X = f.reach + 2 * h;
  const n = COARSE * Math.ceil((2 * X) / h / COARSE) + 1;
  const o = -((n - 1) / 2) * h + off * h;
  const nz = COARSE * Math.ceil((f.H + 4 * h) / h / COARSE) + 1;
  return { x0: o, y0: o, z0: -(2 + off) * h, h, nx: n, ny: n, nz };
}

/** Deterministic sleeve mesh: SDF → marching cubes → snapping → Taubin → islands → validity (one retry). */
export function buildSleeveMesh(params: VaseParams, voxel: number, opts: SleeveOptions = {}): SleeveBuild {
  const t0 = now();
  const sdf = createSleeveField(params, voxel);
  const tSkin = now() - t0;
  const log: string[] = [];
  const first = opts.offsetIndex ?? 0;
  let built = mesh(params, sdf, voxel, OFFSETS[first], opts);
  let retried = false;
  if ((!built.validity.ok || opts.failFirst) && opts.offsetIndex === undefined) {
    log.push(
      `mesh validity failed at lattice offset ${OFFSETS[0]} (bad edges ${built.validity.badEdges}, bad vertices ${built.validity.badVertices}, bodies ${built.validity.bodies}); retried at offset ${OFFSETS[1]}`,
    );
    built = mesh(params, sdf, voxel, OFFSETS[1], opts);
    retried = true;
  }
  const info: SleeveInfo = {
    ...built.info,
    retried,
    log,
    holes: sdf.holes?.stats ?? null,
    timings: { skin: tSkin, extract: built.tExtract, post: built.tPost, total: now() - t0 },
  };
  return { mesh: { ...built.mesh, sleeve: info }, sdf };
}

function mesh(params: VaseParams, sdf: SleeveField, h: number, off: number, opts: SleeveOptions) {
  const t1 = now();
  const lat = sleeveLattice(sdf, h, off);
  const raw = extract(sdf.sampled(lat), lat, { onProgress: opts.onProgress, signal: opts.signal });
  const tExtract = now() - t1;
  const t2 = now();

  // islands first: snapping and smoothing only touch the kept body
  const isl = keepLargest(raw);
  const m = isl.mesh;
  const V = m.vertexCount;
  const P = m.positions;
  const N = vertexNormals(m);

  // ---- snapping (sleeve-spec §3): bore and bottom opening exact, base exactly flat; snapped vertices are locked.
  // kind: 1 = bore (z > z_b), 2 = bottom opening (lip / drain), 3 = base (z = 0)
  const kind = new Uint8Array(V);
  const { prof, zb, hr, H } = sdf;
  for (let v = 0; v < V; v++) {
    const x = P[v * 3];
    const y = P[v * 3 + 1];
    const z = P[v * 3 + 2];
    const rho = Math.sqrt(x * x + y * y);
    if (rho > 1e-9 && (N[v * 3] * x + N[v * 3 + 1] * y) / rho < -0.7) {
      const target = z > zb ? prof.radiusAt(Math.atan2(y, x), z, H) : hr;
      if (target > 0 && Math.abs(rho - target) < 0.75 * h) {
        const s = target / rho;
        P[v * 3] = x * s;
        P[v * 3 + 1] = y * s;
        kind[v] = z > zb ? 1 : 2;
        continue;
      }
    }
    if (Math.abs(z) < 0.5 * h && N[v * 3 + 2] < -0.7) {
      P[v * 3 + 2] = 0;
      kind[v] = 3;
    }
  }
  taubin(m, adjacency(m), kind, params.sleeve.mesh.smoothing);
  const volume = orientOutward(m);

  // ---- triangles lying on the bed go last as the 'bottom' surface (overhang skips them)
  const I = m.indices;
  const T = m.triangleCount;
  const onBed = (t: number) =>
    P[I[t * 3] * 3 + 2] === 0 && P[I[t * 3 + 1] * 3 + 2] === 0 && P[I[t * 3 + 2] * 3 + 2] === 0;
  const indices = new Uint32Array(T * 3);
  let w = 0;
  for (const bed of [false, true])
    for (let t = 0; t < T; t++) {
      if (onBed(t) !== bed) continue;
      indices[w++] = I[t * 3];
      indices[w++] = I[t * 3 + 1];
      indices[w++] = I[t * 3 + 2];
    }
  let bedTris = 0;
  for (let t = 0; t < T; t++) if (onBed(t)) bedTris++;
  const sideTris = T - bedTris;
  const final = { positions: P, indices, vertexCount: V, triangleCount: T };
  const normals = vertexNormals(final);
  const pick = (k: number) => {
    let n = 0;
    for (let v = 0; v < V; v++) if (kind[v] === k) n++;
    const out = new Uint32Array(n);
    n = 0;
    for (let v = 0; v < V; v++) if (kind[v] === k) out[n++] = v;
    return out;
  };

  // ---- validity: edge manifold, vertex manifold, one outward body
  const canonical = new Uint32Array(V);
  for (let v = 0; v < V; v++) canonical[v] = v;
  const mv = meshValidity(final);
  const bodies = countComponents(final);
  const validity: SleeveValidity = {
    manifold: mv.manifold,
    badEdges: mv.badEdges,
    flippedEdges: mv.flippedEdges,
    degenerate: mv.degenerate,
    badVertices: mv.badVertices,
    bodies,
    volume,
    ok: mv.manifold && bodies === 1 && volume > 0,
  };

  let maxZ = 0;
  for (let v = 0; v < V; v++) if (P[v * 3 + 2] > maxZ) maxZ = P[v * 3 + 2];
  const boreInfo: BoreInfo = {
    radius: sdf.R,
    zBottom: zb,
    zTop: H,
    coreWall: params.insert.coreWall,
    // the smooth union with the core tube keeps coreWall around the bore by construction
    minWall: params.insert.coreWall,
    thin: null,
    scaleNeeded: 1,
    offAxis: 0,
  };
  const out: VaseMesh = {
    mode: 'sleeve',
    positions: P,
    normals,
    indices,
    canonical,
    vertexCount: V,
    triangleCount: final.triangleCount,
    nTheta: 0,
    nZ: 0,
    surfaces: [
      { kind: 'outer', firstVertex: 0, rows: 1, cols: V, fan: false, firstTri: 0, triCount: sideTris },
      { kind: 'bottom', firstVertex: 0, rows: 0, cols: 0, fan: false, firstTri: sideTris, triCount: bedTris },
    ],
    rows: new Float64Array(0),
    height: maxZ,
    clamped: 0,
    innerTooNarrow: 0,
    holeClamped: false,
    plan: { nTheta: 0, nZ: 0, shear: () => 0, k: 1 },
    bore: boreInfo,
  };
  return {
    mesh: out,
    validity,
    tExtract,
    tPost: now() - t2,
    info: {
      voxel: h,
      boreVertices: pick(1),
      holeVertices: pick(2),
      baseVertices: pick(3),
      islands: { components: isl.components, removedVolume: isl.removedVolume, removedFraction: isl.removedFraction },
      validity,
      exactSamples: raw.exactSamples,
      totalSamples: raw.totalSamples,
    },
  };
}
