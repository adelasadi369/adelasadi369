import { buildMesh } from '../../src/core/geometry/mesh';
import { PRESETS } from '../../src/presets';
import { hashBuffer } from '../helpers';

export interface VaseGoldenEntry {
  quality: string;
  outputMode: string;
  vertexCount: number;
  triangleCount: number;
  /** FNV-1a (32-bit) over the bytes of the Float32 position buffer. */
  positionsFnv1a: string;
}

export interface VaseGolden {
  description: string;
  presets: Record<string, VaseGoldenEntry>;
}

export const GOLDEN_DESCRIPTION =
  'Golden mesh fingerprints of every vase preset at its preview quality. ' +
  'Must stay unchanged through the sleeve phases unless a change is intentional and documented. ' +
  'Regenerate with `npm run golden`.';

/** Build every preset exactly as the viewer does on release (its own output mode, render.previewQuality). */
export function computeVaseGolden(): VaseGolden {
  const presets: Record<string, VaseGoldenEntry> = {};
  for (const preset of PRESETS) {
    const quality = preset.params.render.previewQuality;
    const { mesh } = buildMesh(preset.params, quality);
    presets[preset.id] = {
      quality,
      outputMode: preset.params.print.outputMode,
      vertexCount: mesh.vertexCount,
      triangleCount: mesh.triangleCount,
      positionsFnv1a: hashBuffer(mesh.positions),
    };
  }
  return { description: GOLDEN_DESCRIPTION, presets };
}
