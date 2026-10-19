import { expect } from 'vitest';
import { normalizeParams } from '../src/core/params/normalize';
import type { VaseParams, VaseParamsInput } from '../src/core/params/schema';
import { checkManifold, signedVolume } from '../src/core/printability/sanity';
import type { SleeveBuild } from '../src/core/sleeve';

export const sleeveParams = (base: VaseParamsInput | VaseParams = {}, insert: object = {}): VaseParams =>
  normalizeParams({
    ...base,
    print: { ...(base.print ?? {}), outputMode: 'sleeve' },
    insert: { ...(base.insert ?? {}), od: 40, ...insert },
  });

/** Validity from the builder, cross-checked with the independent sorting check. */
export function expectSoundSleeve(b: SleeveBuild, label = '') {
  const s = b.mesh.sleeve;
  expect(s.validity, label).toMatchObject({
    ok: true,
    badEdges: 0,
    flippedEdges: 0,
    degenerate: 0,
    badVertices: 0,
    bodies: 1,
  });
  expect(checkManifold(b.mesh).manifold, label).toBe(true);
  expect(signedVolume(b.mesh), label).toBeGreaterThan(0);
}
