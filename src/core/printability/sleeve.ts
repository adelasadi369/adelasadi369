import type { VaseMesh } from '../geometry/mesh';
import { MATERIAL_DATA, PRINTER_FLOW } from '../materials';
import type { I18nText, VaseParams } from '../params/schema';
import type { SleeveBuild } from '../sleeve';
import { boreIssues, type BoreMeasure } from './bore';
import { boundsIssues, overhangIssues } from './checks';
import { bbox } from './geometryStats';
import { analyzeOverhang } from './overhang';
import { scoreOf } from './score';
import type { FixAction, Issue, ParamChange, Report, Stats } from './types';

const t = (fa: string, en: string): I18nText => ({ fa, en });
const f1 = (x: number) => x.toFixed(1);

/** Half-width of the teardrop-tip zone: the meshed tip is rounded by about 1.5 voxels or the edge rounding + 1.5 mm. */
export const tipZone = (voxel: number, k: number) => Math.max(1.5 * voxel, k + 1.5);
const f2 = (x: number) => x.toFixed(2);
const ORDER = { error: 0, warn: 1, info: 2 } as const;
/** Bore contact below this share warns (the tube is held by too little wall). */
export const BORE_CONTACT_MIN = 0.4;

/**
 * Bore accuracy of a sleeve, measured between ribs: only where the S1 profile has no rib, groove or chamfer offset
 * (radiusAt = R_bore exactly). Deviation = max |ρ − R| over those snapped bore vertices; sag = how far the flat bore
 * triangles whose three vertices are all plain dip inside R (centroid and edge midpoints), since the tube touches
 * the facets, not the vertices. Facets touching a rib belong to the rib, facets near a hole edge to the hole.
 */
