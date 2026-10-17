/** Regenerate tests/golden/vase-presets.json. Only run after an intentional, documented geometry change. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeVaseGolden } from '../tests/golden/vasePresets';

const golden = computeVaseGolden();
writeFileSync(
  join(import.meta.dirname, '..', 'tests', 'golden', 'vase-presets.json'),
  JSON.stringify(golden, null, 2) + '\n',
);
console.log(`wrote golden for ${Object.keys(golden.presets).length} presets`);
