import type { VaseMesh } from '../geometry/mesh';
import { BORE_TOLERANCE, boreProfile, computeBore, FIT_CLEARANCE, usesBore } from '../insert';
import { paramInfo } from '../params/meta';
import { getPath } from '../params/paths';
import type { I18nText, VaseParams } from '../params/schema';
import { surfaceOf } from './geometryStats';
import type { Issue, ParamChange } from './types';

const t = (fa: string, en: string): I18nText => ({ fa, en });
const f2 = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);
const DIAMETERS = [
  'dimensions.baseDiameter',
  'dimensions.topDiameter',
  'dimensions.maxDiameter',
  'dimensions.neckDiameter',
];

/**
 * Measured bore deviation from the mesh: every bore-wall vertex against the profile radius for its world angle and
 * height, plus the chord sag of the widest facet per ring (the tube touches the facets, not the vertices).
 */
export interface BoreMeasure {
  deviation: number;
  sag: number;
}

export function measureBore(b: { mesh: VaseMesh }, p: VaseParams): BoreMeasure {
  const { mesh } = b;
  const s = surfaceOf(mesh, 'inner');
  if (!s || !mesh.bore) return { deviation: Infinity, sag: Infinity };
  const prof = boreProfile(p, mesh.bore.zTop, p.dimensions.height);
  const P = mesh.positions;
  const R = mesh.bore.radius;
  let deviation = 0;
  let sag = 0;
  const phis: number[] = new Array(s.cols);
  for (let r = 0; r < s.rows; r++) {
    for (let i = 0; i < s.cols; i++) {
      const v = (s.firstVertex + r * s.cols + i) * 3;
      const x = P[v];
      const y = P[v + 1];
      const phi = Math.atan2(y, x);
      const zTop = P[(s.firstVertex + i) * 3 + 2];
      deviation = Math.max(deviation, Math.abs(Math.hypot(x, y) - prof.radiusAt(phi, P[v + 2], zTop)));
      phis[i] = phi;
    }
    const a = phis.slice().sort((u, w) => u - w);
    let gap = a[0] + 2 * Math.PI - a[a.length - 1];
    for (let i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1]);
    sag = Math.max(sag, R * (1 - Math.cos(gap / 2)));
  }
  return { deviation, sag };
}

