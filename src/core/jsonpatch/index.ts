/** RFC 6902 JSON Patch (add, remove, replace, move, copy, test) with RFC 6901 pointers. Pure; never mutates input. */
export type PatchOp =
  | { op: 'add' | 'replace' | 'test'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string };

export class PatchError extends Error {
  constructor(
    message: string,
    public readonly index: number,
  ) {
    super(message);
  }
}

function parsePointer(p: string): string[] {
  if (p === '') return [];
  if (!p.startsWith('/')) throw new Error(`Invalid JSON pointer "${p}"`);
  return p
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function get(doc: unknown, keys: string[]): unknown {
  let cur = doc;
  for (const k of keys) {
    if (Array.isArray(cur)) {
      const i = Number(k);
      if (!/^\d+$/.test(k) || i >= cur.length) throw new Error(`Path not found: /${keys.join('/')}`);
      cur = cur[i];
    } else if (isObj(cur) && k in cur) cur = cur[k];
    else throw new Error(`Path not found: /${keys.join('/')}`);
  }
  return cur;
}

function parentOf(doc: unknown, keys: string[]): { parent: unknown; key: string } {
  return { parent: get(doc, keys.slice(0, -1)), key: keys[keys.length - 1] };
}

function addAt(doc: unknown, keys: string[], value: unknown): unknown {
  if (!keys.length) return value;
  const { parent, key } = parentOf(doc, keys);
  if (Array.isArray(parent)) {
    const i = key === '-' ? parent.length : Number(key);
    if (!(key === '-' || /^\d+$/.test(key)) || i > parent.length) throw new Error(`Bad array index "${key}"`);
    parent.splice(i, 0, value);
  } else if (isObj(parent)) parent[key] = value;
  else throw new Error('Parent is not a container');
  return doc;
}

function removeAt(doc: unknown, keys: string[]): unknown {
  if (!keys.length) throw new Error('Cannot remove the document root');
  const { parent, key } = parentOf(doc, keys);
  if (Array.isArray(parent)) {
    const i = Number(key);
    if (!/^\d+$/.test(key) || i >= parent.length) throw new Error(`Bad array index "${key}"`);
    parent.splice(i, 1);
  } else if (isObj(parent) && key in parent) delete parent[key];
  else throw new Error(`Path not found: /${keys.join('/')}`);
  return doc;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Apply all operations atomically: throws PatchError (with the op index) and leaves the input untouched. */
export function applyPatch<T>(doc: T, ops: readonly PatchOp[]): T {
  let out: unknown = structuredClone(doc);
  ops.forEach((op, i) => {
    try {
      const keys = parsePointer(op.path);
      switch (op.op) {
        case 'add':
          out = addAt(out, keys, structuredClone(op.value));
          break;
        case 'remove':
          out = removeAt(out, keys);
          break;
        case 'replace':
          get(out, keys);
          out = keys.length ? addAt(removeAt(out, keys), keys, structuredClone(op.value)) : structuredClone(op.value);
          break;
        case 'move': {
          const from = parsePointer(op.from);
          if (op.path.startsWith(op.from + '/')) throw new Error('Cannot move a value into its own child');
          const v = get(out, from);
          out = addAt(removeAt(out, from), keys, v);
          break;
        }
        case 'copy':
          out = addAt(out, keys, structuredClone(get(out, parsePointer(op.from))));
          break;
        case 'test':
          if (!deepEqual(get(out, keys), op.value)) throw new Error(`Test failed at ${op.path}`);
          break;
        default:
          throw new Error(`Unknown op ${(op as { op: string }).op}`);
      }
    } catch (e) {
      throw new PatchError(`op ${i} (${op.op} ${op.path}): ${(e as Error).message}`, i);
    }
  });
  return out as T;
}
