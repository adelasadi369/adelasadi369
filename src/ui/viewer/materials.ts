import * as THREE from 'three';
import type { VaseParams } from '../../core/params/schema';

export interface LayerUniforms {
  uLayerH: { value: number };
  uLayers: { value: number };
  /** Dual-colour silk: the colour the surface shifts to with the viewing angle. */
  uColor2: { value: THREE.Color };
}

/** Gold plating look (sRGB). */
export const GOLD = '#d4a838';

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
    case 'dualSilk':
      Object.assign(m, { roughness: 0.3, metalness: 0.5, sheen: 0.6, clearcoat: 0.4, clearcoatRoughness: 0.35 });
      break;
    case 'gold':
      // the base under a partial plating is silk; the per-vertex mask (aMask) turns it into polished gold
      Object.assign(m, { roughness: 0.32, metalness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      break;
  }
  // the room environment lights metals and silk; matte stays close to the plain lights
  m.envMapIntensity = kind === 'gold' ? 1.1 : kind === 'silk' || kind === 'dualSilk' ? 0.7 : 0.3;
  const dual = kind === 'dualSilk';
  const gold = kind === 'gold';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLayerH = uniforms.uLayerH;
    shader.uniforms.uLayers = uniforms.uLayers;
    shader.uniforms.uColor2 = uniforms.uColor2;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vObjZ;\nattribute float aMask;\nvarying float vMask;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjZ = position.z;\nvMask = aMask;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vObjZ;\nvarying float vMask;\nuniform float uLayerH;\nuniform float uLayers;\nuniform vec3 uColor2;',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        gold
          ? `#include <metalnessmap_fragment>
        // gold plating where the curvature mask is on (edges and tips), or everywhere (mask = 1)
        metalnessFactor = mix(metalnessFactor, 1.0, vMask);
        roughnessFactor = mix(roughnessFactor, 0.2, vMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.62, 0.16), vMask);`
          : '#include <metalnessmap_fragment>',
      )
      .replace(
        '#include <normal_fragment_maps>',
        dual
          ? `#include <normal_fragment_maps>
        // dual-colour silk: the two coextruded colours show depending on which way the surface faces the eye
        float shift = smoothstep(-0.45, 0.45, dot(normal, normalize(vec3(0.85, 0.35, 0.2))));
        diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, shift);`
          : '#include <normal_fragment_maps>',
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

/**
 * Convexity mask for the "edges and tips" gold plating: per vertex the mean of n·(p − q) / |p − q|² over its edges
 * (≈ mean curvature, > 0 on ridges, rims, hole edges and tips), mapped to 0..1 and smoothed once over neighbours.
 */
export function curvatureMask(positions: Float32Array, normals: Float32Array, indices: Uint32Array): Float32Array {
  const V = positions.length / 3;
  const acc = new Float32Array(V);
  const cnt = new Uint16Array(V);
  const add = (a: number, b: number) => {
    const dx = positions[a * 3] - positions[b * 3];
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 < 1e-12) return;
    acc[a] += (normals[a * 3] * dx + normals[a * 3 + 1] * dy + normals[a * 3 + 2] * dz) / l2;
    cnt[a]++;
  };
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e];
      const b = indices[t + ((e + 1) % 3)];
      add(a, b);
      add(b, a);
    }
  const raw = new Float32Array(V);
  for (let v = 0; v < V; v++) {
    const k = cnt[v] ? acc[v] / cnt[v] : 0;
    // curvature radius ≲ 4 mm reads as an edge
    const u = Math.min(1, Math.max(0, (k - 0.08) / 0.22));
    raw[v] = u * u * (3 - 2 * u);
  }
  const out = new Float32Array(V);
  const n = new Uint16Array(V);
  for (let t = 0; t < indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e];
      out[a] += raw[indices[t + ((e + 1) % 3)]];
      n[a]++;
    }
  for (let v = 0; v < V; v++) out[v] = Math.max(raw[v], n[v] ? out[v] / n[v] : 0);
  return out;
}
