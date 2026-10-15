import { buildMesh } from '../geometry/mesh';
import type { Quality } from '../geometry/grid';
import type { VaseParams } from '../params/schema';
import { writeOBJ } from './obj';
import { writeSTL } from './stl';
import { write3MF } from './threeMF';
import { weld } from './weld';

export type ExportFormat = 'stl' | 'obj' | '3mf' | 'json';

export interface ExportFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

const slug = (s: string) => (s || 'vaseforge-vase').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-|-$/g, '') || 'vase';

export async function exportDesign(params: VaseParams, format: ExportFormat, quality: Quality = params.render.exportQuality): Promise<ExportFile> {
  const base = slug(params.name);
  if (format === 'json') {
    return { name: `${base}.json`, mime: 'application/json', data: new TextEncoder().encode(JSON.stringify(params, null, 2)) };
  }
  const w = weld(buildMesh(params, quality).mesh);
  switch (format) {
    case 'stl':
      return { name: `${base}.stl`, mime: 'model/stl', data: new Uint8Array(writeSTL(w, `VaseForge ${base}`)) };
    case 'obj':
      return { name: `${base}.obj`, mime: 'text/plain', data: writeOBJ(w, base) };
    case '3mf':
      return { name: `${base}.3mf`, mime: 'model/3mf', data: await write3MF([{ name: base, ...w }], params) };
  }
}
