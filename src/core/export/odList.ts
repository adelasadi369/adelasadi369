/** Insert ODs of one batch: 10–150 mm (the schema range), deduplicated, ascending, at most 8. */
export function parseOdList(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const v = Number(m[0].replace(',', '.'));
    if (v >= 10 && v <= 150) out.add(Math.round(v * 10) / 10);
  }
  return [...out].sort((a, b) => a - b).slice(0, 8);
}
