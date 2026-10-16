import * as Comlink from 'comlink';
import { buildMesh, type VaseMesh } from '../core/geometry/mesh';
import type { Quality } from '../core/geometry/grid';
import { exportDesign } from '../core/export';
import { randomize } from '../core/params/random';
import { normalizeParams } from '../core/params/normalize';
import { analyze } from '../core/printability';
import { autoFix } from '../core/printability/autofix';
import { analyzeOverhang } from '../core/printability/overhang';
import { PRESETS } from '../presets';
import type { GeometryApi, MeshPayload } from './protocol';

/** Manifold-ness only depends on the grid topology, so it is checked once per topology. */
const manifoldCache = new Map<string, boolean>();
const topoKey = (m: VaseMesh) =>
  `${m.mode}|${m.nTheta}|${m.nZ}|${m.surfaces.map((s) => `${s.kind}:${s.rows}`).join(',')}`;

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
    return Promise.resolve(Comlink.transfer({ mesh, report: rest }, transferables(mesh)));
  },

  autoFix(params) {
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
      render: { ...preset.render },
      random: { seed, locks: [] },
    });
    const r = autoFix(randomize(start, seed));
    return Promise.resolve({ ...r.params, name: '' });
  },

  async exportDesign(params, format) {
    const f = await exportDesign(params, format);
    return Comlink.transfer(f, [f.data.buffer as ArrayBuffer]);
  },

  thumbnail(params) {
    const build = buildMesh(params, 'low');
    const oh = analyzeOverhang(build.mesh, params.print.maxOverhang).vertex;
    const mesh = payload(build.mesh, oh, 'low', 0);
    return Promise.resolve(Comlink.transfer(mesh, transferables(mesh)));
  },
};

Comlink.expose(api);