export function measureSleeveBore(b: SleeveBuild): BoreMeasure & { samples: number } {
  const { mesh, sdf } = b;
  const { prof, R, H } = sdf;
  const P = mesh.positions;
  const I = mesh.indices;
  const isBore = new Uint8Array(mesh.vertexCount);
  // facets on hole edges belong to the hole, not to the bore wall
  const hm = sdf.holes;
  const margin = hm ? hm.k + 1.5 * mesh.sleeve.voxel : 0;
  const plain = (x: number, y: number, z: number) => {
    const phi = Math.atan2(y, x);
    return prof.radiusAt(phi, z, H) === R && (!hm || hm.at(phi, z) > margin);
  };
  let deviation = 0;
  let sag = 0;
  let samples = 0;
  for (const v of mesh.sleeve.boreVertices) {
    const x = P[v * 3];
    const y = P[v * 3 + 1];
    if (!plain(x, y, P[v * 3 + 2])) continue;
    isBore[v] = 1;
    deviation = Math.max(deviation, Math.abs(Math.sqrt(x * x + y * y) - R));
    samples++;
  }
  const probe = (x: number, y: number, z: number) => {
    if (plain(x, y, z)) sag = Math.max(sag, R - Math.sqrt(x * x + y * y));
  };
  for (let k = 0; k < mesh.triangleCount; k++) {
    const a = I[k * 3];
    const c = I[k * 3 + 1];
    const d = I[k * 3 + 2];
    if (!isBore[a] || !isBore[c] || !isBore[d]) continue;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2]; // prettier-ignore
    const bx = P[c * 3], by = P[c * 3 + 1], bz = P[c * 3 + 2]; // prettier-ignore
    const cx = P[d * 3], cy = P[d * 3 + 1], cz = P[d * 3 + 2]; // prettier-ignore
    probe((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    probe((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    probe((bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2);
    probe((cx + ax) / 2, (cy + ay) / 2, (cz + az) / 2);
  }
  return { deviation, sag: Math.max(0, sag), samples };
}

/**
 * Thinnest wall: from a subset of vertices march inward along −n through the SDF until leaving the material.
 * Returns the thinnest wall and the height where it occurs, ignoring the thinnest 0.5 % of samples: the folds of a
 * thin draped shell (S4) leave isolated sub-millimetre pockets where a vertex normal skims the shell, which a slicer
 * fills or skips; a real thin region (e.g. a bare 1.2 mm core tube) covers far more samples.
 */
export function minWall(b: SleeveBuild, maxSamples = 3000): { thickness: number; z: number } {
  const { mesh, sdf } = b;
  const P = mesh.positions;
  const N = mesh.normals;
  const skip = new Uint8Array(mesh.vertexCount);
  for (const v of mesh.sleeve.baseVertices) skip[v] = 1;
  const stride = Math.max(1, Math.ceil(mesh.vertexCount / maxSamples));
  const voxel = mesh.sleeve.voxel;
  const found: { s: number; z: number }[] = [];
  for (let v = 0; v < mesh.vertexCount; v += stride) {
    if (skip[v]) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; // prettier-ignore
    const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2]; // prettier-ignore
    // smoothed vertices sit within a fraction of a voxel of the zero set: first enter the material, then measure
    let s = 0;
    let entry = -1;
    for (let it = 0; it < 400 && s < 40; it++) {
      const d = sdf.at(x - nx * s, y - ny * s, z - nz * s);
      if (entry < 0) {
        if (d < 0) entry = s;
        else if (s > 1.5 * voxel) break;
        s += Math.max(d * 0.9, 0.02);
      } else {
        if (d > 0) break;
        s += Math.max(-d * 0.9, 0.02);
      }
    }
    if (entry < 0) continue;
    found.push({ s: s - entry, z });
  }
  if (!found.length) return { thickness: Infinity, z: 0 };
  found.sort((a, c) => a.s - c.s);
  const pick = found[Math.floor(found.length * 0.005)];
  return { thickness: pick.s, z: pick.z };
}

export function sleeveStats(
  mesh: VaseMesh,
  p: VaseParams,
  volume: number,
  boreDiameter: number,
  boreContact?: number,
): Stats {
  const bb = bbox(mesh);
  const P = mesh.positions;
  const I = mesh.indices;
  let area = 0;
  for (let k = 0; k < mesh.triangleCount; k++) {
    const a = I[k * 3] * 3, c = I[k * 3 + 1] * 3, d = I[k * 3 + 2] * 3; // prettier-ignore
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2]; // prettier-ignore
    const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2]; // prettier-ignore
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; // prettier-ignore
    area += Math.sqrt(x * x + y * y + z * z) / 2;
  }
  const mat = MATERIAL_DATA[p.print.material];
  const flow = Math.min(mat.maxFlow, PRINTER_FLOW[p.print.printer.preset]) * 0.75;
  const seconds = volume / flow + (mesh.height / p.print.layerHeight) * 0.4 + 180;
  return {
    height: mesh.height,
    maxDiameter: Math.max(bb.sx, bb.sy),
    bboxX: bb.sx,
    bboxY: bb.sy,
    // the tube holds the water, not the sleeve
    capacityMl: 0,
    materialCm3: volume / 1000,
    weightG: (volume / 1000) * mat.density,
    printMinutes: seconds / 60,
    surfaceCm2: area / 100,
    triangles: mesh.triangleCount,
    stlBytes: 84 + 50 * mesh.triangleCount,
    boreDiameter,
    ...(boreContact !== undefined && { boreContact }),
  };
}

const patch = (label: I18nText, changes: ParamChange[]): FixAction => ({ kind: 'patch', label, changes });

/** One-click fixes for hole problems (sleeve-integration §7): less coverage, smaller holes, wider bridges. */
function holeFixes(p: VaseParams) {
  const h = p.sleeve.holes;
  return {
    lessCoverage: patch(t('سوراخ کمتر', 'Reduce coverage'), [
      { path: 'sleeve.holes.coverage', value: Math.max(0, Math.round(h.coverage - 5)) },
    ]),
    smaller: patch(t('سوراخ کوچک‌تر', 'Smaller holes'), [
      { path: 'sleeve.holes.size', value: Math.max(4, Math.round(h.size * 0.8 * 2) / 2) },
    ]),
    widerBridges: patch(t('پل پهن‌تر', 'Wider bridges'), [
      { path: 'sleeve.holes.minBridgeWidth', value: Math.min(15, Math.round((h.minBridgeWidth + 1) * 10) / 10) },
    ]),
    keepOut: patch(t('نوارهای تو‌پر پهن‌تر', 'Wider keep-out bands'), [
      { path: 'sleeve.holes.keepOutBottom', value: Math.min(60, h.keepOutBottom + 5) },
      { path: 'sleeve.holes.keepOutTop', value: Math.min(60, h.keepOutTop + 5) },
    ]),
  };
}

/** Printability for sleeve mode (docs/sleeve-integration.md §7), same issue/score framework as vases. */
export function analyzeSleeve(b: SleeveBuild, p: VaseParams): Report {
  const { mesh } = b;
  const s = mesh.sleeve;
  const maxDeg = p.print.maxOverhang;
  // the first voxel above the bed is the base seam; teardrop tips are short bridges (see tipZone)
  const hm = b.sdf.holes;
  const dTip = tipZone(s.voxel, hm?.k ?? 0);
  // drip bottoms and pointed finger tips are rounded tips too (strands.ts)
  const st = b.sdf.strands;
  const strandTip = st.list.length ? st.tip : null;
  const oh = analyzeOverhang(mesh, maxDeg, {
    bedSkip: s.voxel,
    soft: hm || strandTip ? (x, y, z) => !!(hm?.tip(Math.atan2(y, x), z, dTip) || strandTip?.(x, y, z)) : undefined,
  });
  // the bed is not an overhang
  for (const v of s.baseVertices) oh.vertex[v] = -1;
  const issues: Issue[] = [];

  // overhang: the auto-fix action runs the sleeve ablation (sleeveFix.ts); the self-supporting skin is a second fix
  const selfSup = patch(t('پوستهٔ خودنگه‌دار', 'Self-supporting skin'), [
    { path: 'sleeve.selfSupporting', value: true },
  ]);
  for (const i of overhangIssues(oh.summary, maxDeg))
    issues.push(i.severity !== 'info' && !p.sleeve.selfSupporting ? { ...i, fixes: [...(i.fixes ?? []), selfSup] } : i);

  const v = s.validity;
  if (!v.ok) {
    issues.push({
      id: 'sleeve-mesh',
      check: 'sanity',
      severity: 'error',
      message: t(
        `مش معتبر نیست (لبه‌های خراب ${v.badEdges}، رأس‌های خراب ${v.badVertices}، بدنه‌ها ${v.bodies}).`,
        `The mesh is not valid (bad edges ${v.badEdges}, bad vertices ${v.badVertices}, bodies ${v.bodies}).`,
      ),
      penalty: 40,
    });
  }
  if (s.retried) {
    issues.push({
      id: 'sleeve-retry',
      check: 'sanity',
      severity: 'info',
      message: t(
        'مش اول نامعتبر بود؛ با شبکهٔ جابه‌جاشده دوباره ساخته شد.',
        'The first mesh failed validation and was rebuilt on a shifted lattice.',
      ),
      penalty: 0,
    });
  }
  if (s.islands.removedFraction > 0.01) {
    issues.push({
      id: 'sleeve-islands',
      check: 'sanity',
      severity: 'warn',
      message: t(
        `${f1(100 * s.islands.removedFraction)}٪ حجم به‌صورت قطعه‌های جدا حذف شد؛ طرح قسمت معلق دارد.`,
        `${f1(100 * s.islands.removedFraction)}% of the volume was removed as floating parts.`,
      ),
      ...(s.holes && { fix: holeFixes(p).lessCoverage, fixes: [holeFixes(p).smaller, holeFixes(p).widerBridges] }),
      penalty: 8,
    });
  } else if (s.islands.components > 1) {
    issues.push({
      id: 'sleeve-islands-small',
      check: 'sanity',
      severity: 'info',
      message: t(
        `${s.islands.components - 1} قطعهٔ ریز جدا حذف شد (${f2(s.islands.removedVolume)} میلی‌متر مکعب).`,
        `${s.islands.components - 1} tiny loose part(s) removed (${f2(s.islands.removedVolume)} mm³).`,
      ),
      penalty: 0,
    });
  }

  const hs = s.holes;
  if (hs) {
    const fx = holeFixes(p);
    const H = mesh.height || 1;
    if (hs.thinBridges) {
      const [z0, z1] = hs.thinBridges;
      issues.push({
        id: 'sleeve-bridges',
        check: 'walls',
        severity: 'warn',
        heightRange: [Math.max(0, (100 * z0) / H - 1), Math.min(100, (100 * z1) / H + 1)],
        message: t(
          `باریک‌ترین پل بین سوراخ‌ها ${f1(hs.minBridge)} میلی‌متر است؛ کمینه ${f1(p.sleeve.holes.minBridgeWidth)}.`,
          `The thinnest bridge between holes is ${f1(hs.minBridge)} mm; the minimum is ${f1(p.sleeve.holes.minBridgeWidth)} mm.`,
        ),
        fix: fx.lessCoverage,
        fixes: [fx.smaller, fx.widerBridges],
        penalty: 6,
      });
    }
    if (hs.boreContact < BORE_CONTACT_MIN) {
      issues.push({
        id: 'sleeve-bore-contact',
        check: 'bore',
        severity: 'warn',
        message: t(
          `فقط ${f1(100 * hs.boreContact)}٪ دیوارهٔ حفره با لوله تماس دارد (کمینه ${100 * BORE_CONTACT_MIN}٪)؛ لوله لق می‌شود.`,
          `Only ${f1(100 * hs.boreContact)}% of the bore wall touches the tube (minimum ${100 * BORE_CONTACT_MIN}%); the tube will be loose.`,
        ),
        fix: fx.lessCoverage,
        fixes: [fx.keepOut],
        penalty: 6,
      });
    }
  }

  const wall = minWall(b);
  const limit = 2 * p.print.lineWidth;
  if (wall.thickness < limit) {
    const H = mesh.height || 1;
    const at = (100 * wall.z) / H;
    issues.push({
      id: 'sleeve-wall',
      check: 'walls',
      severity: 'warn',
      heightRange: [Math.max(0, at - 2), Math.min(100, at + 2)],
      message: t(
        `نازک‌ترین دیواره ${f2(wall.thickness)} میلی‌متر است؛ دست‌کم ${f2(limit)} (دو خط) لازم است.`,
        `The thinnest wall is ${f2(wall.thickness)} mm; at least ${f2(limit)} mm (two lines) is needed.`,
      ),
      penalty: 6,
    });
  }

  const bounds = boundsIssues({ mesh } as never, p);
  issues.push(...bounds.issues);
  issues.push(...boreIssues(b, p, () => measureSleeveBore(b)));
  issues.sort((a, c) => ORDER[a.severity] - ORDER[c.severity]);

  return {
    score: scoreOf(issues),
    issues,
    stats: sleeveStats(mesh, p, v.volume, 2 * b.sdf.R, hs?.boreContact),
    overhang: oh.summary,
    vertexOverhang: oh.vertex,
    manifold: v.ok,
  };
}
