import type { BuildResult } from '../geometry/mesh';
import { bedSize, type I18nText, type VaseParams } from '../params/schema';
import { BANDS } from './overhang';
import { checkManifold } from './sanity';
import { bbox, ringMetrics, rayToRing, surfaceCentroid, surfaceOf, volumeCentroid } from './geometryStats';
import type { Issue, OverhangSummary } from './types';

const t = (fa: string, en: string): I18nText => ({ fa, en });
const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const isVase = (p: VaseParams) => p.print.outputMode !== 'shell';
export const TRIANGLE_BUDGET = 2_000_000;

export function overhangIssues(o: OverhangSummary, maxDeg: number): Issue[] {
  const issues: Issue[] = [];
  const runs = (arr: Float32Array, thr: number) => {
    const out: [number, number][] = [];
    let start = -1;
    for (let b = 0; b <= BANDS; b++) {
      const on = b < BANDS && arr[b] > thr;
      if (on && start < 0) start = b;
      if (!on && start >= 0) {
        out.push([(start * 100) / BANDS, (b * 100) / BANDS]);
        start = -1;
      }
    }
    return out;
  };
  const label = t('قابل‌چاپش کن', 'Make it printable');
  if (o.redFraction > 0.002) {
    for (const r of runs(o.bandsRed, 0.01)) {
      issues.push({
        id: `overhang-red-${r[0]}`,
        check: 'overhang',
        severity: 'error',
        heightRange: r,
        message: t(
          `آویز بیش از ${maxDeg + 10}° بین ${f1(r[0])}٪ تا ${f1(r[1])}٪ ارتفاع.`,
          `Overhang above ${maxDeg + 10}° between ${f1(r[0])}% and ${f1(r[1])}% of height.`,
        ),
        fix: { kind: 'autofix', label },
        penalty: Math.min(40, 15 + 300 * o.redFraction),
      });
    }
  }
  if (o.yellowFraction > 0.01) {
    const r = runs(o.bandsYellow, 0.03);
    if (r.length) {
      issues.push({
        id: 'overhang-yellow',
        check: 'overhang',
        severity: 'warn',
        heightRange: [r[0][0], r[r.length - 1][1]],
        message: t(
          `بخشی از سطح بین ${maxDeg}° و ${maxDeg + 10}° آویز دارد؛ با خنک‌کاری خوب چاپ می‌شود.`,
          `Some surface is between ${maxDeg}° and ${maxDeg + 10}°; prints with good cooling.`,
        ),
        fix: { kind: 'autofix', label },
        penalty: Math.min(10, 3 + 100 * o.yellowFraction),
      });
    }
  }
  return issues;
}

