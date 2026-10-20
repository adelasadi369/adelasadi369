import { computeBore } from '../insert';
import { normalizeParams } from '../params/normalize';
import type { VaseParams } from '../params/schema';
import { analyze } from '../printability';
import { measureSleeveBore } from '../printability/sleeve';
import type { SleeveBuild, SleeveOptions } from '../sleeve';
import { sleeveExportMesh, slug, type ExportFile } from './index';
import { recommendedSettings } from './slicerSettings';
import { writeSTL } from './stl';
import { write3MF } from './threeMF';
import { writeZip } from './zip';

export { parseOdList } from './odList';

/**
 * The same design around another tube: insert.od changes and the skin scales radially with R_bore
 * (k = R_bore(od) / R_bore(design)): every diameter, finger width and bend offset × k. The height, holes, rim and
 * effects stay in millimetres, so the look holds and every size keeps the same wall and bridge widths.
 */
export function paramsForOd(p: VaseParams, od: number): VaseParams {
  const r0 = computeBore(p.insert, p.print.printer).radius;
  const r1 = computeBore({ ...p.insert, od }, p.print.printer).radius;
  const k = r1 / r0;
  const d = p.dimensions;
  return normalizeParams({
    ...p,
    name: `${p.name || 'sleeve'} D${od}`,
    insert: { ...p.insert, od },
    dimensions: {
      ...d,
      baseDiameter: d.baseDiameter * k,
      topDiameter: d.topDiameter * k,
      maxDiameter: d.maxDiameter * k,
      neckDiameter: d.neckDiameter * k,
    },
    twist: { ...p.twist, bend: { ...p.twist.bend, offset: p.twist.bend.offset * k } },
    sleeve: { ...p.sleeve, fingers: { ...p.sleeve.fingers, width: p.sleeve.fingers.width * k } },
  });
}

const f2 = (x: number) => x.toFixed(2);

/** Plain-text print card (en + fa) for one exported size: fit, measured bore, weight, time, slicer settings. */
export function printCard(p: VaseParams, b: SleeveBuild): string {
  const bore = computeBore(p.insert, p.print.printer);
  const m = measureSleeveBore(b);
  const r = analyze(b, p, { manifold: false });
  const st = r.stats;
  const dec = b.mesh.sleeve.decimated;
  const lines = [
    `VaseForge sleeve print card — ${p.name || 'sleeve'}`,
    '',
    `Insert: ${p.insert.type}, OD ${f2(p.insert.od)} mm ± ${f2(p.insert.odTolerance / 2)}, fit ${p.insert.fit} (clearance ${f2(p.insert.clearance)} mm/side)`,
    `Bore target Ø ${f2(bore.targetDiameter)} mm; modelled Ø ${f2(bore.diameter)} mm (hole compensation ${f2(bore.holeCompensation)} mm/side)`,
    `Bore measured on this mesh: deviation ${m.deviation.toFixed(3)} mm, facet sag ${m.sag.toFixed(3)} mm (tolerance ±0.05)`,
    `Size: height ${f2(st.height)} mm, max Ø ${f2(st.maxDiameter)} mm; skin ${p.sleeve.skinThickness > 0 ? `${f2(p.sleeve.skinThickness)} mm draped shell` : 'solid'}`,
    `Material ${p.print.material}: ${st.weightG.toFixed(0)} g, about ${(st.printMinutes / 60).toFixed(1)} h`,
    `Mesh: ${b.mesh.triangleCount} triangles at ${f2(b.mesh.sleeve.voxel)} mm voxel${dec ? ` (decimated from ${dec.before})` : ''}; printability score ${r.score}`,
    '',
    'Slicer:',
    ...Object.entries(recommendedSettings(p)).map(([k, v]) => `  ${k} = ${v}`),
    '',
    `کارت چاپ غلاف — ${p.name || 'غلاف'}`,
    `لوله: ${p.insert.type}، قطر بیرونی ${f2(p.insert.od)} میلی‌متر، جاافتادن ${p.insert.fit}`,
    `قطر هدف حفره ${f2(bore.targetDiameter)} میلی‌متر؛ انحراف اندازه‌گیری‌شده ${m.deviation.toFixed(3)} میلی‌متر (مجاز ±۰٫۰۵)`,
    `وزن حدود ${st.weightG.toFixed(0)} گرم، زمان چاپ حدود ${(st.printMinutes / 60).toFixed(1)} ساعت`,
    '',
  ];
  return lines.join('\n');
}

/**
 * One design for several insert ODs → one ZIP: per size a folder `D<od>/` with the mesh (STL or 3MF, built at the
 * export voxel and decimated) and `print-card.txt`, plus the design JSON at the root.
 */
export async function exportBatch(
  params: VaseParams,
  ods: number[],
  format: 'stl' | '3mf',
  opts: SleeveOptions = {},
): Promise<ExportFile> {
  const base = slug(params.name);
  const files: { name: string; data: Uint8Array | string }[] = [];
  for (let i = 0; i < ods.length; i++) {
    const p = paramsForOd(params, ods[i]);
    const b = sleeveExportMesh(p, {
      signal: opts.signal,
      onProgress: (f) => opts.onProgress?.((i + Math.min(f, 0.999)) / ods.length),
    });
    const dir = `D${ods[i]}`;
    const name = `${base}-${dir}`;
    const m = b.mesh;
    files.push(
      format === 'stl'
        ? { name: `${dir}/${name}.stl`, data: new Uint8Array(writeSTL(m, `VaseForge ${name}`)) }
        : { name: `${dir}/${name}.3mf`, data: await write3MF([{ name, ...m }], p) },
    );
    files.push({ name: `${dir}/print-card.txt`, data: printCard(p, b) });
  }
  files.push({ name: `${base}.json`, data: JSON.stringify(params, null, 2) });
  opts.onProgress?.(1);
  return { name: `${base}-batch.zip`, mime: 'application/zip', data: await writeZip(files) };
}
