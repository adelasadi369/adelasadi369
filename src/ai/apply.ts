import { applyPatch, type PatchOp } from '../core/jsonpatch';
import { PARAMS } from '../core/params/meta';
import { normalizeParams } from '../core/params/normalize';
import { setPath } from '../core/params/paths';
import { DEFAULT_PARAMS, type VaseParams } from '../core/params/schema';
import type { Preset } from '../presets';
import type { DesignProposal, ImageAnalysis, RefinePatch } from './schema';

const KNOWN = new Set([...PARAMS.map((p) => p.path), 'effects', 'name']);

function parseJson(s: string | null): unknown {
  if (s === null) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s; // tolerate bare strings like tulip
  }
}

export interface Applied {
  params: VaseParams;
  /** Paths or ops that were rejected (unknown path, invalid patch). */
  rejected: string[];
}

/** proposal → closest preset + changes → validate/clamp (normalize). Auto-fix runs afterwards in the worker. */
export function applyProposal(p: DesignProposal, presets: Preset[]): Applied {
  const base = presets.find((x) => x.id === p.basePreset)?.params ?? DEFAULT_PARAMS;
  let out: unknown = structuredClone(base);
  const rejected: string[] = [];
  for (const c of p.changes) {
    if (!KNOWN.has(c.path)) {
      rejected.push(c.path);
      continue;
    }
    out = setPath(out, c.path, parseJson(c.valueJson));
  }
  return { params: normalizeParams(out), rejected };
}

/** Apply the model's JSON Patch atomically; on any failure keep the current params. */
export function applyRefine(current: VaseParams, patch: RefinePatch): Applied {
  const ops: PatchOp[] = patch.ops.map((o) =>
    o.op === 'move' || o.op === 'copy'
      ? { op: o.op, from: o.from ?? '', path: o.path }
      : o.op === 'remove'
        ? { op: 'remove', path: o.path }
        : { op: o.op, path: o.path, value: parseJson(o.valueJson) },
  );
  try {
    return { params: normalizeParams(applyPatch(current, ops)), rejected: [] };
  } catch (e) {
    return { params: current, rejected: [(e as Error).message] };
  }
}

/** Image analysis → custom profile + section/ribs/texture/twist on top of the current print settings. */
export function applyImageAnalysis(a: ImageAnalysis, current: VaseParams): VaseParams {
  const height = current.dimensions.height;
  const maxD = Math.min(250, Math.max(30, height / Math.max(0.4, a.heightToWidth)));
  const pts = [...a.profile]
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.r))
    .sort((x, y) => x.t - y.t)
    .slice(0, 12);
  let p: unknown = structuredClone(current);
  if (pts.length >= 3) {
    pts[0] = { ...pts[0], t: 0 };
    pts[pts.length - 1] = { ...pts[pts.length - 1], t: 1 };
    p = setPath(p, 'profile.preset', 'custom');
    p = setPath(
      p,
      'profile.controlPoints',
      pts.map((q) => ({ t: Math.round(q.t * 1000) / 10, r: Math.min(1, Math.max(0.05, q.r)), sharp: false })),
    );
    p = setPath(p, 'dimensions.maxDiameter', Math.round(maxD));
  }
  p = setPath(p, 'section.bottom.shape', a.section);
  if (a.sides) {
    const n = Math.round(a.sides);
    if (a.section === 'polygon') p = setPath(p, 'section.bottom.sides', n);
    if (a.section === 'star') p = setPath(p, 'section.bottom.starPoints', n);
    if (a.section === 'flower') p = setPath(p, 'section.bottom.petals', n);
  }
  p = setPath(p, 'twist.total', Math.round(a.twistDeg));
  const effects: unknown[] = [];
  if (a.ribs) {
    effects.push({
      type: 'ribs',
      count: Math.round(a.ribs.count),
      depth: (a.ribs.depthMm * maxD) / 100,
      style: a.ribs.grooved ? 'grooved' : 'raised',
      helixTurns: a.ribs.helixTurns,
    });
  }
  if (a.texture) effects.push({ type: 'texture', pattern: a.texture, depth: 0.8 });
  p = setPath(p, 'effects', effects);
  if (/^#[0-9a-f]{6}$/i.test(a.colorHex)) p = setPath(p, 'render.color', a.colorHex);
  return normalizeParams(p);
}

/** Local silhouette (no AI): custom profile + max diameter only; everything else stays. */
export function applySilhouette(
  points: { t: number; r: number }[],
  heightToWidth: number,
  current: VaseParams,
): VaseParams {
  const maxD = Math.min(250, Math.max(30, current.dimensions.height / Math.max(0.4, heightToWidth)));
  const pts = [...points].sort((a, b) => a.t - b.t).slice(0, 12);
  if (pts.length < 3) return current;
  let p: unknown = setPath(current, 'profile.preset', 'custom');
  p = setPath(
    p,
    'profile.controlPoints',
    pts.map((q, i) => ({
      t: i === 0 ? 0 : i === pts.length - 1 ? 100 : Math.round(q.t * 1000) / 10,
      r: Math.min(1, Math.max(0.05, q.r)),
      sharp: false,
    })),
  );
  p = setPath(p, 'dimensions.maxDiameter', Math.round(maxD));
  return normalizeParams(p);
}
