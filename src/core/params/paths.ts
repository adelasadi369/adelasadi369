/** Dot-path helpers (e.g. "effects.0.depth"). Immutable set with structural sharing. */
type Obj = Record<string, unknown> | unknown[];

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const rec = (node: unknown, i: number): unknown => {
    const k = keys[i];
    const src = (node ?? {}) as Obj;
    const copy: Obj = Array.isArray(src) ? src.slice() : { ...src };
    const next = i === keys.length - 1 ? value : rec((src as Record<string, unknown>)[k], i + 1);
    (copy as Record<string, unknown>)[k] = next;
    return copy;
  };
  return rec(obj, 0) as T;
}

/** Flatten leaves to dot paths (arrays of primitives stay leaves). */
export function flatten(obj: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj !== null && typeof obj === 'object') {
    const isPrimArray = Array.isArray(obj) && obj.every((v) => v === null || typeof v !== 'object');
    if (!isPrimArray) {
      for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
      return out;
    }
  }
  out[prefix] = obj;
  return out;
}

export interface ParamDiff {
  path: string;
  from: unknown;
  to: unknown;
}

export function diffParams(a: unknown, b: unknown): ParamDiff[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  const out: ParamDiff[] = [];
  for (const k of keys) {
    if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) out.push({ path: k, from: fa[k], to: fb[k] });
  }
  return out;
}
