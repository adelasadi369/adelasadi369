import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { normalizeParams } from './normalize';
import { diffParams, setPath } from './paths';
import { DEFAULT_PARAMS, SCHEMA_VERSION, type VaseParams } from './schema';

/** Compact share token: only the paths that differ from the defaults. */
export function encodeShare(p: VaseParams): string {
  const delta: Record<string, unknown> = {};
  for (const d of diffParams(DEFAULT_PARAMS, p)) {
    // arrays of objects (effects, points) are stored whole
    const top = d.path.match(/^(effects|profile\.controlPoints|twist\.customCurve|section\.(?:bottom|top)\.custom\.points)(\.|$)/);
    if (top) delta[top[1]] = top[1].split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], p);
    else delta[d.path] = d.to;
  }
  return `${SCHEMA_VERSION}.${compressToEncodedURIComponent(JSON.stringify(delta))}`;
}

export function decodeShare(token: string): VaseParams | null {
  const m = /^(\d+)\.(.+)$/.exec(token);
  if (!m) return null;
  const json = decompressFromEncodedURIComponent(m[2]);
  if (!json) return null;
  try {
    const delta = JSON.parse(json) as Record<string, unknown>;
    let p: unknown = structuredClone(DEFAULT_PARAMS);
    for (const [path, v] of Object.entries(delta)) p = setPath(p, path, v);
    return normalizeParams(p);
  } catch {
    return null;
  }
}
