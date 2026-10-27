import type opentype from 'opentype.js';
import { parseSvg, type SvgPolyline } from '../svg/parse';

/**
 * Text → outline polylines with opentype.js and the bundled Vazirmatn font (OFL, public/fonts). opentype.js 1.3
 * shapes Arabic script: contextual forms (isolated / initial / medial / final) and the lam-alef ligatures, laid out
 * right to left, so Persian words come out joined. The glyph path goes through the same data-only path parser as
 * SVG files (flattened curves, point cap).
 */
export function textOutline(font: opentype.Font, text: string): SvgPolyline[] {
  const path = font.getPath(text, 0, 0, 100, { kerning: true });
  const d = path.toPathData(3);
  if (!d) return [];
  return parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`).polylines;
}

/** Glyph names of a shaped string (tests and diagnostics). */
export function shapedGlyphs(font: opentype.Font, text: string): string[] {
  return font.stringToGlyphs(text).map((g) => g.name ?? String(g.index));
}
