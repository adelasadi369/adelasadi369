/** Binary STL (little-endian). Facet normals recomputed from the winding. */
export function writeSTL(
  mesh: { positions: Float32Array; indices: Uint32Array; triangleCount: number },
  header = 'VaseForge',
): ArrayBuffer {
  const { positions: P, indices: I, triangleCount: n } = mesh;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const h = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(h);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = I[t * 3] * 3,
      b = I[t * 3 + 1] * 3,
      c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a],
      uy = P[b + 1] - P[a + 1],
      uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a],
      vy = P[c + 1] - P[a + 1],
      vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, P[v], true);
      dv.setFloat32(o + 4, P[v + 1], true);
      dv.setFloat32(o + 8, P[v + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** Parse binary STL into a flat triangle soup (for tests / roundtrip). */
export function readSTL(buf: ArrayBuffer): { triangles: Float32Array; normals: Float32Array; count: number } {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  if (buf.byteLength !== 84 + 50 * n) throw new Error('Not a binary STL');
  const tris = new Float32Array(n * 9);
  const nrm = new Float32Array(n * 3);
  let o = 84;
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) nrm[t * 3 + k] = dv.getFloat32(o + 4 * k, true);
    o += 12;
    for (let k = 0; k < 9; k++) tris[t * 9 + k] = dv.getFloat32(o + 4 * k, true);
    o += 38;
  }
  return { triangles: tris, normals: nrm, count: n };
}
