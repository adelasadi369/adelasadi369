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
  // v2 → v3: outputMode 'sleeve' and the `sleeve` block (filled by its defaults); nothing to rewrite.
  2: () => {},
  // v3 → v4: sleeve holes + top edge (filled by their defaults); the preview voxel default moved 1.0 → 1.5 mm,
  // so a stored old default follows it.
  3: (p) => {
    const mesh = isObj(p.sleeve) && isObj(p.sleeve.mesh) ? p.sleeve.mesh : null;
    if (mesh && mesh.previewVoxel === 1) mesh.previewVoxel = 1.5;
  },
  // v4 → v5 (S3): fingers, drips, more hole modes, self-supporting, organic 'blobs' (filled by their defaults).
  // Smoother sleeve defaults: smoothing 3 → 4 passes (more thins coarse ribs at the 2 mm drag voxel), hole edge roundness 1 → 1.5 mm; stored old defaults follow.
  4: (p) => {
    const sl = isObj(p.sleeve) ? p.sleeve : null;
    if (sl && isObj(sl.mesh) && sl.mesh.smoothing === 3) sl.mesh.smoothing = 4;
    if (sl && isObj(sl.holes) && sl.holes.edgeRoundness === 1) sl.holes.edgeRoundness = 1.5;
  },
  // v5 → v6 (S4): thin draped shell `sleeve.skinThickness` (new designs 2.4 mm) and ribbon fingers (round by
  // default). Stored designs stay solid (0) so they keep their look, weight and print time.
  5: (p) => {
    const sl = isObj(p.sleeve) ? p.sleeve : (p.sleeve = {});
    if (sl.skinThickness === undefined) sl.skinThickness = 0;
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
