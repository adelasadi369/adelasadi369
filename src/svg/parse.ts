/**
 * SVG → polylines, as data only (no DOM, no browser path engine, nothing is ever rendered or executed).
 *
 * A small tag tokenizer walks the markup; only geometry is read: `svg`, `g`, `a`, `switch` as containers and `path`,
 * `polygon`, `polyline`, `rect`, `circle`, `ellipse`, `line` as shapes, with their `transform`. Everything else is
 * dropped together with its subtree: `script`, `style` (CSS is ignored, so is the `style` attribute), `foreignObject`,
 * `image`, `use` (external and internal references), `defs`, `symbol`, `clipPath`, `mask`, `pattern`, `marker`,
 * gradients, filters, `text`. Event-handler attributes are never looked at. Elements with `display="none"` are skipped.
 *
 * Paths support M L H V C S Q T A Z (absolute and relative); transforms translate / scale / rotate (with centre) /
 * skewX / skewY / matrix, composed down the tree. Curves are flattened after the transform (Bézier curves are
 * affine-invariant) to a tolerance of `tolerance` × the drawing's diagonal.
 */
export interface SvgPolyline {
  /** x, y pairs in root user units (SVG y points down). */
  pts: number[];
  closed: boolean;
}

export interface SvgParseResult {
  polylines: SvgPolyline[];
  /** Element names that were dropped (scripts, images, references, …), counted. */
  dropped: Record<string, number>;
  points: number;
}

export interface SvgParseOptions {
  /** Flattening tolerance relative to the drawing's bounding-box diagonal. */
  tolerance?: number;
  /** Hard cap on the total number of points; above it the polylines are simplified (Douglas–Peucker). */
  maxPoints?: number;
}

type M6 = [number, number, number, number, number, number];
const ID: M6 = [1, 0, 0, 1, 0, 0];

const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
const SHAPES = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);

function mul(a: M6, b: M6): M6 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const nums = (s: string) => (s.match(NUM) ?? []).map(Number);

/** transform="…" → matrix; unknown functions are ignored. */
export function parseTransform(s: string | undefined): M6 {
  let m: M6 = ID;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const [, fn, args] of s.matchAll(re)) {
    const a = nums(args);
    let t: M6 = ID;
    if (fn === 'matrix' && a.length >= 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const c = Math.cos(r);
      const sn = Math.sin(r);
      const cx = a[1] ?? 0;
      const cy = a[2] ?? 0;
      t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy];
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  close: boolean;
  selfClose: boolean;
}

