// default import: lz-string is CommonJS, and named imports fail under plain Node ESM (scripts, tsx)
import LZString from 'lz-string';

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString;

/**
 * Imported 2D shapes stored inside params (never raw SVG): sanitised, flattened polylines normalised to their
 * bounding box (longest side 1, y up), quantised to 1 / QUANT, delta-encoded as text and lz-string compressed.
 *   text   = "W,H|" + polylines joined by "|"; each "c:" (closed) or "o:" (open) + "dx,dy;dx,dy;…" (first absolute)
 * W, H are the normalised width and height (one of them is 1). `hash` is FNV-1a (32 bit, hex) of the compressed
 * string, so a design can tell "same shape" without comparing blobs.
 */
export interface Shape2D {
  closed: boolean;
  /** x, y pairs in [0, W] × [0, H] (y up). */
  pts: Float64Array;
}

export interface ShapeSet {
  w: number;
  h: number;
  shapes: Shape2D[];
  points: number;
}

/** Hard caps for a stored shape blob. */
export const SHAPE_MAX_POINTS = 20000;
export const SHAPE_MAX_BYTES = 65536;
const QUANT = 10000;

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export type EncodeResult =
  | { ok: true; data: string; hash: string; points: number }
  | { ok: false; reason: 'empty' | 'tooManyPoints' | 'tooLarge' };

/**
 * Encode polylines given as x, y pairs in SVG user units (y down). Degenerate pieces (< 2 points, or closed with < 3)
 * are dropped.
 */
export function encodeShapes(polys: { pts: ArrayLike<number>; closed: boolean }[]): EncodeResult {
  const keep = polys.filter((p) => p.pts.length >= (p.closed ? 6 : 4));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; // prettier-ignore
  let points = 0;
  for (const p of keep) {
    points += p.pts.length / 2;
    for (let k = 0; k < p.pts.length; k += 2) {
      x0 = Math.min(x0, p.pts[k]);
      x1 = Math.max(x1, p.pts[k]);
      y0 = Math.min(y0, p.pts[k + 1]);
      y1 = Math.max(y1, p.pts[k + 1]);
    }
  }
  if (!keep.length || !(x1 > x0 || y1 > y0)) return { ok: false, reason: 'empty' };
  if (points > SHAPE_MAX_POINTS) return { ok: false, reason: 'tooManyPoints' };
  const s = Math.max(x1 - x0, y1 - y0);
  const W = Math.round(((x1 - x0) / s) * QUANT);
  const H = Math.round(((y1 - y0) / s) * QUANT);
  const parts: string[] = [`${W},${H}`];
  for (const p of keep) {
    let px = 0;
    let py = 0;
    const seg: string[] = [];
    for (let k = 0; k < p.pts.length; k += 2) {
      const qx = Math.round(((p.pts[k] - x0) / s) * QUANT);
      // flip y: SVG y points down, the vase's z up
      const qy = Math.round(((y1 - p.pts[k + 1]) / s) * QUANT);
      if (k > 0 && qx === px && qy === py) continue;
      seg.push(k === 0 ? `${qx},${qy}` : `${qx - px},${qy - py}`);
      px = qx;
      py = qy;
    }
    parts.push((p.closed ? 'c:' : 'o:') + seg.join(';'));
  }
  const data = compressToEncodedURIComponent(parts.join('|'));
  if (data.length > SHAPE_MAX_BYTES) return { ok: false, reason: 'tooLarge' };
  return { ok: true, data, hash: fnv1a(data), points };
}

const decoded = new Map<string, ShapeSet>();

/** Decode a stored blob (cached by content); malformed input gives an empty set, never a throw. */
export function decodeShapes(data: string): ShapeSet {
  const hit = decoded.get(data);
  if (hit) return hit;
  const empty: ShapeSet = { w: 1, h: 1, shapes: [], points: 0 };
  if (!data) return empty;
  let text: string | null;
  try {
    text = decompressFromEncodedURIComponent(data);
  } catch {
    text = null;
  }
  if (!text) return empty;
  const [head, ...rest] = text.split('|');
  const [W, H] = head.split(',').map(Number);
  if (!(W >= 0 && H >= 0)) return empty;
  const shapes: Shape2D[] = [];
  let points = 0;
  for (const part of rest) {
    const closed = part.startsWith('c:');
    const vals = part
      .slice(2)
      .split(';')
      .map((q) => q.split(',').map(Number));
    const pts = new Float64Array(vals.length * 2);
    let x = 0;
    let y = 0;
    let ok = true;
    vals.forEach(([dx, dy], k) => {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) ok = false;
      x = k === 0 ? dx : x + dx;
      y = k === 0 ? dy : y + dy;
      pts[2 * k] = x / QUANT;
      pts[2 * k + 1] = y / QUANT;
    });
    if (!ok || pts.length < (closed ? 6 : 4)) continue;
    points += pts.length / 2;
    shapes.push({ closed, pts });
  }
  const set = { w: W / QUANT, h: H / QUANT, shapes, points };
  if (decoded.size > 16) decoded.clear();
  decoded.set(data, set);
  return set;
}
