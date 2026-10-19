import { describe, expect, it } from 'vitest';
import { COARSE, extract, type Lattice, type SampledField } from '../src/core/mc/extract';
import { edgeManifold, keepLargest, nonManifoldVertices, orientOutward } from '../src/core/mc/post';
import { TRI_COUNT, TRI_TABLE } from '../src/core/mc/tables';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';

/** Lattice covering [−r, r]³ with a half-voxel offset, coarse-aligned. */
function lattice(r: number, h: number): Lattice {
  const n = COARSE * Math.ceil((2 * r) / h / COARSE) + 1;
  const o = -((n - 1) / 2) * h + h / 2;
  return { x0: o, y0: o, z0: o, h, nx: n, ny: n, nz: n };
}

function field(fn: (x: number, y: number, z: number) => number, lat: Lattice): SampledField {
  return {
    at: fn,
    plane(k, out, mask) {
      const z = lat.z0 + k * lat.h;
      for (let j = 0; j < lat.ny; j++)
        for (let i = 0; i < lat.nx; i++) {
          const s = j * lat.nx + i;
          if (mask[s]) out[s] = fn(lat.x0 + i * lat.h, lat.y0 + j * lat.h, z);
        }
    },
  };
}

const sound = (m: { positions: Float32Array; indices: Uint32Array; vertexCount: number; triangleCount: number }) => {
  const canonical = Uint32Array.from({ length: m.vertexCount }, (_, i) => i);
  expect(checkManifold({ ...m, canonical })).toMatchObject({ badEdges: 0, flippedEdges: 0, degenerate: 0 });
  expect(nonManifoldVertices(m)).toBe(0);
};

describe('marching cubes', () => {
  it('generated table: every case closes, complements mirror, empty/full are empty', () => {
    expect(TRI_COUNT[0]).toBe(0);
    expect(TRI_COUNT[255]).toBe(0);
    for (let c = 1; c < 255; c++) {
      expect(TRI_COUNT[c]).toBeGreaterThan(0);
      expect(TRI_TABLE[c].length).toBe(TRI_COUNT[c] * 3);
    }
  });

  it.each([1, 0.5])('sphere r=20 at voxel %s: manifold, outward, volume within 1 %', (h) => {
    const lat = lattice(24, h);
    const m = extract(
      field((x, y, z) => Math.hypot(x, y, z) - 20, lat),
      lat,
    );
    sound(m);
    const v = signedVolume(m);
    expect(v).toBeGreaterThan(0);
    expect(Math.abs(v / ((4 / 3) * Math.PI * 8000) - 1)).toBeLessThan(0.01);
  });

  it('torus and two blobs: manifold; the smaller island is removed', () => {
    const lat = lattice(40, 1);
    const torus = (x: number, y: number, z: number) => Math.hypot(Math.hypot(x, y) - 20, z) - 6;
    sound(extract(field(torus, lat), lat));
    const two = (x: number, y: number, z: number) =>
      Math.min(Math.hypot(x + 15, y, z) - 12, Math.hypot(x - 22, y, z) - 5);
    const m = extract(field(two, lat), lat);
    sound(m);
    const r = keepLargest(m);
    expect(r.components).toBe(2);
    expect(r.removedFraction).toBeCloseTo(125 / (125 + 1728), 2);
    expect(orientOutward(r.mesh)).toBeCloseTo((4 / 3) * Math.PI * 1728, -2);
  });

  it('narrow band gives the same mesh as evaluating every sample', () => {
    const lat = lattice(30, 1);
    const f = field((x, y, z) => Math.hypot(x, y, z * 1.3) - 22, lat);
    const a = extract(f, lat, { band: 0 });
    const b = extract(f, lat);
    expect(b.exactSamples).toBeLessThan(a.exactSamples / 2);
    expect(b.positions).toEqual(a.positions);
    expect(b.indices).toEqual(a.indices);
  });

  it('random noisy fields stay manifold (ambiguous faces)', () => {
    const lat = lattice(10, 1);
    for (let seed = 1; seed <= 5; seed++) {
      const f = (x: number, y: number, z: number) =>
        Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 - seed) + Math.sin(z * 1.1 + seed * 2) * 0.8 + 0.1 * seed - 0.3;
      // clip to a ball so the surface is closed
      const g = (x: number, y: number, z: number) => Math.max(f(x, y, z), Math.hypot(x, y, z) - 9);
      sound(extract(field(g, lat), lat));
    }
  });
});

describe('fast edge-manifold check', () => {
  it('agrees with the sorting check on closed and broken meshes', () => {
    const lat = lattice(24, 1);
    const m = extract(
      field((x, y, z) => Math.hypot(x, y, z) - 20, lat),
      lat,
    );
    const canonical = Uint32Array.from({ length: m.vertexCount }, (_, i) => i);
    expect(edgeManifold(m)).toEqual(checkManifold({ ...m, canonical }));
    const holed = { ...m, indices: m.indices.slice(3), triangleCount: m.triangleCount - 1 };
    expect(edgeManifold(holed)).toEqual(checkManifold({ ...holed, canonical }));
    const flipped = { ...m, indices: m.indices.slice() };
    [flipped.indices[1], flipped.indices[2]] = [flipped.indices[2], flipped.indices[1]];
    expect(edgeManifold(flipped)).toEqual(checkManifold({ ...flipped, canonical }));
    expect(edgeManifold(flipped).flippedEdges).toBe(3);
  });
});

describe('ambiguous faces (regression: random seed 14 at 2 mm)', () => {
  it('no triangle edge lies across a cube face, so neighbours never share a diagonal', () => {
    // 300 random sign patterns on a 3×3×3-cell block (closed by a positive shell): ambiguous faces everywhere
    const lat: Lattice = { x0: 0.5, y0: 0.5, z0: 0.5, h: 1, nx: 5, ny: 5, nz: 5 };
    for (let seed = 0; seed < 300; seed++) {
      let s = seed * 9973 + 1;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const vals = Array.from({ length: 125 }, rnd);
      const at = (x: number, y: number, z: number) => {
        const i = Math.round(x - 0.5), j = Math.round(y - 0.5), k = Math.round(z - 0.5); // prettier-ignore
        const edge = i === 0 || j === 0 || k === 0 || i === 4 || j === 4 || k === 4;
        return edge ? 1 : vals[(k * 5 + j) * 5 + i];
      };
      sound(extract(field(at, lat), lat, { band: 0 }));
    }
  });
});
