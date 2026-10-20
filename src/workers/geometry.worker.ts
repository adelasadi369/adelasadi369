import * as Comlink from 'comlink';
import { buildMesh, type VaseMesh } from '../core/geometry/mesh';
import type { Quality } from '../core/geometry/grid';
import { exportDesign } from '../core/export';
import { exportBatch } from '../core/export/batch';
import { mutate, randomize, variationCount } from '../core/params/random';
import { normalizeParams } from '../core/params/normalize';
import { analyze, buildDesign } from '../core/printability';
import { autoFix } from '../core/printability/autofix';
import { analyzeOverhang } from '../core/printability/overhang';
import type { VaseParams } from '../core/params/schema';
import { SLEEVE_PRESETS, VASE_PRESETS } from '../presets';
import type { GeometryApi, MeshPayload } from './protocol';

/** Manifold-ness only depends on the grid topology, so it is checked once per topology. */
const manifoldCache = new Map<string, boolean>();
const topoKey = (m: VaseMesh) =>
  `${m.mode}|${m.nTheta}|${m.nZ}|${m.surfaces.map((s) => `${s.kind}:${s.rows}x${s.cols}:${s.triCount}`).join(',')}`;

function payload(m: VaseMesh, overhang: Float32Array, quality: Quality, ms: number): MeshPayload {
  return {
    positions: m.positions,
    normals: m.normals,
    indices: m.indices,
    overhang,
    vertexCount: m.vertexCount,
    triangleCount: m.triangleCount,
    height: m.height,
    nTheta: m.nTheta,
    nZ: m.nZ,
    quality,
    ms,
  };
}

const transferables = (p: MeshPayload) => [p.positions.buffer, p.normals.buffer, p.indices.buffer, p.overhang.buffer];

const api: GeometryApi = {
  regen(params, quality) {
    const t0 = performance.now();
    if (params.print.outputMode === 'sleeve') {
      // sleeve topology is not fixed: the full validity check runs on every regen (no topology cache)
      const build = buildDesign(params, quality);
      const { vertexOverhang, ...report } = analyze(build, params);
      const s = (build.mesh as { sleeve?: { log: string[]; voxel: number } }).sleeve;
      if (s?.log.length) console.info('[sleeve]', ...s.log);
      const mesh = { ...payload(build.mesh, vertexOverhang, quality, performance.now() - t0), voxel: s?.voxel };
      return Promise.resolve(Comlink.transfer({ mesh, report }, transferables(mesh)));
    }
    const build = buildMesh(params, quality);
    const key = topoKey(build.mesh);
    let manifold = manifoldCache.get(key);
    const report = analyze(build, params, { manifold: manifold === undefined });
    if (manifold === undefined) {
      manifold = report.manifold;
      manifoldCache.set(key, manifold);
    } else if (!manifold) {
      // re-run the full check so the issue is reported
      Object.assign(report, analyze(build, params));
    }
    const { vertexOverhang, ...rest } = report;
    const mesh = payload(build.mesh, vertexOverhang, quality, performance.now() - t0);
    let saucer: MeshPayload | undefined;
    if (build.saucer) {
      const s = build.saucer;
      let vx = -Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) vx = Math.max(vx, mesh.positions[i]);
      let sx = Infinity;
      for (let i = 0; i < s.positions.length; i += 3) sx = Math.min(sx, s.positions[i]);
      for (let i = 0; i < s.positions.length; i += 3) s.positions[i] += vx - sx + 10;
      saucer = payload(s, new Float32Array(s.vertexCount).fill(-1), quality, 0);
    }
    const transfer = [...transferables(mesh), ...(saucer ? transferables(saucer) : [])];
    return Promise.resolve(Comlink.transfer({ mesh, report: rest, saucer }, transfer));
  },

  autoFix(params) {
    const r = autoFix(params);
    const { vertexOverhang: _v, ...report } = r.report;
    return Promise.resolve({ ...r, report });
  },

  surprise(seed, base) {
    const rnd = (seed * 2654435761) >>> 0;
    const pool = base.print.outputMode === 'sleeve' ? SLEEVE_PRESETS : VASE_PRESETS;
    const preset = pool[rnd % pool.length].params;
    const start = normalizeParams({
      ...preset,
      print: base.print,
      insert: base.insert,
      render: { ...preset.render },
      random: { seed, locks: [] },
    });
    const r = autoFix(randomize(start, seed));
    return Promise.resolve({ ...r.params, name: '' });
  },

  async exportDesign(params, format, onProgress) {
    const f = await exportDesign(params, format, undefined, { onProgress });
    return Comlink.transfer(f, [f.data.buffer as ArrayBuffer]);
  },

  async exportBatch(params, ods, format, onProgress) {
    const f = await exportBatch(params, ods, format, { onProgress });
    return Comlink.transfer(f, [f.data.buffer as ArrayBuffer]);
  },

  variations(params, seed) {
    const out = [];
    const sleeve = params.print.outputMode === 'sleeve';
    for (let k = 0; k < variationCount(params); k++) {
      // alternate gentle (±15 %) and bolder (±30 %) mutations, each with fresh effect seeds
      const make = (amount: number) => {
        const v = mutate(params, amount, (seed + 7919 * (k + 1)) >>> 0);
        return {
          ...v,
          effects: v.effects.map((e) => ('seed' in e ? { ...e, seed: (e.seed + 1013 * (k + 1)) >>> 0 } : e)),
        };
      };
      const bad = (v: VaseParams) => {
        const r = analyze(buildDesign(v, 'low'), v, { manifold: false });
        return r.score < 90 || r.issues.some((i) => i.severity === 'error');
      };
      let v = make(k % 2 ? 0.3 : 0.15);
      // sleeves: a full auto-fix per cell is too slow for a 3 × 3 grid, so a failing cell retries gentler mutations
      if (sleeve) for (let a = 0.08; a > 0.01 && bad(v); a /= 2) v = make(a);
      else if (bad(v)) v = autoFix(v).params;
      out.push(v);
    }
    return Promise.resolve(out);
  },

  fixForAi(params) {
    const r = analyze(buildDesign(params, 'low'), params, { manifold: false });
    if (r.score >= 90 && !r.issues.some((i) => i.severity === 'error'))
      return Promise.resolve({ params, changed: 0, score: r.score });
    const f = autoFix(params);
    return Promise.resolve({ params: f.params, changed: f.diff.length, score: f.after });
  },

  thumbnail(params) {
    const build = buildDesign(params, 'low');
    const oh = analyzeOverhang(build.mesh, params.print.maxOverhang).vertex;
    const mesh = payload(build.mesh, oh, 'low', 0);
    return Promise.resolve(Comlink.transfer(mesh, transferables(mesh)));
  },
};

Comlink.expose(api);