/** Bore checks for the shell bore liner and sleeves: core wall, axis, accuracy, fit and tube length. */
export function boreIssues(
  b: { mesh: VaseMesh },
  p: VaseParams,
  measure: (b: { mesh: VaseMesh }, p: VaseParams) => BoreMeasure = measureBore,
): Issue[] {
  const issues: Issue[] = [];
  if (p.print.innerSurface === 'bore' && p.print.outputMode !== 'shell' && p.print.outputMode !== 'sleeve') {
    issues.push({
      id: 'bore-mode',
      check: 'bore',
      severity: 'info',
      message: t('حفرهٔ لوله فقط در حالت پوسته ساخته می‌شود.', 'The tube bore only applies in shell mode.'),
      fix: {
        kind: 'patch',
        label: t('تغییر به پوسته', 'Switch to shell'),
        changes: [{ path: 'print.outputMode', value: 'shell' }],
      },
      penalty: 0,
    });
  }
  const info = b.mesh.bore;
  if (!usesBore(p) || !info) return issues;
  const H = b.mesh.height || p.dimensions.height;
  const ins = p.insert;
  const bore = computeBore(ins, p.print.printer);

  if (info.thin) {
    // scale every outer diameter by the factor that restores the core wall (+1 % margin), rounded up to 0.5 mm
    const s = info.scaleNeeded * 1.01;
    const changes: ParamChange[] = DIAMETERS.map((path) => {
      const cur = getPath(p, path) as number;
      const max = paramInfo(path)!.meta.max!;
      return { path, value: Math.min(max, Math.ceil(cur * s * 2) / 2) };
    });
    issues.push({
      id: 'bore-wall',
      check: 'bore',
      severity: 'error',
      heightRange: [(100 * info.thin[0]) / H, (100 * info.thin[1]) / H],
      message: t(
        `دیوارهٔ دور حفره تا ${f2(Math.max(0, info.minWall))} میلی‌متر نازک می‌شود؛ حداقل ${f2(info.coreWall)} لازم است (شعاع بیرون < R حفره + دیواره).`,
        `The wall around the bore gets down to ${f2(Math.max(0, info.minWall))} mm; ${f2(info.coreWall)} mm is required (r_outer < R_bore + wall).`,
      ),
      fix: { kind: 'patch', label: t('بزرگ‌کردن شعاع‌های بدنه', 'Scale the body radii up'), changes },
      penalty: 30,
    });
  }

  if (info.offAxis > 0) {
    const offset = Math.sign(p.twist.bend.offset) * Math.floor(0.8 * bore.radius);
    issues.push({
      id: 'bore-axis',
      check: 'bore',
      severity: 'error',
      message: t(
        'خمش بدنه بیشتر از آن است که یک لولهٔ صاف از آن رد شود.',
        'The bend is too strong for a straight tube to pass through.',
      ),
      fix: {
        kind: 'patch',
        label: t('کاهش خمش', 'Reduce bend'),
        changes: [{ path: 'twist.bend.offset', value: offset }],
      },
      penalty: 30,
    });
  }

  const m = measure(b, p);
  const dev = Math.max(m.deviation, m.sag);
  if (dev > BORE_TOLERANCE) {
    issues.push({
      id: 'bore-accuracy',
      check: 'bore',
      severity: 'error',
      message: t(
        `دقت حفره ${f3(dev)} میلی‌متر است؛ حداکثر ±${BORE_TOLERANCE} مجاز است.`,
        `Bore accuracy is ${f3(dev)} mm; at most ±${BORE_TOLERANCE} mm is allowed.`,
      ),
      penalty: 25,
    });
  } else {
    issues.push({
      id: 'bore-ok',
      check: 'bore',
      severity: 'info',
      message: t(
        `حفره Ø ${f2(bore.diameter)} میلی‌متر (هدف ${f2(bore.targetDiameter)} + جبران ${f2(bore.holeCompensation)} در هر طرف)، انحراف ${f3(dev)} ✓`,
        `Bore Ø ${f2(bore.diameter)} mm (target ${f2(bore.targetDiameter)} + ${f2(bore.holeCompensation)} compensation per side), deviation ${f3(dev)} mm ✓`,
      ),
      penalty: 0,
    });
  }

  if (ins.fit === 'press' && ins.type === 'glass') {
    issues.push({
      id: 'insert-press-glass',
      check: 'bore',
      severity: 'warn',
      message: t('جاافتادن پرسی برای شیشه مناسب نیست؛ ممکن است بشکند.', 'A press fit is not for glass; it may crack.'),
      fix: {
        kind: 'patch',
        label: t('جاافتادن جذب', 'Snug fit'),
        changes: [
          { path: 'insert.fit', value: 'snug' },
          { path: 'insert.clearance', value: FIT_CLEARANCE.snug },
        ],
      },
      penalty: 8,
    });
  }

  const tubeTop = info.zBottom + ins.length;
  if (tubeTop < H - 0.5) {
    const height = Math.max(paramInfo('dimensions.height')!.meta.min!, Math.floor(tubeTop - ins.protrusion));
    issues.push({
      id: 'insert-short',
      check: 'bore',
      severity: 'warn',
      message: t(
        `لوله ${f2(H - tubeTop)} میلی‌متر پایین‌تر از لبه تمام می‌شود.`,
        `The tube ends ${f2(H - tubeTop)} mm below the rim.`,
      ),
      fix: {
        kind: 'patch',
        label: t(`ارتفاع ← ${height}`, `Height → ${height} mm`),
        changes: [{ path: 'dimensions.height', value: height }],
      },
      penalty: 4,
    });
  }
  return issues;
}
