/**
 * Client-side silhouette extraction (no AI): estimate the background from the image corners, mask the
 * object by colour distance, then read the half-width per row. Returns radius factors at 8 heights
 * (t = 0 at the base) and the height-to-width ratio, or null when no clear object is found.
 */
export interface Silhouette {
  points: { t: number; r: number }[];
  heightToWidth: number;
  /** Mask rows for the preview overlay: [y, xLeft, xRight] in image pixels of the analysed canvas. */
  rows: [number, number, number][];
  width: number;
  height: number;
}

export function extractSilhouette(img: CanvasImageSource & { width: number; height: number }): Silhouette | null {
  const H = 256;
  const W = Math.max(16, Math.round((img.width / img.height) * H));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const px = (x: number, y: number) => {
    const o = (y * W + x) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  // background colour: mean of the four 6×6 corners
  const bg = [0, 0, 0];
  let n = 0;
  for (const [cx, cy] of [
    [0, 0],
    [W - 6, 0],
    [0, H - 6],
    [W - 6, H - 6],
  ]) {
    for (let y = cy; y < cy + 6; y++) {
      for (let x = cx; x < cx + 6; x++) {
        const c = px(x, y);
        bg[0] += c[0];
        bg[1] += c[1];
        bg[2] += c[2];
        n++;
      }
    }
  }
  bg.forEach((_, i) => (bg[i] /= n));
  const thr = 42;
  const rows: [number, number, number][] = [];
  for (let y = 0; y < H; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < W; x++) {
      const c = px(x, y);
      const d = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
      if (d > thr) {
        if (l < 0) l = x;
        r = x;
      }
    }
    if (l >= 0 && r - l > 2) rows.push([y, l, r]);
  }
  if (rows.length < H * 0.2) return null;
  const top = rows[0][0];
  const bottom = rows[rows.length - 1][0];
  const halfAt = (y: number) => {
    const row = rows.reduce((b, rr) => (Math.abs(rr[0] - y) < Math.abs(b[0] - y) ? rr : b), rows[0]);
    return (row[2] - row[1]) / 2;
  };
  let maxHalf = 0;
  for (const [, l, r] of rows) maxHalf = Math.max(maxHalf, (r - l) / 2);
  const points = Array.from({ length: 8 }, (_, k) => {
    const t = k / 7;
    const y = Math.round(bottom - t * (bottom - top));
    return { t, r: Math.max(0.05, halfAt(y) / maxHalf) };
  });
  return { points, heightToWidth: (bottom - top) / (2 * maxHalf), rows, width: W, height: H };
}
