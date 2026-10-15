/** Expand scripts/presets.src.ts into full parameter JSON files in src/presets/. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeParams } from '../src/core/params/normalize';
import { PRESET_SOURCES } from './presets.src';

const dir = join(import.meta.dirname, '..', 'src', 'presets');
const index: { id: string; name: { fa: string; en: string } }[] = [];
for (const s of PRESET_SOURCES) {
  const p = normalizeParams({ ...s.params, name: s.name.en });
  p.effects.forEach((e, i) => (e.id = `${s.id}-${i}`));
  writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(p, null, 2) + '\n');
  index.push({ id: s.id, name: s.name });
}
writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`wrote ${index.length} presets`);
