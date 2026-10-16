import * as THREE from 'three';
import type { VaseParams } from '../../core/params/schema';

export interface LayerUniforms {
  uLayerH: { value: number };
  uLayers: { value: number };
}

/** Physical material per viewer preset, with an injected layer-line shader (object-space z). */
export function makeMaterial(
  kind: VaseParams['render']['viewMaterial'],
  uniforms: LayerUniforms,
): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
  switch (kind) {
    case 'matte':
      Object.assign(m, { roughness: 0.82, metalness: 0 });
      break;
    case 'silk':
      Object.assign(m, { roughness: 0.32, metalness: 0.55, sheen: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.4 });
      break;
    case 'gloss':
      Object.assign(m, { roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
      break;
    case 'translucent':
      Object.assign(m, { roughness: 0.35, metalness: 0, transmission: 0.55, thickness: 2.5, ior: 1.45 });
      break;
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLayerH = uniforms.uLayerH;
    shader.uniforms.uLayers = uniforms.uLayers;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vObjZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjZ = position.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vObjZ;\nuniform float uLayerH;\nuniform float uLayers;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uLayers > 0.5) {
          float u = vObjZ / uLayerH;
          float w = fwidth(u);
          float line = 1.0 - smoothstep(0.0, max(w, 0.08), abs(fract(u) - 0.5) * 2.0 - 0.6);
          float vis = 1.0 - smoothstep(0.25, 0.6, w);
          diffuseColor.rgb *= 1.0 - 0.28 * line * vis;
        }
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;`,
      );
  };
  m.customProgramCacheKey = () => `vf-${kind}`;
  return m;
}

/** Green ≤ limit, yellow ≤ limit+10°, red above; caps/rims neutral. */
export function heatmapColors(overhang: Float32Array, limit: number): Float32Array {
  const c = new Float32Array(overhang.length * 3);
  for (let i = 0; i < overhang.length; i++) {
    const a = overhang[i];
    let r: number, g: number, b: number;
    if (a < 0) [r, g, b] = [0.78, 0.76, 0.72];
    else if (a <= limit) {
      const u = a / Math.max(1, limit);
      [r, g, b] = [0.25 + 0.35 * u, 0.62 + 0.1 * u, 0.36 - 0.1 * u];
    } else if (a <= limit + 10) [r, g, b] = [0.93, 0.74, 0.18];
    else [r, g, b] = [0.84, 0.24, 0.2];
    c[i * 3] = r;
    c[i * 3 + 1] = g;
    c[i * 3 + 2] = b;
  }
  return c;
}
