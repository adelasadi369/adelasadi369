import * as Comlink from 'comlink';
import { buildMesh, type VaseMesh } from '../core/geometry/mesh';
import type { Quality } from '../core/geometry/grid';
import { exportDesign } from '../core/export';
import { mutate, randomize } from '../core/params/random';
import { normalizeParams } from '../core/params/normalize';
import { analyze, buildDesign } from '../core/printability';
import { autoFix } from '../core/printability/autofix';
import { analyzeOverhang } from '../core/printability/overhang';
import { PRESETS } from '../presets';
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
      const s = (build.mesh as { sleeve?: { log: string[] } }).sleeve;
      if (s?.log.length) console.info('[sleeve]', ...s.log);
      const mesh = payload(build.mesh, vertexOverhang, quality, performance.now() - t0);
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
    if (params.print.outputMode === 'sleeve') {
      // sleeve auto-fix arrives in S3: report the design unchanged
      const { vertexOverhang: _v, ...report } = analyze(buildDesign(params, 'low'), params);
      return Promise.resolve({ params, diff: [], before: report.score, after: report.score, iterations: 0, report });
    }
    const r = autoFix(params);
    const { vertexOverhang: _v, ...report } = r.report;
    return Promise.resolve({ ...r, report });
  },

  surprise(seed, base) {
    const rnd = (seed * 2654435761) >>> 0;
    const preset = PRESETS[rnd % PRESETS.length].params;
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

  variations(params, seed) {
    const out = [];
    for (let k = 0; k < 6; k++) {
      // alternate gentle (±15 %) and bolder (±30 %) mutations, each with fresh effect seeds
      let v = mutate(params, k % 2 ? 0.3 : 0.15, (seed + 7919 * (k + 1)) >>> 0);
      v = { ...v, effects: v.effects.map((e) => ('seed' in e ? { ...e, seed: (e.seed + 1013 * (k + 1)) >>> 0 } : e)) };
      const r = analyze(buildDesign(v, 'low'), v, { manifold: false });
      if ((v.print.outputMode !== 'sleeve' && r.score < 90) || r.issues.some((i) => i.severity === 'error'))
        v = autoFix(v).params;
      out.push(v);
    }
    return Promise.resolve(out);
  },

  fixForAi(params) {
    const r = analyze(buildDesign(params, 'low'), params, { manifold: false });
    if (params.print.outputMode === 'sleeve' || (r.score >= 90 && !r.issues.some((i) => i.severity === 'error')))
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