/** Tag stream with comments, CDATA, doctype and processing instructions removed. */
function* tags(text: string): Generator<Tag> {
  const src = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  const re = /<\s*(\/)?\s*([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?\s*>/g;
  for (const m of src.matchAll(re)) {
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[a[1]] = a[2] ?? a[3] ?? '';
    // namespaced names (svg:path) count as their local name
    const name = m[2].includes(':') ? m[2].slice(m[2].indexOf(':') + 1) : m[2];
    yield { name, attrs, close: !!m[1], selfClose: !!m[4] };
  }
}

const num = (v: string | undefined, d = 0) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/** Collects flattened polylines in root user space. */
class Out {
  polylines: SvgPolyline[] = [];
  cur: number[] = [];
  constructor(
    public tol: number,
    public m: M6 = ID,
  ) {}
  private tx(x: number, y: number): [number, number] {
    const m = this.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  move(x: number, y: number) {
    this.end(false);
    this.cur.push(...this.tx(x, y));
  }
  line(x: number, y: number) {
    this.cur.push(...this.tx(x, y));
  }
  /** Cubic from the current point (local coordinates). */
  cubic(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    const [a0, b0] = this.tx(x0, y0);
    const [a1, b1] = this.tx(x1, y1);
    const [a2, b2] = this.tx(x2, y2);
    const [a3, b3] = this.tx(x3, y3);
    const dd = Math.max(Math.hypot(a0 - 2 * a1 + a2, b0 - 2 * b1 + b2), Math.hypot(a1 - 2 * a2 + a3, b1 - 2 * b2 + b3));
    const n = Math.min(256, Math.max(1, Math.ceil(Math.sqrt((0.75 * dd) / this.tol))));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t; // prettier-ignore
      this.cur.push(w0 * a0 + w1 * a1 + w2 * a2 + w3 * a3, w0 * b0 + w1 * b1 + w2 * b2 + w3 * b3);
    }
  }
  quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
    this.cubic(x0, y0, x0 + (2 / 3) * (x1 - x0), y0 + (2 / 3) * (y1 - y0), x2 + (2 / 3) * (x1 - x2), y2 + (2 / 3) * (y1 - y2), x2, y2); // prettier-ignore
  }
  /** SVG elliptical arc (endpoint parameterisation, F.6.5 of the SVG spec), sampled in local space. */
  arc(
    x1: number,
    y1: number,
    rx: number,
    ry: number,
    phiDeg: number,
    large: boolean,
    sweep: boolean,
    x2: number,
    y2: number,
  ) {
    if (x1 === x2 && y1 === y2) return;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return this.line(x2, y2);
    const phi = (phiDeg * Math.PI) / 180;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const xp = c * dx + s * dy;
    const yp = -s * dx + c * dy;
    const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const num2 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
    const den = rx * rx * yp * yp + ry * ry * xp * xp;
    let k = Math.sqrt(Math.max(0, num2 / den));
    if (large === sweep) k = -k;
    const cxp = (k * rx * yp) / ry;
    const cyp = (-k * ry * xp) / rx;
    const cx = c * cxp - s * cyp + (x1 + x2) / 2;
    const cy = s * cxp + c * cyp + (y1 + y2) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
    let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    // chord error r(1 − cos(Δ/2)) ≤ tol, with r the larger transformed radius
    const sc = Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])) || 1;
    const R = Math.max(rx, ry) * sc;
    const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - this.tol / Math.max(R, 1e-9))));
    const n = Math.min(512, Math.max(2, Math.ceil(Math.abs(dt) / Math.max(step, 1e-3))));
    for (let i = 1; i <= n; i++) {
      const t = t1 + (dt * i) / n;
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      this.cur.push(...this.tx(c * ex - s * ey + cx, s * ex + c * ey + cy));
    }
  }
  end(closed: boolean) {
    if (this.cur.length >= 4) {
      const p = this.cur;
      // a closing point equal to the start is dropped
      if (closed && p.length >= 6 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) p.length -= 2;
      this.polylines.push({ pts: p, closed: closed && p.length >= 6 });
    }
    this.cur = [];
  }
}

