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
