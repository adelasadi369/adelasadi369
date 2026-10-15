import { ByteWriter } from './bytes';

export function writeOBJ(
  mesh: { positions: Float32Array; indices: Uint32Array; vertexCount: number; triangleCount: number },
  name = 'vase',
): Uint8Array {
  const { positions: P, indices: I } = mesh;
  const w = new ByteWriter(mesh.vertexCount * 32 + mesh.triangleCount * 24 + 64);
  w.str(`# VaseForge\no ${name}\n`);
  for (let v = 0; v < mesh.vertexCount; v++) {
    w.str('v ');
    w.num(P[v * 3]);
    w.str(' ');
    w.num(P[v * 3 + 1]);
    w.str(' ');
    w.num(P[v * 3 + 2]);
    w.str('\n');
  }
  for (let t = 0; t < mesh.triangleCount; t++) {
    w.str('f ');
    w.int(I[t * 3] + 1);
    w.str(' ');
    w.int(I[t * 3 + 1] + 1);
    w.str(' ');
    w.int(I[t * 3 + 2] + 1);
    w.str('\n');
  }
  return w.bytes();
}
