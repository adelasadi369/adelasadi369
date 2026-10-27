import type { Poly, V2 } from './tilings';

/**
 * Hankin's "polygons in contact" construction (Kaplan, Islamic star patterns from polygons in contact, GI 2005).
 * From each edge midpoint of a tiling polygon two rays enter the polygon at the contact angle θ to the edge
 * (with offset δ they start δ apart along the edge: the two-line variant). Rays are paired greedily by the shortest
 * combined length to a meeting point inside the polygon (adjacent pairs win in regular polygons, which gives the
 * classic stars; the same rule handles the concave girih pieces); collinear rays that face each other join directly.
 * Neighbouring polygons share the edge midpoints, so the strands run on across every edge: one connected network.
 */
export interface Segment {
  a: V2;
  b: V2;
}

interface Ray {
  p: V2;
  d: V2;
  edge: number;
}

function inside(poly: Poly, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function hankin(poly: Poly, thetaDeg: number, offset: number): Segment[] {
  const th = (thetaDeg * Math.PI) / 180;
  const n = poly.length;
  const rays: Ray[] = [];
  for (let k = 0; k < n; k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[(k + 1) % n];
    const L = Math.hypot(bx - ax, by - ay);
    const ex = (bx - ax) / L;
    const ey = (by - ay) / L;
    // CCW polygon: the inward normal is the edge turned left
    const nx = -ey;
    const ny = ex;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const d = offset * L;
    const c = Math.cos(th);
    const s = Math.sin(th);
    // with an offset the ray leaning toward the next vertex starts behind the midpoint (and vice versa): the
    // neighbour across the edge starts its ray at the same point in the opposite direction, so strands run straight
    rays.push({ p: [mx - d * ex, my - d * ey], d: [c * ex + s * nx, c * ey + s * ny], edge: k });
    rays.push({ p: [mx + d * ex, my + d * ey], d: [-c * ex + s * nx, -c * ey + s * ny], edge: k });
  }
  // candidate meetings
  const cands: { i: number; j: number; cost: number; x: V2 }[] = [];
  for (let i = 0; i < rays.length; i++)
    for (let j = i + 1; j < rays.length; j++) {
      const r = rays[i];
      const q = rays[j];
      if (r.edge === q.edge) continue;
      const den = r.d[0] * q.d[1] - r.d[1] * q.d[0];
      const wx = q.p[0] - r.p[0];
      const wy = q.p[1] - r.p[1];
      if (Math.abs(den) < 1e-9) {
        // parallel: join when collinear and facing each other
        const cross = wx * r.d[1] - wy * r.d[0];
        const along = wx * r.d[0] + wy * r.d[1];
        if (Math.abs(cross) < 1e-7 && along > 1e-9 && r.d[0] * q.d[0] + r.d[1] * q.d[1] < 0)
          cands.push({ i, j, cost: along, x: [(r.p[0] + q.p[0]) / 2, (r.p[1] + q.p[1]) / 2] });
        continue;
      }
      const t = (wx * q.d[1] - wy * q.d[0]) / den;
      const u = (wx * r.d[1] - wy * r.d[0]) / den;
      if (t <= 1e-9 || u <= 1e-9) continue;
      const x: V2 = [r.p[0] + t * r.d[0], r.p[1] + t * r.d[1]];
      if (!inside(poly, x[0], x[1])) continue;
      cands.push({ i, j, cost: t + u, x });
    }
  cands.sort((p, q) => p.cost - q.cost || p.i - q.i || p.j - q.j);
  const used = new Uint8Array(rays.length);
  const out: Segment[] = [];
  for (const c of cands) {
    if (used[c.i] || used[c.j]) continue;
    used[c.i] = used[c.j] = 1;
    out.push({ a: rays[c.i].p, b: c.x }, { a: rays[c.j].p, b: c.x });
  }
  return out;
}