export function featureIssues(b: BuildResult, p: VaseParams): Issue[] {
  const { mesh, field } = b;
  const outer = surfaceOf(mesh, 'outer')!;
  const noz = p.print.nozzle;
  const issues: Issue[] = [];
  const step = Math.max(1, Math.floor(mesh.nZ / 40));
  const rings: { t: number; L: number; R: number }[] = [];
  for (let j = 0; j < mesh.nZ; j += step) {
    const m = ringMetrics(mesh, outer, j);
    rings.push({ t: m.z / field.H, L: m.perimeter, R: field.profile.R(m.z / field.H) });
  }
  const check = (
    id: string,
    name: I18nText,
    reps: number,
    depthAt: (R: number) => number,
    active: (t: number) => boolean,
    depthPath?: string,
    currentDepth?: number,
  ) => {
    if (reps <= 1) return;
    let worstPitch = Infinity;
    let worstRatio = 0;
    let worstDepthPitch = Infinity;
    for (const r of rings) {
      if (!active(r.t)) continue;
      const pitch = r.L / reps;
      worstPitch = Math.min(worstPitch, pitch);
      const ratio = depthAt(r.R) / pitch;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstDepthPitch = pitch;
      }
    }
    if (!isFinite(worstPitch)) return;
    if (worstPitch < 2 * noz) {
      issues.push({
        id: `feature-pitch-${id}`,
        check: 'features',
        severity: worstPitch < noz ? 'error' : 'warn',
        message: t(
          `${name.fa}: فاصلهٔ تکرار ${f1(worstPitch)} میلی‌متر کمتر از ۲ برابر نازل است؛ جزئیات محو می‌شود.`,
          `${name.en}: pitch ${f1(worstPitch)} mm is below 2× nozzle; detail will blur.`,
        ),
        penalty: worstPitch < noz ? 20 : 5,
      });
    }
    if (worstRatio > 0.5) {
      const maxDepth = Math.floor(0.5 * worstDepthPitch * 0.95 * 10) / 10;
      issues.push({
        id: `feature-depth-${id}`,
        check: 'features',
        severity: worstRatio > 1 ? 'error' : 'warn',
        message: t(
          `${name.fa}: عمق شیار بیش از نصف گام است؛ نازل به ته شیار نمی‌رسد.`,
          `${name.en}: groove depth exceeds half the pitch; the nozzle can't follow it.`,
        ),
        fix:
          depthPath && currentDepth !== undefined
            ? {
                kind: 'patch',
                label: t(`عمق ← ${maxDepth}`, `Depth → ${maxDepth} mm`),
                changes: [{ path: depthPath, value: Math.min(currentDepth, maxDepth) }],
              }
            : undefined,
        penalty: worstRatio > 1 ? 20 : 5,
      });
    }
  };

  field.sections.forEach((sec, k) => {
    if (sec.eval.grooveDepth <= 0) return;
    check(
      `section${k}`,
      t('مقطع', 'Section'),
      sec.eval.repetitions,
      (R) => sec.eval.grooveDepth * R,
      () => true,
    );
  });
  if (field.lobesCount) {
    check(
      'lobes',
      t('لوب‌ها', 'Lobes'),
      field.lobesCount,
      (R) => (R * p.twist.lobes.depth) / 100,
      () => true,
    );
  }
  let k = 0;
  p.effects.forEach((e, i) => {
    if (!e.enabled) return;
    const ce = field.effects[k++]; // compiled effects = enabled effects, in order
    if (!ce || ce.unsupported) return;
    const name = t(`افکت ${i + 1}`, `Effect ${i + 1} (${e.type})`);
    const active = (tt: number) => ce.mask(tt) > 0.01;
    if (e.type === 'ribs') check(`fx${i}`, name, ce.repetitions, () => e.depth, active, `effects.${i}.depth`, e.depth);
    else if (e.type === 'waves')
      check(`fx${i}`, name, e.freqTheta, () => 2 * e.amplitude, active, `effects.${i}.amplitude`, e.amplitude);
    else if (e.type === 'noise')
      check(`fx${i}`, name, ce.repetitions, () => e.amplitude, active, `effects.${i}.amplitude`, e.amplitude);
    else if (e.type === 'organic')
      check(`fx${i}`, name, ce.repetitions, () => e.amount, active, `effects.${i}.amount`, e.amount);
    else if (e.type === 'texture')
      check(`fx${i}`, name, ce.repetitions, () => e.depth, active, `effects.${i}.depth`, e.depth);
  });
  return issues;
}

