import type { VaseMesh } from '../geometry/mesh';
import { MATERIAL_DATA, PRINTER_FLOW } from '../materials';
import type { I18nText, VaseParams } from '../params/schema';
import type { SleeveBuild } from '../sleeve';
import { boreIssues, type BoreMeasure } from './bore';
import { boundsIssues, overhangIssues } from './checks';
import { bbox } from './geometryStats';
import { analyzeOverhang } from './overhang';
import { scoreOf } from './score';
import type { Issue, Report, Stats } from './types';

const t = (fa: string, en: string): I18nText => ({ fa, en });
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const ORDER = { error: 0, warn: 1, info: 2 } as const;

/**
 * Bore accuracy of a sleeve, measured between ribs: only where the S1 profile has no rib, groove or chamfer offset
 * (radiusAt = R_bore exactly). Deviation = max |ρ − R| over those snapped bore vertices; sag = how far the flat bore
 * triangles whose three vertices are all plain dip inside R (centroid and edge midpoints), since the tube touches
 * the facets, not the vertices. Facets touching a rib belong to the rib.
 */
export function measureSleeveBore(b: SleeveBuild): BoreMeasure & { samples: number } {
  const { mesh, sdf } = b;
  const { prof, R, H } = sdf;
  const P = mesh.positions;
  const I = mesh.indices;
  const isBore = new Uint8Array(mesh.vertexCount);
  const plain = (x: number, y: number, z: number) => prof.radiusAt(Math.atan2(y, x), z, H) === R;
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
 * Returns the minimum and the height where it occurs.
 */
export function minWall(b: SleeveBuild, maxSamples = 3000): { thickness: number; z: number } {
  const { mesh, sdf } = b;
  const P = mesh.positions;
  const N = mesh.normals;
  const skip = new Uint8Array(mesh.vertexCount);
  for (const v of mesh.sleeve.baseVertices) skip[v] = 1;
  const stride = Math.max(1, Math.ceil(mesh.vertexCount / maxSamples));
  const voxel = mesh.sleeve.voxel;
  let best = Infinity;
  let bestZ = 0;
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
    s -= entry;
    if (s < best) {
      best = s;
      bestZ = z;
    }
  }
  return { thickness: best, z: bestZ };
}

export function sleeveStats(mesh: VaseMesh, p: VaseParams, volume: number, boreDiameter: number): Stats {
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
  };
}

/** Printability for sleeve mode (docs/sleeve-integration.md §7), same issue/score framework as vases. */
export function analyzeSleeve(b: SleeveBuild, p: VaseParams): Report {
  const { mesh } = b;
  const s = mesh.sleeve;
  const maxDeg = p.print.maxOverhang;
  const oh = analyzeOverhang(mesh, maxDeg);
  // the bed is not an overhang
  for (const v of s.baseVertices) oh.vertex[v] = -1;
  const issues: Issue[] = [];

  // overhang (sleeve auto-fix arrives in S3, so no autofix action yet)
  for (const i of overhangIssues(oh.summary, maxDeg)) issues.push({ ...i, fix: undefined });

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
    stats: sleeveStats(mesh, p, v.volume, 2 * b.sdf.R),
    overhang: oh.summary,
    vertexOverhang: oh.vertex,
    manifold: v.ok,
  };
}
