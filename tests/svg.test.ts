import { describe, expect, it } from 'vitest';
import { aiMayWrite, applyProposal, applyRefine } from '../src/ai/apply';
import { polylinesToPolar, type Pt } from '../src/core/geometry/svgPolar';
import { decodeShapes, encodeShapes, fnv1a, SHAPE_MAX_POINTS } from '../src/core/motif/blob';
import { buildMotifMap } from '../src/core/motif/map';
import { polylinesToProfile } from '../src/core/motif/silhouette';
import { normalizeParams } from '../src/core/params/normalize';
import type { VaseParamsInput } from '../src/core/params/schema';
import { analyze, buildDesign } from '../src/core/printability';
import { checkManifold } from '../src/core/printability/sanity';
import { buildSleeveMesh } from '../src/core/sleeve';
import { PRESETS } from '../src/presets';
import { parseSvg, parseTransform } from '../src/svg/parse';
import { hashBuffer } from './helpers';
import { expectSoundSleeve } from './sleeveHelpers';

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const pts = (s: string) => parseSvg(svg(s)).polylines;
const last = (p: number[]) => [p[p.length - 2], p[p.length - 1]];
const STAR = 'M50 5 L61 39 L97 39 L68 61 L79 95 L50 74 L21 95 L32 61 L3 39 L39 39 Z';

