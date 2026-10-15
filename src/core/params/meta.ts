import { z } from 'zod';
import { EffectSchema, paramMeta, VaseParamsSchema, type EffectType, type ParamMeta } from './schema';

export interface ParamInfo {
  path: string;
  meta: ParamMeta;
  kind: 'number' | 'int' | 'enum' | 'bool' | 'string' | 'array';
  options?: string[];
}

type AnySchema = z.ZodType & { def: { type: string; innerType?: z.ZodType } };

function unwrap(s: AnySchema): AnySchema {
  let cur = s;
  while (['default', 'prefault', 'optional', 'nullable'].includes(cur.def.type)) cur = cur.def.innerType as AnySchema;
  return cur;
}

function walk(schema: AnySchema, prefix: string, out: ParamInfo[]) {
  const meta = paramMeta.get(schema);
  const inner = unwrap(schema);
  const t = inner.def.type;
  if (t === 'object') {
    for (const [k, sub] of Object.entries((inner as unknown as z.ZodObject).shape)) {
      walk(sub as AnySchema, prefix ? `${prefix}.${k}` : k, out);
    }
    return;
  }
  if (!meta) return;
  let kind: ParamInfo['kind'] = 'string';
  let options: string[] | undefined;
  if (t === 'number') kind = (inner as unknown as z.ZodNumber).isInt ? 'int' : 'number';
  else if (t === 'enum') {
    kind = 'enum';
    options = (inner as unknown as z.ZodEnum).options as string[];
  } else if (t === 'boolean') kind = 'bool';
  else if (t === 'array') kind = 'array';
  out.push({ path: prefix, meta, kind, options });
}

export const PARAMS: ParamInfo[] = (() => {
  const out: ParamInfo[] = [];
  walk(VaseParamsSchema as unknown as AnySchema, '', out);
  return out;
})();

const BY_PATH = new Map(PARAMS.map((p) => [p.path, p]));

export const EFFECT_FIELDS: Record<EffectType, ParamInfo[]> = Object.fromEntries(
  EffectSchema.options.map((o) => {
    const out: ParamInfo[] = [];
    walk(o as unknown as AnySchema, '', out);
    return [(o.shape.type as z.ZodLiteral).value as EffectType, out];
  }),
) as Record<EffectType, ParamInfo[]>;

/** Info for a dot path; effect fields resolve through the effect's type. */
export function paramInfo(path: string, effectType?: EffectType): ParamInfo | undefined {
  const m = /^effects\.(\d+)\.(.+)$/.exec(path);
  if (m && effectType) {
    const f = EFFECT_FIELDS[effectType].find((x) => x.path === m[2]);
    return f && { ...f, path };
  }
  return BY_PATH.get(path);
}
