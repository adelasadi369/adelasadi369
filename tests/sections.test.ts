import { describe, expect, it } from 'vitest';
import { buildMesh } from '../src/core/geometry/mesh';
import { makeSection } from '../src/core/geometry/sections';
import { polylinesToPolar, type Pt } from '../src/core/geometry/svgPolar';
import { SectionSchema, VaseParamsSchema, type VaseParamsInput } from '../src/core/params/schema';
import { checkManifold } from '../src/core/printability/sanity';
import { slice } from './helpers';

const ngon = (n: number, r = 50, cx = 10, cy = -5): Pt[] =>
  Array.from({ length: n }, (_, i) => [
    cx + r * Math.cos((2 * Math.PI * i) / n),
    cy + r * Math.sin((2 * Math.PI * i) / n),
  ]);

describe('SVG → polar', () => {
  it('accepts a star-shaped outline and normalises max to 1', () => {
    const star: Pt[] = Array.from({ length: 16 }, (_, i) => {
      const r = i % 2 ? 30 : 50;
      const a = (Math.PI * i) / 8;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const res = polylinesToPolar([star, ngon(5, 5)]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.samples).toHaveLength(720);
      expect(Math.max(...res.samples)).toBeCloseTo(1, 6);
      expect(Math.min(...res.samples)).toBeGreaterThan(0.55);
    }
  });

  it('rejects a C-shape (not star-shaped) with a clear message', () => {
    const c: Pt[] = [];
    for (let i = 0; i <= 40; i++) c.push([50 * Math.cos(0.4 + (i / 40) * 5.5), 50 * Math.sin(0.4 + (i / 40) * 5.5)]);
    for (let i = 40; i >= 0; i--) c.push([30 * Math.cos(0.4 + (i / 40) * 5.5), 30 * Math.sin(0.4 + (i / 40) * 5.5)]);
    const res = polylinesToPolar([c]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('notStarShaped');
      expect(res.message.fa.length).toBeGreaterThan(10);
    }
  });

  it('rejects empty input', () => {
    expect(polylinesToPolar([]).ok).toBe(false);
  });
});

describe('section shapes', () => {
  it.each(['supershape', 'custom', 'svg'] as const)('%s evaluates with max ≈ 1', (shape) => {
    const sec = SectionSchema.parse({
      shape,
      svg: { samples: Array.from({ length: 64 }, (_, i) => 0.7 + 0.3 * Math.abs(Math.cos(i / 4))) },
    });
    const f = makeSection(sec);
    let mx = 0;
    let mn = 9;
    for (let i = 0; i < 2048; i++) {
      const v = f((2 * Math.PI * i) / 2048, 0);
      mx = Math.max(mx, v);
      mn = Math.min(mn, v);
    }
    expect(mx).toBeGreaterThan(0.98);
    expect(mx).toBeLessThanOrEqual(1.0001);
    expect(mn).toBeGreaterThan(0);
  });

  it('custom windmill repeats with rotational symmetry k', () => {
    const f = makeSection(SectionSchema.parse({ shape: 'custom', custom: { symmetry: 5 } }));
    for (const th of [0.1, 0.9, 2.2]) expect(f(th, 0)).toBeCloseTo(f(th + (2 * Math.PI) / 5, 0), 6);
  });
});

describe('morph', () => {
  const morph: VaseParamsInput = {
    section: {
      morphEnabled: true,
      bottom: { shape: 'supershape', supershape: { m: 5, n1: 2, n2: 7, n3: 7 } },
      top: { shape: 'circle' },
      morphEasing: 'easeInOut',
      rotationTop: 20,
    },
  };

  it('blends bottom → top, keeps R(t) as the true max radius, stays manifold', () => {
    const p = VaseParamsSchema.parse(morph);
    const { mesh, field } = buildMesh(p, 'low');
    expect(checkManifold(mesh).manifold).toBe(true);
    const n = mesh.nTheta;
    const P = mesh.positions;
    const ringR = (j: number) => {
      let mx = 0;
      let mn = Infinity;
      for (let i = 0; i < n; i++) {
        const r = Math.hypot(P[(j * n + i) * 3], P[(j * n + i) * 3 + 1]);
        mx = Math.max(mx, r);
        mn = Math.min(mn, r);
      }
      return { mx, mn };
    };
    const mid = Math.floor(mesh.nZ / 2);
    const z = mesh.rows[mid];
    expect(ringR(mid).mx).toBeCloseTo(field.profile.R(z / p.dimensions.height), 0);
    // top is a circle (minus flare/round effects): min ≈ max
    const top = ringR(mesh.nZ - 1);
    expect(top.mx - top.mn).toBeLessThan(0.05);
    // bottom is lobed
    const bot = ringR(2);
    expect(bot.mx - bot.mn).toBeGreaterThan(5);
    for (let k = 1; k < 10; k++) expect(slice(mesh, (p.dimensions.height * k) / 10 + 0.01).loops).toHaveLength(1);
  });
});