/** Path data → polylines (all commands, absolute and relative). */
export function parsePathData(d: string, out: Out) {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0; // prettier-ignore
  let lcx = 0, lcy = 0, lqx = 0, lqy = 0; // prettier-ignore
  let prev = '';
  const isCmd = (t: string) => /^[A-Za-z]$/.test(t);
  const n = () => {
    const t = toks[i++];
    return t === undefined || isCmd(t) ? NaN : Number(t);
  };
  // arc flags may be written without separators ("a1 1 0 01 5 5"): split the flag digits apart
  const flag = () => {
    const t = toks[i];
    if (t === undefined || isCmd(t)) return NaN;
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && !t.startsWith('0.') && !t.startsWith('1.')) {
      toks[i] = t.slice(1);
      return Number(t[0]);
    }
    i++;
    return Number(t);
  };
  while (i < toks.length) {
    if (isCmd(toks[i])) cmd = toks[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (C === 'Z') {
      if (out.cur.length) {
        out.line(sx, sy);
        out.end(true);
      }
      x = sx;
      y = sy;
      prev = 'Z';
      // a command letter must follow Z
      cmd = '';
      continue;
    }
    if (C === 'M') {
      const a = n(), b = n(); // prettier-ignore
      if (Number.isNaN(a) || Number.isNaN(b)) break;
      x = ox + a;
      y = oy + b;
      sx = x;
      sy = y;
      out.move(x, y);
      cmd = rel ? 'l' : 'L';
      prev = 'M';
      continue;
    }
    if (!out.cur.length) out.move(x, y);
    if (C === 'L') {
      const a = n(), b = n(); // prettier-ignore
      if (Number.isNaN(a) || Number.isNaN(b)) break;
      x = ox + a;
      y = oy + b;
      out.line(x, y);
    } else if (C === 'H') {
      const a = n();
      if (Number.isNaN(a)) break;
      x = ox + a;
      out.line(x, y);
    } else if (C === 'V') {
      const a = n();
      if (Number.isNaN(a)) break;
      y = oy + a;
      out.line(x, y);
    } else if (C === 'C' || C === 'S') {
      let x1: number, y1: number;
      if (C === 'C') {
        x1 = ox + n();
        y1 = oy + n();
      } else if (prev === 'C' || prev === 'S') {
        x1 = 2 * x - lcx;
        y1 = 2 * y - lcy;
      } else {
        x1 = x;
        y1 = y;
      }
      const x2 = ox + n(), y2 = oy + n(), x3 = ox + n(), y3 = oy + n(); // prettier-ignore
      if ([x1, y1, x2, y2, x3, y3].some(Number.isNaN)) break;
      out.cubic(x, y, x1, y1, x2, y2, x3, y3);
      lcx = x2;
      lcy = y2;
      x = x3;
      y = y3;
    } else if (C === 'Q' || C === 'T') {
      let x1: number, y1: number;
      if (C === 'Q') {
        x1 = ox + n();
        y1 = oy + n();
      } else if (prev === 'Q' || prev === 'T') {
        x1 = 2 * x - lqx;
        y1 = 2 * y - lqy;
      } else {
        x1 = x;
        y1 = y;
      }
      const x2 = ox + n(), y2 = oy + n(); // prettier-ignore
      if ([x1, y1, x2, y2].some(Number.isNaN)) break;
      out.quad(x, y, x1, y1, x2, y2);
      lqx = x1;
      lqy = y1;
      x = x2;
      y = y2;
    } else if (C === 'A') {
      const rx = n(), ry = n(), rot = n(), large = flag(), sweep = flag(), a = n(), b = n(); // prettier-ignore
      if ([rx, ry, rot, large, sweep, a, b].some(Number.isNaN)) break;
      const x2 = ox + a;
      const y2 = oy + b;
      out.arc(x, y, rx, ry, rot, large === 1, sweep === 1, x2, y2);
      x = x2;
      y = y2;
    } else break;
    prev = C;
  }
  out.end(false);
}

function shape(name: string, a: Record<string, string>, out: Out) {
  switch (name) {
    case 'path':
      return parsePathData(a.d ?? '', out);
    case 'polygon':
    case 'polyline': {
      const v = nums(a.points ?? '');
      if (v.length < 4) return;
      out.move(v[0], v[1]);
      for (let k = 2; k + 1 < v.length; k += 2) out.line(v[k], v[k + 1]);
      return out.end(name === 'polygon');
    }
    case 'line':
      out.move(num(a.x1), num(a.y1));
      out.line(num(a.x2), num(a.y2));
      return out.end(false);
    case 'circle':
    case 'ellipse': {
      const cx = num(a.cx);
      const cy = num(a.cy);
      const rx = name === 'circle' ? num(a.r) : num(a.rx);
      const ry = name === 'circle' ? num(a.r) : num(a.ry);
      if (rx <= 0 || ry <= 0) return;
      out.move(cx + rx, cy);
      out.arc(cx + rx, cy, rx, ry, 0, false, true, cx - rx, cy);
      out.arc(cx - rx, cy, rx, ry, 0, false, true, cx + rx, cy);
      return out.end(true);
    }
    case 'rect': {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      if (w <= 0 || h <= 0) return;
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      out.move(x + rx, y);
      out.line(x + w - rx, y);
      if (rx > 0) out.arc(x + w - rx, y, rx, ry, 0, false, true, x + w, y + ry);
      out.line(x + w, y + h - ry);
      if (rx > 0) out.arc(x + w, y + h - ry, rx, ry, 0, false, true, x + w - rx, y + h);
      out.line(x + rx, y + h);
      if (rx > 0) out.arc(x + rx, y + h, rx, ry, 0, false, true, x, y + h - ry);
      out.line(x, y + ry);
      if (rx > 0) out.arc(x, y + ry, rx, ry, 0, false, true, x + rx, y);
      return out.end(true);
    }
  }
}

