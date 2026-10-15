import type { VaseMesh } from '../src/core/geometry/mesh';

/** Slice a welded mesh with the plane z = h. Returns loops (as point lists) and a star-shaped flag per loop. */
export function slice(mesh: Pick<VaseMesh, 'positions' | 'indices' | 'canonical' | 'triangleCount'>, h: number) {
  const { positions: P, indices: I, canonical: C } = mesh;
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const segs: [string, string][] = [];
  const pts = new Map<string, [number, number]>();
  for (let t = 0; t < mesh.triangleCount; t++) {
    const v = [C[I[t * 3]], C[I[t * 3 + 1]], C[I[t * 3 + 2]]];
    const z = v.map((x) => P[x * 3 + 2] - h);
    const cross: string[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const za = z[e], zb = z[(e + 1) % 3];
      if ((za < 0 && zb >= 0) || (za >= 0 && zb < 0)) {
        const k = key(a, b);
        const u = za / (za - zb);
        pts.set(k, [P[a * 3] + u * (P[b * 3] - P[a * 3]), P[a * 3 + 1] + u * (P[b * 3 + 1] - P[a * 3 + 1])]);
        cross.push(k);
      }
    }
    if (cross.length === 2) segs.push([cross[0], cross[1]]);
  }
  const adj = new Map<string, string[]>();
  for (const [a, b] of segs) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const seen = new Set<string>();
  const loops: [number, number][][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop: [number, number][] = [];
    let prev = '';
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(pts.get(cur)!);
      const next = adj.get(cur)!.find((n) => n !== prev && !seen.has(n)) ?? adj.get(cur)!.find((n) => n !== prev);
      prev = cur;
      if (!next) break;
      cur = next;
    }
    loops.push(loop);
  }
  const starShaped = loops.map((loop) => {
    const cx = loop.reduce((s, p) => s + p[0], 0) / loop.length;
    const cy = loop.reduce((s, p) => s + p[1], 0) / loop.length;
    let sign = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const c = (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
      if (Math.abs(c) < 1e-9) continue;
      const s = Math.sign(c);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  });
  return { loops, starShaped, segments: segs.length };
}

/** FNV-1a over the bytes of a typed array. */
export function hashBuffer(a: ArrayBufferView): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
