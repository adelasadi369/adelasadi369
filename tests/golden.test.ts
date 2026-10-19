import { describe, expect, it } from 'vitest';
import { VASE_PRESETS } from '../src/presets';
import golden from './golden/vase-presets.json';
import { computeVaseGolden } from './golden/vasePresets';

// Safety net for the sleeve work (docs/sleeve-integration.md §9): the vase mesh path must not drift.
// After an intentional geometry change, run `npm run golden` and document why in the PR.
describe('golden vase presets', () => {
  const actual = computeVaseGolden();

  it('covers exactly the current vase presets', () => {
    expect(Object.keys(golden.presets).sort()).toEqual(VASE_PRESETS.map((p) => p.id).sort());
  });

  for (const preset of VASE_PRESETS) {
    it(`${preset.id} matches its golden hash and counts`, () => {
      expect(actual.presets[preset.id]).toEqual(golden.presets[preset.id as keyof typeof golden.presets]);
    });
  }
});
