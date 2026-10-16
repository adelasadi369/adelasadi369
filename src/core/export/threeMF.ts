import type { VaseParams } from '../params/schema';
import { ByteWriter } from './bytes';
import { recommendedSettings } from './slicerSettings';
import { writeZip } from './zip';

export interface Body {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function modelXml(bodies: Body[], params: VaseParams): Uint8Array {
  const meta = recommendedSettings(params);
  const w = new ByteWriter(
    Math.max(
      1 << 16,
      bodies.reduce((n, b) => n + b.vertexCount * 48 + b.triangleCount * 44, 0),
    ),
  );
  w.str('<?xml version="1.0" encoding="UTF-8"?>\n');
  w.str(
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:vf="https://vaseforge.app/3mf/2025">\n',
  );
  w.str(
    `<metadata name="Title">${esc(params.name || 'VaseForge vase')}</metadata>\n<metadata name="Application">VaseForge</metadata>\n`,
  );
  for (const [k, v] of Object.entries(meta)) w.str(`<metadata name="vf:${k}">${esc(String(v))}</metadata>\n`);
  w.str('<resources>\n');
  bodies.forEach((b, k) => {
    w.str(`<object id="${k + 1}" type="model" name="${esc(b.name)}"><mesh><vertices>\n`);
    const P = b.positions;
    for (let v = 0; v < b.vertexCount; v++) {
      w.str('<vertex x="');
      w.num(P[v * 3]);
      w.str('" y="');
      w.num(P[v * 3 + 1]);
      w.str('" z="');
      w.num(P[v * 3 + 2]);
      w.str('"/>\n');
    }
    w.str('</vertices><triangles>\n');
    const I = b.indices;
    for (let t = 0; t < b.triangleCount; t++) {
      w.str('<triangle v1="');
      w.int(I[t * 3]);
      w.str('" v2="');
      w.int(I[t * 3 + 1]);
      w.str('" v3="');
      w.int(I[t * 3 + 2]);
      w.str('"/>\n');
    }
    w.str('</triangles></mesh></object>\n');
  });
  w.str('</resources><build>');
  bodies.forEach((_, k) => w.str(`<item objectid="${k + 1}"/>`));
  w.str('</build></model>\n');
  return w.bytes();
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="json" ContentType="application/json"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** 3MF core package (mm units) with recommended slicer settings and the source params. */
export async function write3MF(bodies: Body[], params: VaseParams): Promise<Uint8Array> {
  return writeZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: modelXml(bodies, params) },
    { name: 'Metadata/vaseforge_params.json', data: JSON.stringify(params) },
  ]);
}