export function wallIssues(p: VaseParams): Issue[] {
  const { nozzle, lineWidth, layerHeight, wallThickness } = p.print;
  const issues: Issue[] = [];
  if (isVase(p)) {
    if (lineWidth < 1.5 * nozzle || lineWidth > 2 * nozzle) {
      const v = Math.round(1.75 * nozzle * 100) / 100;
      issues.push({
        id: 'wall-linewidth',
        check: 'walls',
        severity: 'warn',
        message: t(
          `در حالت گلدان پهنای خط باید ۱.۵ تا ۲ برابر نازل باشد (${f1(1.5 * nozzle)}–${f1(2 * nozzle)}).`,
          `Vase mode line width should be 1.5–2× nozzle (${(1.5 * nozzle).toFixed(2)}–${(2 * nozzle).toFixed(2)} mm).`,
        ),
        fix: {
          kind: 'patch',
          label: t(`پهنای خط ← ${v}`, `Line width → ${v} mm`),
          changes: [{ path: 'print.lineWidth', value: v }],
        },
        penalty: 5,
      });
    }
  } else if (wallThickness < 2 * lineWidth - 1e-6) {
    const v = Math.min(4, Math.ceil((2 * lineWidth) / lineWidth) * lineWidth);
    issues.push({
      id: 'wall-thin',
      check: 'walls',
      severity: 'error',
      message: t('ضخامت دیواره باید دست‌کم ۲ برابر پهنای خط باشد.', 'Shell wall must be at least 2× line width.'),
      fix: {
        kind: 'patch',
        label: t('دیوارهٔ ضخیم‌تر', 'Thicker wall'),
        changes: [{ path: 'print.wallThickness', value: Math.max(1.2, v) }],
      },
      penalty: 20,
    });
  }
  if (layerHeight > 0.66 * lineWidth + 1e-9) {
    const v = Math.floor(0.66 * lineWidth * 100) / 100;
    issues.push({
      id: 'wall-layer',
      check: 'walls',
      severity: layerHeight > 0.8 * lineWidth ? 'error' : 'warn',
      message: t('ارتفاع لایه بیش از ۰.۶۶ پهنای خط است.', 'Layer height exceeds 0.66 × line width.'),
      fix: {
        kind: 'patch',
        label: t(`ارتفاع لایه ← ${v}`, `Layer → ${v} mm`),
        changes: [{ path: 'print.layerHeight', value: v }],
      },
      penalty: layerHeight > 0.8 * lineWidth ? 20 : 5,
    });
  }
  return issues;
}

export function boundsIssues(b: BuildResult, p: VaseParams): { issues: Issue[]; sx: number; sy: number } {
  const bb = bbox(b.mesh);
  const bed = bedSize(p.print);
  const lim = Math.min(bed.bedX, bed.bedY) - 5;
  const issues: Issue[] = [];
  const foot = Math.max(bb.sx, bb.sy);
  if (foot > lim) {
    const s = lim / foot;
    const d = p.dimensions;
    issues.push({
      id: 'bounds-xy',
      check: 'bounds',
      severity: 'error',
      message: t(
        `پهنای ${f1(foot)} میلی‌متر از بستر (${lim}) بزرگ‌تر است.`,
        `Footprint ${f1(foot)} mm exceeds the bed (${lim} mm).`,
      ),
      fix: {
        kind: 'patch',
        label: t('کوچک کردن قطرها', 'Scale diameters down'),
        changes: (['baseDiameter', 'topDiameter', 'maxDiameter', 'neckDiameter'] as const).map((k) => ({
          path: `dimensions.${k}`,
          value: Math.floor(d[k] * s * 0.98 * 2) / 2,
        })),
      },
      penalty: 25,
    });
  }
  if (b.mesh.height > bed.bedZ) {
    issues.push({
      id: 'bounds-z',
      check: 'bounds',
      severity: 'error',
      message: t(`ارتفاع از حداکثر ارتفاع چاپ (${bed.bedZ}) بیشتر است.`, `Height exceeds printer Z (${bed.bedZ} mm).`),
      fix: {
        kind: 'patch',
        label: t(`ارتفاع ← ${bed.bedZ - 2}`, `Height → ${bed.bedZ - 2} mm`),
        changes: [{ path: 'dimensions.height', value: Math.max(40, bed.bedZ - 2) }],
      },
      penalty: 25,
    });
  }
  return { issues, sx: bb.sx, sy: bb.sy };
}