describe('SVG parser (data only)', () => {
  it('reads every path command, absolute and relative', () => {
    const [a] = pts('<path d="M10 10 L20 10 H30 V20 l-5 5 h-5 v-5 Z"/>');
    expect(a.closed).toBe(true);
    expect(a.pts.slice(0, 4)).toEqual([10, 10, 20, 10]);
    expect(a.pts).toEqual([10, 10, 20, 10, 30, 10, 30, 20, 25, 25, 20, 25, 20, 20]);
    // curves end on their endpoints; S / T reflect the previous control point
    const [c] = pts(
      '<path d="M0 0 C10 0 20 10 20 20 S30 40 40 40 Q50 40 50 50 T60 70 c1 1 2 2 3 3 s1 1 2 2 q1 1 2 0 t2 0"/>',
    );
    const P = c.pts;
    const has = (x: number, y: number) => {
      for (let k = 0; k < P.length; k += 2) if (Math.abs(P[k] - x) < 1e-9 && Math.abs(P[k + 1] - y) < 1e-9) return true;
      return false;
    };
    for (const [x, y] of [[20, 20], [40, 40], [50, 50], [60, 70], [63, 73], [65, 75], [67, 75]]) expect(has(x, y)).toBe(true); // prettier-ignore
    expect(last(P)).toEqual([69, 75]);
    // implicit lineto after moveto, and number lists without separators
    const [d] = pts('<path d="m5,5 10,0 0,10-10,0z"/>');
    expect(d.pts).toEqual([5, 5, 15, 5, 15, 15, 5, 15]);
  });

  it('arcs: endpoint parameterisation, compact flags, both sweeps, radii scaled up when too small', () => {
    const [c] = pts('<path d="M60 50 A10 10 0 0 1 40 50 A10 10 0 0 1 60 50 Z"/>');
    for (let k = 0; k < c.pts.length; k += 2) expect(Math.hypot(c.pts[k] - 50, c.pts[k + 1] - 50)).toBeCloseTo(10, 6);
    // "a1 1 0 01 5 5": flags written together with the next number
    const [f] = pts('<path d="M0 0 a5 5 0 01 10 0"/>');
    expect(last(f.pts)[0]).toBeCloseTo(10, 9);
    expect(Math.min(...f.pts.filter((_, k) => k % 2 === 1))).toBeCloseTo(-5, 1);
    const [g] = pts('<path d="M0 0 a5 5 0 0 0 10 0"/>');
    expect(Math.max(...g.pts.filter((_, k) => k % 2 === 1))).toBeCloseTo(5, 1);
    // radius 1 cannot span 10 units: scaled to 5 (SVG F.6.6)
    const [h] = pts('<path d="M0 0 A1 1 0 0 1 10 0"/>');
    expect(Math.min(...h.pts.filter((_, k) => k % 2 === 1))).toBeCloseTo(-5, 1);
  });

  it('transforms compose down the tree: translate, scale, rotate about a point, skew, matrix', () => {
    // (0, 0) → matrix (3, 4) → rotate 90° about (1, 1): (−2, 3) → scale 2: (−4, 6) → translate: (6, 26)
    const m = parseTransform('translate(10 20) scale(2) rotate(90 1 1) matrix(1 0 0 1 3 4)');
    expect(m[4]).toBeCloseTo(6, 9);
    expect(m[5]).toBeCloseTo(26, 9);
    const [p] = pts(
      '<g transform="translate(10 20)"><g transform="scale(2)"><path transform="rotate(90 1 1)" d="M3 4 L4 4"/></g></g>',
    );
    expect(p.pts[0]).toBeCloseTo(6, 9);
    expect(p.pts[1]).toBeCloseTo(26, 9);
    const [s] = pts('<path transform="skewX(45)" d="M0 10 L1 10"/>');
    expect(s.pts[0]).toBeCloseTo(10, 9);
  });

  it('basic shapes: polygon, polyline, rect (rounded), circle, ellipse, line', () => {
    const r = pts(
      '<polygon points="0,0 10,0 10,10"/><polyline points="0 0 5 5 10 0"/><rect x="0" y="0" width="20" height="10" rx="2"/><circle cx="5" cy="5" r="5"/><ellipse cx="0" cy="0" rx="4" ry="2"/><line x1="0" y1="0" x2="3" y2="4"/>',
    );
    expect(r.map((p) => p.closed)).toEqual([true, false, true, true, true, false]);
    const rect = r[2].pts;
    expect(Math.max(...rect.filter((_, k) => k % 2 === 0))).toBeCloseTo(20, 9);
    for (let k = 0; k < r[3].pts.length; k += 2)
      expect(Math.hypot(r[3].pts[k] - 5, r[3].pts[k + 1] - 5)).toBeCloseTo(5, 6);
    expect(r[5].pts).toEqual([0, 0, 3, 4]);
  });

  it('sanitises: scripts, foreignObject, images, use, defs, styles and hidden elements never become geometry', () => {
    const text = svg(`
      <!-- <path d="M0 0 L9 9"/> -->
      <script><![CDATA[ document.write('<path d="M0 0 L5 5"/>') ]]></script>
      <script>alert(1)</script>
      <style>path { display: none }</style>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><svg><path d="M1 1 L2 2"/></svg></div></foreignObject>
      <image href="https://example.com/x.png" width="10" height="10"/>
      <defs><path id="p" d="M0 0 L1 1"/></defs>
      <use href="#p"/><use href="https://evil.example/a.svg#x"/>
      <path d="M0 0 L1 0 L1 1 Z" onload="alert(1)" style="fill:url(https://evil.example)"/>
      <path display="none" d="M0 0 L3 3"/>`);
    const r = parseSvg(text);
    expect(r.polylines).toHaveLength(1);
    expect(r.polylines[0].pts).toEqual([0, 0, 1, 0, 1, 1]);
    expect(r.dropped).toMatchObject({ script: 2, style: 1, foreignObject: 1, image: 1, defs: 1, use: 2 });
  });

  it('caps the point count by simplifying (Douglas–Peucker), keeping the outline', () => {
    const many = Array.from({ length: 3000 }, (_, k) => {
      const a = (k / 3000) * 2 * Math.PI;
      return `${50 + 40 * Math.cos(a)},${50 + 40 * Math.sin(a)}`;
    }).join(' ');
    const r = parseSvg(svg(`<polygon points="${many}"/>`), { maxPoints: 300 });
    expect(r.points).toBeLessThanOrEqual(300);
    for (let k = 0; k < r.polylines[0].pts.length; k += 2)
      expect(Math.hypot(r.polylines[0].pts[k] - 50, r.polylines[0].pts[k + 1] - 50)).toBeCloseTo(40, 6);
  });

  it('never throws on malformed input', () => {
    for (const bad of ['', 'not svg', '<svg><path d="M 1"/></svg>', '<svg><path d="L5 5 Q"/>', '<svg><g><g>']) {
      expect(() => parseSvg(bad)).not.toThrow();
    }
  });
});

describe('shape blob (params storage)', () => {
  it('round-trips within the quantisation, normalised with y up; hash is content-based', () => {
    const r = parseSvg(svg(`<path d="${STAR}"/>`));
    const e = encodeShapes(r.polylines);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.hash).toBe(fnv1a(e.data));
    expect(encodeShapes(r.polylines)).toEqual(e);
    const d = decodeShapes(e.data);
    expect(d.shapes).toHaveLength(1);
    expect(d.points).toBe(10);
    expect(Math.max(d.w, d.h)).toBe(1);
    // the top point of the star (SVG y = 5) is the highest after the flip
    const ys = Array.from(d.shapes[0].pts.filter((_, k) => k % 2 === 1));
    expect(ys[0]).toBeCloseTo(d.h, 3);
  });

  it('refuses empty input and more than the point cap; decodes garbage to an empty set', () => {
    expect(encodeShapes([]).ok).toBe(false);
    const big = { closed: true, pts: Array.from({ length: 2 * (SHAPE_MAX_POINTS + 10) }, (_, k) => (k * 7919) % 1000) };
    expect(encodeShapes([big])).toMatchObject({ ok: false, reason: 'tooManyPoints' });
    expect(decodeShapes('%%%not-a-blob').shapes).toEqual([]);
  });
});

