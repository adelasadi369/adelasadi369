import { clampToSchema } from './clamp';
import { migrateParams } from './migrate';
import { DEFAULT_PARAMS, SCHEMA_VERSION, VaseParamsSchema, type VaseParams } from './schema';

let idCounter = 0;
const newId = () => `fx${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** Make any raw input a valid VaseParams: migrate → clamp → fix cross-field rules → parse. Never throws. */
export function normalizeParams(raw: unknown): VaseParams {
  const clamped = (clampToSchema(VaseParamsSchema, migrateParams(raw)) ?? {}) as Record<string, unknown>;
  const base = VaseParamsSchema.safeParse(clamped);
  const p: VaseParams = structuredClone(base.success ? base.data : fixLoose(clamped));
  p.version = SCHEMA_VERSION;

  const d = p.dimensions;
  if (d.neckPosition <= d.bellyPosition) {
    if (d.bellyPosition >= 95) d.bellyPosition = 90;
    d.neckPosition = Math.min(100, Math.max(d.neckPosition, d.bellyPosition + 5));
  }
  fixPoints(p.profile.controlPoints);
  p.twist.customCurve.sort((a, b) => a.t - b.t);
  p.twist.customCurve[0].t = 0;
  p.twist.customCurve[p.twist.customCurve.length - 1].t = 100;
  for (const w of ['bottom', 'top'] as const) {
    const pts = p.section[w].custom.points.sort((a, b) => a.a - b.a);
    for (let i = 1; i < pts.length; i++) if (pts[i].a <= pts[i - 1].a) pts[i].a = Math.min(1, pts[i - 1].a + 0.01);
  }
  const ids = new Set<string>();
  for (const e of p.effects) {
    if (e.end <= e.start) e.end = Math.min(100, e.start + 5);
    if (e.end <= e.start) e.start = e.end - 5;
    e.fade = Math.min(e.fade, (e.end - e.start) / 2);
    if (!e.id || ids.has(e.id)) e.id = newId();
    ids.add(e.id);
  }
  // shell wall snaps to a multiple of the line width
  const lw = p.print.lineWidth;
  const snapped = Math.round(p.print.wallThickness / lw) * lw;
  if (snapped >= 1.2 && snapped <= 4) p.print.wallThickness = Math.round(snapped * 1000) / 1000;
  return VaseParamsSchema.parse(p);
}

function fixPoints(pts: VaseParams['profile']['controlPoints']) {
  pts.sort((a, b) => a.t - b.t);
  pts[0].t = 0;
  pts[pts.length - 1].t = 100;
  for (let i = 1; i < pts.length - 1; i++) {
    pts[i].t = Math.min(Math.max(pts[i].t, pts[i - 1].t + 0.5), 100 - 0.5 * (pts.length - 1 - i));
  }
}

/** Fallback when cross-field checks fail: parse each section independently. */
function fixLoose(raw: Record<string, unknown>): VaseParams {
  const out = structuredClone(DEFAULT_PARAMS) as unknown as Record<string, unknown>;
  const shape = VaseParamsSchema.shape as unknown as Record<
    string,
    { safeParse(v: unknown): { success: boolean; data?: unknown } }
  >;
  for (const [k, sub] of Object.entries(shape)) {
    if (raw[k] === undefined) continue;
    const r = sub.safeParse(raw[k]);
    if (r.success) out[k] = r.data;
  }
  return out as unknown as VaseParams;
}
