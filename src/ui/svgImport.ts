import type { Pt } from '../core/geometry/svgPolar';

/**
 * Sample every geometry element of an SVG into polylines in root user space (transforms applied),
 * using the browser's own path engine (getPointAtLength / getCTM).
 */
export function svgToPolylines(text: string): Pt[][] {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') return [];
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden';
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const out: Pt[][] = [];
    const rootCTM = svg.getCTM();
    const inv = rootCTM ? rootCTM.inverse() : null;
    for (const el of Array.from(svg.querySelectorAll('path, polygon, polyline, rect, circle, ellipse'))) {
      const g = el as SVGGeometryElement;
      if (typeof g.getTotalLength !== 'function') continue;
      const len = g.getTotalLength();
      if (!(len > 0)) continue;
      const n = Math.max(64, Math.min(4000, Math.ceil(len / 0.25)));
      const ctm = g.getCTM();
      const m = ctm && inv ? inv.multiply(ctm) : ctm;
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const p = g.getPointAtLength((len * i) / n);
        const q = m ? new DOMPoint(p.x, p.y).matrixTransform(m) : p;
        pts.push([q.x, q.y]);
      }
      out.push(pts);
    }
    return out;
  } finally {
    host.remove();
  }
}
