import { buildFitTestRing, buildMesh } from '../geometry/mesh';
import { computeBore } from '../insert';
import type { Quality } from '../geometry/grid';
import type { VaseParams } from '../params/schema';
import { writeOBJ } from './obj';
import { writeSTL } from './stl';
import { write3MF } from './threeMF';
import { weld } from './weld';
import { writeZip } from './zip';

export type ExportFormat = 'stl' | 'obj' | '3mf' | 'json' | 'fitRing';

export interface ExportFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

const slug = (s: string) =>
  (s || 'vaseforge-vase')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-|-$/g, '') || 'vase';

export async function exportDesign(
  params: VaseParams,
  format: ExportFormat,
  quality: Quality = params.render.exportQuality,
): Promise<ExportFile> {
  const base = slug(params.name);
  if (format === 'json') {
    return {
      name: `${base}.json`,
      mime: 'application/json',
      data: new TextEncoder().encode(JSON.stringify(params, null, 2)),
    };
  }
  if (format === 'fitRing') {
    const ring = weld(buildFitTestRing(params, quality));
    const name = fitRingName(params);
    return { name: `${name}.stl`, mime: 'model/stl', data: new Uint8Array(writeSTL(ring, `VaseForge ${name}`)) };
  }
  const built = buildMesh(params, quality);
  const w = weld(built.mesh);
  const saucer = built.saucer ? weld(built.saucer) : null;
  const single = (m: typeof w, name: string) =>
    format === 'stl'
      ? { name: `${name}.stl`, data: new Uint8Array(writeSTL(m, `VaseForge ${name}`)) }
      : { name: `${name}.obj`, data: writeOBJ(m, name) };
  switch (format) {
    case 'stl':
    case 'obj': {
      const vase = single(w, base);
      if (!saucer) return { ...vase, mime: format === 'stl' ? 'model/stl' : 'text/plain' };
      // multi-body: one file per body + the params, zipped
      const zip = await writeZip([
        vase,
        single(saucer, `${base}-saucer`),
        { name: `${base}.json`, data: JSON.stringify(params, null, 2) },
      ]);
      return { name: `${base}.zip`, mime: 'application/zip', data: zip };
    }
    case '3mf': {
      const bodies = [{ name: base, ...w }];
      if (saucer) bodies.push({ name: `${base}-saucer`, ...placeBeside(w.positions, saucer) });
      return { name: `${base}.3mf`, mime: 'model/3mf', data: await write3MF(bodies, params) };
    }
  }
}

/** Shift the saucer along +X so it sits next to the vase on the plate (10 mm clearance). */
function placeBeside(vase: Float32Array, saucer: ReturnType<typeof weld>) {
  let vx = -Infinity;
  for (let i = 0; i < vase.length; i += 3) vx = Math.max(vx, vase[i]);
  let sx = Infinity;
  for (let i = 0; i < saucer.positions.length; i += 3) sx = Math.min(sx, saucer.positions[i]);
  const dx = vx - sx + 10;
  const positions = saucer.positions.slice();
  for (let i = 0; i < positions.length; i += 3) positions[i] += dx;
  return { ...saucer, positions };
}

/** e.g. fit-ring_D50.80_hc0.05: target bore Ø and the hole compensation the ring was printed with. */
export function fitRingName(params: VaseParams): string {
  const b = computeBore(params.insert, params.print.printer);
  const hc = b.holeCompensation.toFixed(3).replace(/(\.\d\d\d*?)0+$/, '$1');
  return `fit-ring_D${b.targetDiameter.toFixed(2)}_hc${hc}`;
}