describe('cross-section and silhouette from SVG', () => {
  it('a hooked outline (not star-shaped) falls back to its outer envelope with a warning; a picked centre works', () => {
    const hook: Pt[] = [[-50, -50], [50, -50], [50, 50], [25, 50], [25, 10], [-10, 10], [-10, 15], [20, 15], [20, 50], [-50, 50]]; // prettier-ignore
    const r = polylinesToPolar([hook]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warning?.en).toContain('outer envelope');
    expect(r.samples).toHaveLength(720);
    const sq: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]]; // prettier-ignore
    const a = polylinesToPolar([sq]);
    const b = polylinesToPolar([sq], 720, [2, 2]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.warning).toBeUndefined();
      expect(b.samples).not.toEqual(a.samples);
    }
    expect(polylinesToPolar([sq], 720, [30, 30]).ok).toBe(false);
  });

  it('silhouette: a closed vase outline and an open half profile give the same r(t)', () => {
    // a bulb: wide at 30 % height, narrow neck (SVG y down: base at y = 100)
    const half = (k: number) => {
      const t = k / 40;
      return [10 + 30 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - 0.6 * t) + 8, 100 - 100 * t];
    };
    const open = Array.from({ length: 41 }, (_, k) => half(k)).flat();
    const closed = [...open.map((v, k) => (k % 2 === 0 ? 50 + v : v))];
    for (let k = 40; k >= 0; k--) closed.push(50 - half(k)[0], half(k)[1]);
    const a = polylinesToProfile([{ pts: open.map((v, k) => (k % 2 === 0 ? v : v)), closed: false }]);
    const b = polylinesToProfile([{ pts: closed, closed: true }]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.points).toHaveLength(12);
    expect(a.points[0].t).toBe(0);
    expect(a.points[11].t).toBe(1);
    const iMax = b.points.reduce((m, p, i, arr) => (p.r > arr[m].r ? i : m), 0);
    expect(b.points[iMax].r).toBeCloseTo(1, 2);
    expect(b.points[iMax].t).toBeGreaterThan(0.1);
    expect(b.points[iMax].t).toBeLessThan(0.5);
    expect(b.points[11].r).toBeLessThan(0.7);
  });
});

/** A design with an SVG star motif. */
const starMotif = (extra: object = {}) => {
  const e = encodeShapes(parseSvg(svg(`<path d="${STAR}"/>`)).polylines);
  if (!e.ok) throw new Error('encode');
  return {
    source: 'svg',
    svg: { name: 'star.svg', data: e.data, hash: e.hash, points: e.points },
    placement: 'repeat',
    repeatsAround: 6,
    repeatsUp: 2,
    bandStart: 20,
    bandEnd: 80,
    ...extra,
  } as const;
};
const withMotif = (base: VaseParamsInput, motif: object, extra: VaseParamsInput = {}) =>
  normalizeParams({ ...base, motif, ...extra });