export function modeIssues(p: VaseParams): Issue[] {
  const issues: Issue[] = [];
  if (isVase(p)) {
    const needs: string[] = [];
    if (p.rim.ruffle.count > 0 && p.rim.ruffle.depth > 0) needs.push('ruffle');
    if (p.rim.slant.height > 0) needs.push('slant');
    if (p.base.concave > 0) needs.push('concave');
    if (p.base.drainageHole > 0) needs.push('drainage');
    if (needs.length) {
      issues.push({
        id: 'mode-shell',
        check: 'mode',
        severity: 'error',
        message: t(
          `این ویژگی‌ها حالت پوسته لازم دارند: ${needs.join('، ')}.`,
          `These features require shell mode: ${needs.join(', ')}.`,
        ),
        fix: {
          kind: 'patch',
          label: t('تغییر به پوسته', 'Switch to shell'),
          changes: [{ path: 'print.outputMode', value: 'shell' }],
        },
        penalty: 20,
      });
    }
  }
  if (p.print.outputMode === 'doubleWallVase') {
    issues.push({
      id: 'mode-doublewall',
      check: 'mode',
      severity: 'info',
      message: t(
        'دوجداره: در اسلایسر «حالت گلدان/اسپیرال» را روشن کنید؛ شکاف ۰٫۰۰۰۱ میلی‌متری دو دیواره را در یک مسیر چاپ می‌کند.',
        'Double wall: enable spiral/vase mode in the slicer; the 0.0001 mm slit prints both walls in one path.',
      ),
      penalty: 0,
    });
    if (p.print.wallThickness < 2 * p.print.lineWidth + 0.4) {
      issues.push({
        id: 'mode-doublewall-gap',
        check: 'walls',
        severity: 'warn',
        message: t('فاصلهٔ دو دیواره کم است؛ دیواره‌ها به هم می‌چسبند.', 'The two walls are too close and will fuse.'),
        fix: {
          kind: 'patch',
          label: t('فاصلهٔ بیشتر', 'Wider gap'),
          changes: [
            { path: 'print.wallThickness', value: Math.min(4, Math.ceil((2 * p.print.lineWidth + 0.8) * 10) / 10) },
          ],
        },
        penalty: 5,
      });
    }
  }
  if (p.print.outputMode !== 'shell' && p.print.innerSurface === 'follow') {
    issues.push({
      id: 'mode-follow',
      check: 'mode',
      severity: 'info',
      message: t(
        'سطح داخلی هم‌شکل فقط در حالت پوسته اعمال می‌شود.',
        'The "follow" inner surface only applies in shell mode.',
      ),
      fix: {
        kind: 'patch',
        label: t('تغییر به پوسته', 'Switch to shell'),
        changes: [{ path: 'print.outputMode', value: 'shell' }],
      },
      penalty: 0,
    });
  }
  const unsupported = p.effects.filter((e) => e.enabled && e.type === 'displacement');
  if (unsupported.length) {
    issues.push({
      id: 'mode-effects',
      check: 'mode',
      severity: 'info',
      message: t(
        'نقشهٔ برجستگی تصویری در فاز ۳ فعال می‌شود و فعلاً اعمال نمی‌شود.',
        'Image displacement arrives in Phase 3 and is skipped for now.',
      ),
      penalty: 0,
    });
  }
  return issues;
}

