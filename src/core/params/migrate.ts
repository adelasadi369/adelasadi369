import { PRINTER_PRESETS, SCHEMA_VERSION, type PrinterPreset } from './schema';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One step per schema version: `MIGRATIONS[v]` turns a v-document into a (v+1)-document. */
const MIGRATIONS: Record<number, (p: Raw) => void> = {
  // v1 → v2: `insert` block (filled by its defaults), printer hole compensation from the printer preset.
  1: (p) => {
    const print = isObj(p.print) ? p.print : (p.print = {});
    const printer = isObj(print.printer) ? print.printer : (print.printer = {});
    if (printer.holeCompensation === undefined) {
      const preset = PRINTER_PRESETS[printer.preset as PrinterPreset];
      printer.holeCompensation = preset ? preset.holeCompensation : PRINTER_PRESETS.bambuA1.holeCompensation;
    }
  },
};

/**
 * First step of the params pipeline (raw → migrate → clamp → parse → normalize). Inputs without a version
 * are treated as current. Unknown future versions are left to clamp/parse. Never throws; returns a copy.
 */
export function migrateParams(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const p = structuredClone(raw);
  let v = typeof p.version === 'number' && Number.isInteger(p.version) ? p.version : SCHEMA_VERSION;
  for (; v < SCHEMA_VERSION && MIGRATIONS[v]; v++) MIGRATIONS[v](p);
  p.version = v;
  return p;
}
