/** Signed-distance helpers (mm). Material is where d < 0. */

/** Polynomial smooth minimum (smooth union) with blend radius k; exact min for k ≤ 0. Never above min(a, b). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return (a < b ? a : b) - (h * h * k) / 4;
}

/** Polynomial smooth maximum (smooth intersection / subtraction); never below max(a, b). */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Infinite vertical cylinder of radius r about the z axis, from ρ = hypot(x, y). */
export const cylinder = (rho: number, r: number) => rho - r;

/**
 * Round cone (Quílez): the convex hull of a sphere r1 at a and a sphere r2 at b; exact distance. Needs |r1 − r2| < |b − a|.
 * Its side makes the angle asin((r1 − r2) / |b − a|) with the axis, so a bulb that widens upward at ≤ α is self-supporting.
 */
export function roundCone(
  px: number,
  py: number,
  pz: number, // prettier-ignore
  ax: number,
  ay: number,
  az: number, // prettier-ignore
  bx: number,
  by: number,
  bz: number, // prettier-ignore
  r1: number,
  r2: number,
): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az; // prettier-ignore
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - ax, pay = py - ay, paz = pz - az; // prettier-ignore
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y; // prettier-ignore
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