export function stabilityIssues(b: BuildResult, p: VaseParams): Issue[] {
  const { mesh } = b;
  const issues: Issue[] = [];
  const H = p.dimensions.height;
  if (p.dimensions.baseDiameter < 0.35 * H) {
    const v = Math.ceil(0.35 * H);
    issues.push({
      id: 'stability-base',
      check: 'stability',
      severity: 'warn',
      message: t(
        'کف نسبت به ارتفاع باریک است؛ ممکن است واژگون شود.',
        'Base is narrow for the height; it may tip over.',
      ),
      fix: {
        kind: 'patch',
        label: t(`قطر کف ← ${v}`, `Base Ø → ${v} mm`),
        changes: [{ path: 'dimensions.baseDiameter', value: Math.min(200, v) }],
      },
      penalty: 5,
    });
  }
  // centre of mass
  const outer = surfaceOf(mesh, 'outer')!;
  let cx: number, cy: number, mass: number;
  if (mesh.mode === 'solidVase') {
    const w = surfaceCentroid(mesh, outer);
    const bm = ringMetrics(mesh, outer, 0);
    const wm = w.area * p.print.lineWidth;
    const bmv = bm.area * Math.max(p.base.bottomThickness, 0.8);
    mass = wm + bmv;
    cx = (w.x * wm + bm.cx * bmv) / mass;
    cy = (w.y * wm + bm.cy * bmv) / mass;
  } else {
    const v = volumeCentroid(mesh);
    mass = v.volume;
    cx = v.x;
    cy = v.y;
  }
  if (p.print.useCase === 'freshFlowers' || p.print.useCase.endsWith('Planter')) {
    // cavity fill to 70 % height (water or soil ≈ 1 g/cm³ vs ~1.2 for plastic)
    const inner = surfaceOf(mesh, 'inner') ?? outer;
    let wv = 0,
      wx = 0,
      wy = 0,
      prev: ReturnType<typeof ringMetrics> | null = null;
    for (let r = 0; r < inner.rows; r++) {
      const m = ringMetrics(mesh, inner, r);
      if (m.z > 0.7 * H) continue;
      if (prev) {
        const dv = ((m.area + prev.area) / 2) * Math.abs(m.z - prev.z);
        wv += dv;
        wx += dv * m.cx;
        wy += dv * m.cy;
      }
      prev = m;
    }
    if (wv > 0) {
      const wm = wv / 1.2;
      cx = (cx * mass + wx / 1.2) / (mass + wm);
      cy = (cy * mass + wy / 1.2) / (mass + wm);
    }
  }
  const base = ringMetrics(mesh, outer, 0);
  const dx = cx - base.cx;
  const dy = cy - base.cy;
  const d = Math.hypot(dx, dy);
  if (d > 1e-3) {
    const reach = rayToRing(mesh, outer, 0, base.cx, base.cy, dx / d, dy / d);
    if (d > 0.8 * reach) {
      issues.push({
        id: 'stability-com',
        check: 'stability',
        severity: 'error',
        message: t(
          'مرکز جرم بیرون از ناحیهٔ امن کف است؛ گلدان واژگون می‌شود.',
          'Centre of mass falls outside the safe base area; it will tip.',
        ),
        fix: {
          kind: 'patch',
          label: t('کاهش خمش', 'Reduce bend'),
          changes: [{ path: 'twist.bend.offset', value: p.twist.bend.offset * 0.5 }],
        },
        penalty: 25,
      });
    }
  }
  return issues;
}