describe('SVG pattern on the body', () => {
  it('the map is periodic for repeats and empty outside the band', () => {
    const p = withMotif(PRESETS[2].params, starMotif());
    const map = buildMotifMap(p, p.dimensions.height, 50)!;
    expect(map).not.toBeNull();
    const step = (2 * Math.PI) / 6;
    for (let k = 0; k < 50; k++) {
      const phi = (k / 50) * 2 * Math.PI;
      const z = p.dimensions.height * (0.25 + (0.5 * ((k * 7) % 50)) / 50);
      expect(map.at(phi + step, z)).toBeCloseTo(map.at(phi, z), 3);
    }
    expect(map.at(1, p.dimensions.height * 0.05)).toBe(map.cap);
    expect(map.d.reduce((a, b) => Math.min(a, b), Infinity)).toBeLessThan(0);
  });

  it('relief on a vase: manifold, deterministic, golden-safe (off by default)', () => {
    const base = PRESETS.find((x) => x.id === 'fluted-column')!.params;
    const p = withMotif(base, starMotif(), {
      effects: [...base.effects, { type: 'motif', relief: 'raised', depth: 1, softness: 1.2 }],
    });
    const a = buildDesign(p, 'low');
    const b = buildDesign(p, 'low');
    expect(hashBuffer(a.mesh.positions)).toBe(hashBuffer(b.mesh.positions));
    expect(checkManifold(a.mesh).manifold).toBe(true);
    const off = buildDesign(base, 'low');
    expect(hashBuffer(a.mesh.positions)).not.toBe(hashBuffer(off.mesh.positions));
    // raised relief is outward, the engraving inward
    let maxR = 0;
    for (let k = 0; k < a.mesh.positions.length; k += 3)
      maxR = Math.max(maxR, Math.hypot(a.mesh.positions[k], a.mesh.positions[k + 1]));
    let maxOff = 0;
    for (let k = 0; k < off.mesh.positions.length; k += 3)
      maxOff = Math.max(maxOff, Math.hypot(off.mesh.positions[k], off.mesh.positions[k + 1]));
    expect(maxR).toBeGreaterThan(maxOff + 0.5);
  });

  it('a single motif (calligraphy-style placement) sits at its angle and height only', () => {
    const p = withMotif(PRESETS[2].params, starMotif({ placement: 'single', angle: 90, height: 50, size: 40 }));
    const map = buildMotifMap(p, p.dimensions.height, 50)!;
    const H = p.dimensions.height;
    expect(map.at(Math.PI / 2, H / 2 + 2)).toBeLessThan(0);
    expect(map.at(-Math.PI / 2, H / 2)).toBe(map.cap);
  });

  it('as sleeve openings: one sound body, bore exact, coverage reported, teardrop on', () => {
    const base = PRESETS.find((x) => x.id === 'sleeve-starter')!.params;
    const p = withMotif(base, starMotif({ repeatsAround: 6, repeatsUp: 2 }), {
      sleeve: { ...base.sleeve, holes: { ...base.sleeve.holes, mode: 'pattern' } },
    });
    const b = buildSleeveMesh(p, 2);
    expectSoundSleeve(b, 'svg holes');
    const s = b.mesh.sleeve.holes!;
    expect(s.coverage).toBeGreaterThan(0.03);
    expect(s.thinBridges).toBeNull();
    const r = analyze(b, p);
    expect(r.issues.map((i) => i.id)).toContain('bore-ok');
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it('printability: engraving deeper than the shell wall, motif thinner than two lines, steep relief edges', () => {
    const base = normalizeParams({ ...PRESETS[2].params, print: { ...PRESETS[2].params.print, outputMode: 'shell' } });
    const deep = withMotif(base, starMotif(), {
      effects: [{ type: 'motif', relief: 'engraved', depth: 3, softness: 0.4 }],
      print: { ...base.print, wallThickness: 2.1 },
    });
    const ids = analyze(buildDesign(deep, 'low'), deep).issues.map((i) => i.id);
    expect(ids).toContain('motif-depth-0');
    const tiny = withMotif(base, starMotif({ repeatsAround: 48, repeatsUp: 24 }), {
      effects: [{ type: 'motif', relief: 'raised', depth: 1, softness: 0.2 }],
    });
    const issues = analyze(buildDesign(tiny, 'low'), tiny).issues;
    expect(issues.map((i) => i.id)).toContain('motif-feature-0');
    const edge = issues.find((i) => i.id === 'motif-edge-0')!;
    expect(edge.fix?.kind).toBe('patch');
  });
});

describe('AI never writes shape blobs, insert.* or hole compensation', () => {
  it('filters proposal changes and refuses refine patches that touch them', () => {
    expect(aiMayWrite('motif.svg.data')).toBe(false);
    expect(aiMayWrite('/motif/svg/data')).toBe(false);
    expect(aiMayWrite('insert.od')).toBe(false);
    expect(aiMayWrite('/print/printer/holeCompensation')).toBe(false);
    expect(aiMayWrite('motif.repeatsAround')).toBe(true);
    const r = applyProposal(
      {
        basePreset: PRESETS[0].id,
        changes: [
          { path: 'motif.svg.data', valueJson: '"abc"' },
          { path: 'insert.od', valueJson: '60' },
          { path: 'motif.repeatsAround', valueJson: '12' },
        ],
        summary: { fa: '', en: '' },
      },
      PRESETS,
    );
    expect(r.rejected).toEqual(['motif.svg.data', 'insert.od']);
    expect(r.params.motif.repeatsAround).toBe(12);
    const cur = PRESETS[0].params;
    const ref = applyRefine(cur, {
      ops: [{ op: 'replace', path: '/motif/svg/data', from: null, valueJson: '"x"' }],
      summary: { fa: '', en: '' },
    });
    expect(ref.params).toBe(cur);
    expect(ref.rejected).toHaveLength(1);
  });
});