/** One walk over the tag stream: shapes with their composed transform. */
function walk(text: string, tol: number) {
  const out = new Out(tol);
  const dropped: Record<string, number> = {};
  const stack: { name: string; m: M6; skip: boolean }[] = [];
  let m: M6 = ID;
  let skip = false;
  for (const t of tags(text)) {
    if (t.close) {
      // pop to the matching open tag (tolerates unbalanced markup)
      const k = stack.map((s) => s.name).lastIndexOf(t.name);
      if (k < 0) continue;
      stack.length = k;
      const top = stack[k - 1];
      m = top ? top.m : ID;
      skip = top ? top.skip : false;
      continue;
    }
    const known = CONTAINERS.has(t.name) || SHAPES.has(t.name);
    const hidden = t.attrs.display === 'none' || t.attrs.visibility === 'hidden';
    const here = skip || !known || hidden;
    if (!known && !skip) dropped[t.name] = (dropped[t.name] ?? 0) + 1;
    const mm = here ? m : mul(m, parseTransform(t.attrs.transform));
    if (!here && SHAPES.has(t.name)) {
      out.m = mm;
      shape(t.name, t.attrs, out);
    }
    if (!t.selfClose) {
      stack.push({ name: t.name, m: mm, skip: here });
      m = mm;
      skip = here;
    }
  }
  return { polylines: out.polylines, dropped };
}

/** Douglas–Peucker on one polyline (flat x, y) with tolerance eps. */
export function simplify(p: number[], eps: number, closed: boolean): number[] {
  const n = p.length / 2;
  if (n <= (closed ? 4 : 2)) return p;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  // a closed ring: split at the point farthest from the start so both halves are proper chains
  if (closed) {
    let far = 0;
    let best = -1;
    for (let k = 1; k < n; k++) {
      const d = (p[2 * k] - p[0]) ** 2 + (p[2 * k + 1] - p[1]) ** 2;
      if (d > best) {
        best = d;
        far = k;
      }
    }
    keep[far] = 1;
    stack.length = 0;
    stack.push([0, far], [far, n - 1]);
  }
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1]; // prettier-ignore
    const ex = bx - ax;
    const ey = by - ay;
    const L = Math.hypot(ex, ey) || 1e-12;
    let idx = -1;
    let dm = eps;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((p[2 * k] - ax) * ey - (p[2 * k + 1] - ay) * ex) / L;
      if (d > dm) {
        dm = d;
        idx = k;
      }
    }
    if (idx >= 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(p[2 * k], p[2 * k + 1]);
  return out;
}

export function parseSvg(text: string, opts: SvgParseOptions = {}): SvgParseResult {
  const rel = opts.tolerance ?? 5e-4;
  const maxPoints = opts.maxPoints ?? 20000;
  // pass 1: rough bounding box (one segment per curve), pass 2: flatten to tolerance × diagonal
  const rough = walk(text, 1e12);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; // prettier-ignore
  for (const p of rough.polylines)
    for (let k = 0; k < p.pts.length; k += 2) {
      x0 = Math.min(x0, p.pts[k]);
      x1 = Math.max(x1, p.pts[k]);
      y0 = Math.min(y0, p.pts[k + 1]);
      y1 = Math.max(y1, p.pts[k + 1]);
    }
  const diag = Number.isFinite(x0) ? Math.hypot(x1 - x0, y1 - y0) || 1 : 1;
  const res = walk(text, rel * diag);
  let polylines = res.polylines;
  let points = polylines.reduce((s, p) => s + p.pts.length / 2, 0);
  for (let eps = rel * diag; points > maxPoints && eps < diag; eps *= 2) {
    polylines = polylines.map((p) => ({ ...p, pts: simplify(p.pts, eps, p.closed) }));
    points = polylines.reduce((s, p) => s + p.pts.length / 2, 0);
  }
  return { polylines, dropped: res.dropped, points };
}
