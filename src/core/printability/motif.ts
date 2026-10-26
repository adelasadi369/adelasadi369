import { buildMotifMap, type MotifMap } from '../motif/map';
import type { I18nText, VaseParams } from '../params/schema';
import type { Issue } from './types';

const t = (fa: string, en: string): I18nText => ({ fa, en });
const f1 = (x: number) => x.toFixed(1);
const DEG = Math.PI / 180;

/** Cap of the relief map (mm): the same value the motif effect uses, so both read one cached map. */
export const reliefCap = (softness: number) => Math.max(1.5, softness * 2 + 0.5);

/**
 * Share of the motif thinner than `width`: a morphological opening on the map (erode to d ≤ −width/2, dilate back by
 * width/2); what the opening removes cannot hold two print lines. Sharp corners lose a little, thin lines all of it.
 * Returns the removed share of the motif area and the widest removed part (2·max|d|).
 */
export function thinShare(map: MotifMap, width: number): { share: number; width: number } {
  const { nx, nz, d, rRef, H } = map;
  const r = width / 2;
  const px = (2 * Math.PI * rRef) / nx;
  const pz = H / (nz - 1);
  const wi = Math.ceil(r / px);
  const wj = Math.ceil(r / pz);
  let inside = 0;
  let removed = 0;
  let worst = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const v = d[j * nx + i];
      if (v >= 0) continue;
      inside++;
      if (v <= -r) continue;
      let kept = false;
      for (let dj = -wj; dj <= wj && !kept; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= nz) continue;
        for (let di = -wi; di <= wi; di++) {
          if ((di * px) ** 2 + (dj * pz) ** 2 > r * r) continue;
          if (d[jj * nx + ((i + di + nx) % nx)] <= -r) {
            kept = true;
            break;
          }
        }
      }
      if (!kept) {
        removed++;
        worst = Math.max(worst, -2 * v);
      }
    }
  return { share: inside ? removed / inside : 0, width: worst };
}

/**
 * Motif checks (GEOMETRY.md §14): relief depth against the wall it is cut into, features narrower than two print
 * lines, and relief edges steeper than the overhang limit (raised relief undersides).
 */
export function motifIssues(p: VaseParams, H: number): Issue[] {
  const out: Issue[] = [];
  if (p.motif.source === 'none') return out;
  const lw = p.print.lineWidth;
  const sleeve = p.print.outputMode === 'sleeve';
  p.effects.forEach((e, k) => {
    if (e.type !== 'motif' || !e.enabled) return;
    const map = buildMotifMap(p, H, p.dimensions.maxDiameter / 2, reliefCap(e.softness));
    if (!map) return;
    // engraving into a thin wall: shells, and sleeves with a draped skin
    const wall = sleeve ? p.sleeve.skinThickness : p.print.outputMode === 'shell' ? p.print.wallThickness : 0;
    const cut = e.relief === 'engraved' ? e.depth : e.relief === 'both' ? e.depth / 2 : 0;
    if (wall > 0 && cut > wall - 2 * lw + 1e-6) {
      const safe = Math.max(0.2, Math.floor((wall - 2 * lw) * 10) / 10);
      out.push({
        id: `motif-depth-${k}`,
        check: 'walls',
        severity: cut >= wall ? 'error' : 'warn',
        message: t(
          `حکاکی نقش ${f1(cut)} میلی‌متر در دیوارهٔ ${f1(wall)} میلی‌متری فرو می‌رود؛ دست‌کم دو خط (${f1(2 * lw)}) باید بماند.`,
          `The engraving cuts ${f1(cut)} mm into a ${f1(wall)} mm wall; at least two lines (${f1(2 * lw)} mm) must remain.`,
        ),
        fix: {
          kind: 'patch',
          label: t('حکاکی کم‌عمق‌تر', 'Shallower engraving'),
          changes: [{ path: `effects.${k}.depth`, value: e.relief === 'both' ? 2 * safe : safe }],
        },
        penalty: cut >= wall ? 30 : 8,
      });
    }
    // features of the motif (raised parts, or the grooves of an engraving) narrower than two lines
    const thin = thinShare(map, 2 * lw);
    if (thin.share > 0.15) {
      const k2 = Math.min(2, (2 * lw) / Math.max(thin.width, 0.2));
      out.push({
        id: `motif-feature-${k}`,
        check: 'features',
        severity: 'warn',
        message: t(
          `${Math.round(100 * thin.share)}٪ نقش باریک‌تر از دو خط چاپ (${f1(2 * lw)} میلی‌متر) است و چاپ نمی‌شود.`,
          `${Math.round(100 * thin.share)}% of the motif is narrower than two print lines (${f1(2 * lw)} mm) and will not print.`,
        ),
        fix:
          p.motif.placement === 'single' && p.motif.source !== 'persian'
            ? {
                kind: 'patch',
                label: t('نقش بزرگ‌تر', 'Larger motif'),
                changes: [{ path: 'motif.size', value: Math.min(250, Math.ceil(p.motif.size * k2)) }],
              }
            : {
                kind: 'patch',
                label: t('تکرار کمتر (نقش بزرگ‌تر)', 'Fewer repeats (larger motif)'),
                changes: [{ path: 'motif.repeatsAround', value: Math.max(1, Math.floor(p.motif.repeatsAround / k2)) }],
              },
        penalty: 4,
      });
    }
    // raised edges: the ramp of width `softness` over `depth` must stay within the overhang limit
    if (e.relief !== 'engraved') {
      const rise = e.relief === 'both' ? e.depth : e.depth;
      const need = rise / Math.tan(p.print.maxOverhang * DEG);
      if (e.softness < need - 1e-6) {
        out.push({
          id: `motif-edge-${k}`,
          check: 'overhang',
          severity: 'info',
          message: t(
            `لبهٔ زیرین نقش برجسته از ${p.print.maxOverhang}° تندتر است؛ نرمی لبهٔ دست‌کم ${f1(need)} میلی‌متر آن را بدون ساپورت چاپ‌پذیر می‌کند.`,
            `The relief's lower edges are steeper than ${p.print.maxOverhang}°; an edge softness of at least ${f1(need)} mm prints them without supports.`,
          ),
          fix: {
            kind: 'patch',
            label: t('لبه‌های نرم‌تر', 'Softer relief edges'),
            changes: [{ path: `effects.${k}.softness`, value: Math.min(3, Math.ceil(need * 10) / 10) }],
          },
          fixes: [
            {
              kind: 'patch',
              label: t('نقش کم‌عمق‌تر', 'Shallower relief'),
              changes: [{ path: `effects.${k}.depth`, value: Math.max(0.2, Math.floor(e.softness * 10) / 10) }],
            },
          ],
          penalty: 0,
        });
      }
    }
  });
  return out;
}