export function sanityIssues(b: BuildResult): { issues: Issue[]; manifold: boolean } {
  const { mesh } = b;
  const issues: Issue[] = [];
  if (mesh.holeClamped) {
    issues.push({
      id: 'sanity-hole',
      check: 'sanity',
      severity: 'warn',
      message: t(
        'سوراخ زهکشی برای کف بزرگ بود و کوچک شد.',
        'The drainage hole was too large for the floor and was reduced.',
      ),
      penalty: 3,
    });
  }
  if (mesh.clamped > 0) {
    issues.push({
      id: 'sanity-rmin',
      check: 'sanity',
      severity: 'warn',
      message: t(
        'بخشی از سطح به حداقل شعاع ۵ میلی‌متر رسیده و صاف شده است.',
        'Part of the surface hit the 5 mm minimum radius and was flattened.',
      ),
      fix: { kind: 'autofix', label: t('قابل‌چاپش کن', 'Make it printable') },
      penalty: 5,
    });
  }
  if (mesh.innerTooNarrow > 0) {
    issues.push({
      id: 'sanity-narrow',
      check: 'sanity',
      severity: 'error',
      message: t(
        'بدنه برای حالت پوسته با این ضخامت دیواره خیلی باریک است.',
        'Body is too narrow for a shell with this wall thickness.',
      ),
      fix: {
        kind: 'patch',
        label: t('حالت گلدان', 'Use vase mode'),
        changes: [{ path: 'print.outputMode', value: 'solidVase' }],
      },
      penalty: 20,
    });
  }
  const m = checkManifold(mesh);
  if (!m.manifold) {
    issues.push({
      id: 'sanity-manifold',
      check: 'sanity',
      severity: 'error',
      message: t(
        `مش بسته نیست (${m.badEdges + m.flippedEdges} یال مشکل‌دار).`,
        `Mesh is not manifold (${m.badEdges + m.flippedEdges} bad edges).`,
      ),
      penalty: 40,
    });
  }
  if (mesh.triangleCount > TRIANGLE_BUDGET) {
    issues.push({
      id: 'sanity-budget',
      check: 'sanity',
      severity: 'error',
      message: t(
        'تعداد مثلث‌ها بیش از ۲ میلیون است؛ کیفیت خروجی را کم کنید.',
        'More than 2 M triangles; lower the export quality.',
      ),
      fix: {
        kind: 'patch',
        label: t('کیفیت زیاد', 'High quality'),
        changes: [{ path: 'render.exportQuality', value: 'high' }],
      },
      penalty: 20,
    });
  }
  return { issues, manifold: m.manifold };
}

export function adviceForUseCase(p: VaseParams): Issue[] {
  const u = p.print.useCase;
  const issues: Issue[] = [];
  if (u === 'freshFlowers') {
    issues.push({
      id: 'usecase-water',
      check: 'useCase',
      severity: 'info',
      message: t(
        'برای آب: PETG، پهنای خط ۰.۸ و فلو ۱۰۳–۱۰۵٪، یا حالت پوسته با ۳–۴ دیواره، یا یک لیوان شیشه‌ای داخل گلدان.',
        'For water: PETG, 0.8 mm line width and 103–105 % flow, or shell with 3–4 walls, or an inner glass.',
      ),
      fix:
        p.print.material !== 'PETG'
          ? {
              kind: 'patch',
              label: t('PETG و خط ۰.۸', 'PETG + 0.8 mm lines'),
              changes: [
                { path: 'print.material', value: 'PETG' },
                { path: 'print.lineWidth', value: 0.8 },
              ],
            }
          : undefined,
      penalty: 0,
    });
  }
  if (u === 'outdoorPlanter' && p.base.drainageHole <= 0) {
    issues.push({
      id: 'usecase-drainage',
      check: 'useCase',
      severity: 'warn',
      message: t(
        'گلدان فضای باز به سوراخ زهکشی نیاز دارد (فاز ۲).',
        'Outdoor planters need a drainage hole (Phase 2).',
      ),
      penalty: 5,
    });
  }
  if (u === 'outdoorPlanter' && (p.print.material === 'PLA' || p.print.material === 'silkPLA')) {
    issues.push({
      id: 'usecase-uv',
      check: 'useCase',
      severity: 'info',
      message: t('برای فضای باز ASA یا PETG مقاوم‌تر از PLA است.', 'ASA or PETG outlasts PLA outdoors.'),
      fix: { kind: 'patch', label: t('ASA', 'Use ASA'), changes: [{ path: 'print.material', value: 'ASA' }] },
      penalty: 0,
    });
  }
  if (u.endsWith('Planter') && p.print.outputMode !== 'shell') {
    issues.push({
      id: 'usecase-planter-shell',
      check: 'useCase',
      severity: 'info',
      message: t('گلدان گیاه در حالت پوسته محکم‌تر است.', 'Planters are sturdier in shell mode.'),
      fix: { kind: 'patch', label: t('پوسته', 'Shell'), changes: [{ path: 'print.outputMode', value: 'shell' }] },
      penalty: 0,
    });
  }
  return issues;
}
