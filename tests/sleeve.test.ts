import { describe, expect, it } from 'vitest';
import { buildSleeveMesh, DRAG_VOXEL } from '../src/core/sleeve';
import { PRESETS } from '../src/presets';
import { hashBuffer, slice } from './helpers';
import { expectSoundSleeve, sleeveParams } from './sleeveHelpers';

describe('sleeve engine', () => {
  it('is deterministic: same params ⇒ identical buffers', () => {
    const p = sleeveParams(PRESETS[1].params);
    const a = buildSleeveMesh(p, DRAG_VOXEL).mesh;
    const b = buildSleeveMesh(structuredClone(p), DRAG_VOXEL).mesh;
    expect(hashBuffer(a.positions)).toBe(hashBuffer(b.positions));
    expect(hashBuffer(a.indices)).toBe(hashBuffer(b.indices));
  });

  it('every preset builds one valid body at the drag voxel, first lattice', () => {
    for (const preset of PRESETS) {
      const b = buildSleeveMesh(sleeveParams(preset.params), DRAG_VOXEL);
      expectSoundSleeve(b, preset.id);
      expect(b.mesh.sleeve.retried, preset.id).toBe(false);
    }
  });

  it('the shifted retry lattice also builds a valid body', () => {
    expectSoundSleeve(buildSleeveMesh(sleeveParams(PRESETS[4].params), DRAG_VOXEL, { offsetIndex: 1 }));
  });

  it('floor bottom: no hole at the axis, watertight', () => {
    const p = sleeveParams({}, { bottom: 'floor', floorThickness: 2 });
    const b = buildSleeveMesh(p, 1);
    expectSoundSleeve(b);
    // the field is material on the axis through the floor, and the bore starts above it
    for (const z of [0.3, 1, 1.7]) expect(b.sdf.at(0, 0, z)).toBeLessThan(0);
    expect(b.sdf.at(0, 0, 3)).toBeGreaterThan(0);
    // a slice through the floor is one solid disc (one contour), above it an annulus (two)
    expect(slice(b.mesh, 1).loops.length).toBe(1);
    expect(slice(b.mesh, 10).loops.length).toBe(2);
    expect(b.mesh.sleeve.holeVertices.length).toBe(0);
  });

  it('lip and drain bottoms leave an exact opening; open bottom has none below the bore', () => {
    for (const [bottom, extra] of [
      ['lip', { lipWidth: 3 }],
      ['drain', { drainDiameter: 10 }],
    ] as const) {
      const b = buildSleeveMesh(sleeveParams({}, { bottom, ...extra }), 1);
      expectSoundSleeve(b, bottom);
      const r = bottom === 'lip' ? b.sdf.R - 3 : 5;
      const P = b.mesh.positions;
      expect(b.mesh.sleeve.holeVertices.length).toBeGreaterThan(0);
      for (const v of b.mesh.sleeve.holeVertices) expect(Math.hypot(P[v * 3], P[v * 3 + 1])).toBeCloseTo(r, 4);
      expect(slice(b.mesh, 0.8).loops.length).toBe(2);
    }
  });
});
