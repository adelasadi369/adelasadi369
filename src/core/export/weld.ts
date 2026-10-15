import type { VaseMesh } from '../geometry/mesh';

/** Compact welded vertex/index arrays (render-split duplicates removed). */
export function weld(mesh: Pick<VaseMesh, 'positions' | 'indices' | 'canonical' | 'vertexCount'>) {
  const { positions, indices, canonical, vertexCount } = mesh;
  const remap = new Int32Array(vertexCount).fill(-1);
  let n = 0;
  for (let v = 0; v < vertexCount; v++) if (canonical[v] === v) remap[v] = n++;
  const pos = new Float32Array(n * 3);
  for (let v = 0; v < vertexCount; v++) {
    const r = remap[v];
    if (r < 0) continue;
    pos[r * 3] = positions[v * 3];
    pos[r * 3 + 1] = positions[v * 3 + 1];
    pos[r * 3 + 2] = positions[v * 3 + 2];
  }
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) idx[i] = remap[canonical[indices[i]]];
  return { positions: pos, indices: idx, vertexCount: n, triangleCount: indices.length / 3 };
}
