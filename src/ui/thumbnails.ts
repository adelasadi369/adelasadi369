import * as THREE from 'three';
import type { VaseParams } from '../core/params/schema';
import { previewWorker } from '../state/engine';

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let queue = Promise.resolve();

/** Renders a small PNG of a design with a shared offscreen renderer (cached per key). */
export function thumbnail(key: string, params: VaseParams): Promise<string> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const mesh = await previewWorker.thumbnail(params);
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(200, 240, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9ae9f', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(150, 300, 250);
    scene.add(sun);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const mat = new THREE.MeshStandardMaterial({
      color: params.render.color,
      roughness: 0.6,
      metalness: params.render.viewMaterial === 'silk' ? 0.4 : 0,
    });
    const obj = new THREE.Mesh(geo, mat);
    obj.rotation.x = -Math.PI / 2;
    scene.add(obj);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const h = mesh.height;
    const w = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
    const cam = new THREE.PerspectiveCamera(28, 200 / 240, 1, 5000);
    const d = Math.max(h / 0.5, w / 0.42) * 1.05;
    cam.position.set(0, h * 0.75, d);
    cam.lookAt(0, h * 0.47, 0);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    geo.dispose();
    mat.dispose();
    cache.set(key, url);
    return url;
  });
  queue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}
