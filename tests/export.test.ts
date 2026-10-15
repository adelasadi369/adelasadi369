import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { exportDesign } from '../src/core/export';
import { readSTL, writeSTL } from '../src/core/export/stl';
import { weld } from '../src/core/export/weld';
import { readZip } from '../src/core/export/zip';
import { checkManifold } from '../src/core/printability/sanity';
import { PRESETS } from '../src/presets';
import { hashBuffer } from './helpers';

const params = PRESETS[0].params;

describe('determinism', () => {
  it('same params + seed ⇒ identical mesh hash', () => {
    const p = { ...params, effects: [...params.effects, { type: 'noise' as const, id: 'n', enabled: true, start: 0, end: 100, fade: 5, amplitude: 1, scale: 20, octaves: 3, seed: 42 }] };
    const a = buildMesh(p, 'low').mesh;
    const b = buildMesh(structuredClone(p), 'low').mesh;
    expect(hashBuffer(a.positions)).toBe(hashBuffer(b.positions));
    expect(hashBuffer(a.indices)).toBe(hashBuffer(b.indices));
    const c = buildMesh({ ...p, effects: p.effects.map((e) => (e.type === 'noise' ? { ...e, seed: 43 } : e)) }, 'low').mesh;
    expect(hashBuffer(c.positions)).not.toBe(hashBuffer(a.positions));
  });
});

describe('STL', () => {
  it('roundtrips triangles and normals', () => {
    const w = weld(buildMesh(params, 'low').mesh);
    const buf = writeSTL(w);
    expect(buf.byteLength).toBe(84 + 50 * w.triangleCount);
    const r = readSTL(buf);
    expect(r.count).toBe(w.triangleCount);
    for (const t of [0, 7, w.triangleCount - 1]) {
      for (let k = 0; k < 3; k++) {
        const v = w.indices[t * 3 + k];
        for (let c = 0; c < 3; c++) expect(r.triangles[t * 9 + k * 3 + c]).toBe(w.positions[v * 3 + c]);
      }
      const n = r.normals.slice(t * 3, t * 3 + 3);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
    }
  });

  it('welded export is still manifold', () => {
    const w = weld(buildMesh({ ...params, print: { ...params.print, outputMode: 'shell' } }, 'low').mesh);
    const canonical = new Uint32Array(w.vertexCount).map((_, i) => i);
    expect(checkManifold({ ...w, canonical }).manifold).toBe(true);
  });
});

describe('3MF', () => {
  it('writes a valid package with mm units and slicer metadata', async () => {
    const f = await exportDesign({ ...params, render: { ...params.render, exportQuality: 'low' } }, '3mf');
    expect(f.name).toBe('japandi-ribbed.3mf');
    const files = await readZip(f.data);
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', 'Metadata/vaseforge_params.json', '[Content_Types].xml', '_rels/.rels']);
    const xml = new TextDecoder().decode(files['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('<metadata name="vf:spiral_mode">1</metadata>');
    const nTri = (xml.match(/<triangle /g) ?? []).length;
    expect(nTri).toBe(buildMesh(params, 'low').mesh.triangleCount);
    expect(JSON.parse(new TextDecoder().decode(files['Metadata/vaseforge_params.json'])).name).toBe('Japandi Ribbed');
  });
});
