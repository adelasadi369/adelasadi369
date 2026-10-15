import { z } from 'zod';

/**
 * Walk a zod schema and coerce raw input into range: numbers clamped (and rounded for ints),
 * invalid enums/literals dropped (→ default), arrays trimmed to max length, unknown keys dropped.
 * The result is then parsed with the schema itself.
 */
export function clampToSchema(schema: z.ZodType, value: unknown): unknown {
  const s = schema as unknown as { def: { type: string } } & Record<string, unknown>;
  const def = s.def as Record<string, unknown> & { type: string };
  switch (def.type) {
    case 'default':
    case 'prefault':
    case 'optional':
    case 'nullable':
      if (value === undefined) return undefined;
      return clampToSchema(def.innerType as z.ZodType, value);
    case 'pipe':
      return clampToSchema(def.in as z.ZodType, value);
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      const n = schema as unknown as z.ZodNumber;
      let v = value;
      if (n.minValue !== null && v < n.minValue) v = n.minValue;
      if (n.maxValue !== null && v > n.maxValue) v = n.maxValue;
      if (n.isInt) v = Math.round(v);
      return v;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'enum': {
      const e = schema as unknown as z.ZodEnum;
      return e.options.includes(value as never) ? value : undefined;
    }
    case 'literal':
      return (def.values as unknown[]).includes(value) ? value : undefined;
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const shape = (schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(shape)) {
        const v = clampToSchema(sub, (value as Record<string, unknown>)[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    case 'array': {
      if (!Array.isArray(value)) return undefined;
      const a = schema as unknown as z.ZodArray<z.ZodType>;
      const max = (a.def.checks ?? [])
        .map((c) => (c as unknown as { _zod: { def: { check: string; maximum?: number } } })._zod.def)
        .find((d) => d.check === 'max_length')?.maximum;
      const items = value.map((v) => clampToSchema(a.element, v)).filter((v) => v !== undefined);
      return max !== undefined ? items.slice(0, max) : items;
    }
    case 'union': {
      // discriminated union: pick the option whose literal discriminator matches
      const opts = def.options as z.ZodType[];
      for (const o of opts) {
        const r = clampToSchema(o, value);
        if (r !== undefined && (o as unknown as z.ZodObject).shape?.type) {
          const lit = (o as unknown as z.ZodObject).shape.type as unknown as z.ZodLiteral;
          if ((value as { type?: unknown })?.type === lit.value) return r;
        }
      }
      return undefined;
    }
    default:
      return value;
  }
}
