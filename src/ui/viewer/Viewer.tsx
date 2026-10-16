import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { bedSize } from '../../core/params/schema';
import { useStore } from '../../state/store';
import type { MeshPayload } from '../../workers/protocol';
import { useNum, useT } from '../hooks';
import { heatmapColors, makeMaterial, type LayerUniforms } from './materials';

/** Model is Z-up (mm); the scene is Y-up, so the vase group is rotated −90° about X. */
const Z_UP: [number, number, number] = [-Math.PI / 2, 0, 0];

function useGeometry(mesh: MeshPayload | null, heat: boolean, limit: number) {
  const geo = useMemo(() => new THREE.BufferGeometry(), []);
  useEffect(() => {
    if (!mesh) return;
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeBoundingSphere();
  }, [geo, mesh]);
  useEffect(() => {
    if (!mesh) return;
    if (heat) geo.setAttribute('color', new THREE.BufferAttribute(heatmapColors(mesh.overhang, limit), 3));
    else geo.deleteAttribute('color');
  }, [geo, mesh, heat, limit]);
  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}

function extent(mesh: MeshPayload | null) {
  if (!mesh) return { maxR: 50, zAtMax: 50 };
  const P = mesh.positions;
  let maxR = 0;
  let zAt = 0;
  for (let i = 0; i < P.length; i += 3) {
    const r = P[i] * P[i] + P[i + 1] * P[i + 1];
    if (r > maxR) {
      maxR = r;
      zAt = P[i + 2];
    }
  }
  return { maxR: Math.sqrt(maxR), zAtMax: zAt };
}

function Vase({ mesh }: { mesh: MeshPayload | null }) {
  const params = useStore((s) => s.params);
  const viewer = useStore((s) => s.viewer);
  const { gl } = useThree();
  const heat = viewer.heatmap;
  const geo = useGeometry(mesh, heat, params.print.maxOverhang);
  const uniforms = useMemo<LayerUniforms>(() => ({ uLayerH: { value: 0.24 }, uLayers: { value: 0 } }), []);
  // The heatmap reads best on a matte surface regardless of the chosen look.
  const look = heat ? 'matte' : params.render.viewMaterial;
  const material = useMemo(() => makeMaterial(look, uniforms), [look, uniforms]);
  useEffect(() => () => material.dispose(), [material]);
  const height = mesh?.height ?? params.dimensions.height;
  const { layerHeight } = params.print;
  const { color } = params.render;
  const { layers, clip } = viewer;
  useEffect(() => {
    uniforms.uLayerH.value = layerHeight;
    uniforms.uLayers.value = layers ? 1 : 0;
    material.vertexColors = heat;
    material.color.set(heat ? '#ffffff' : color);
    gl.localClippingEnabled = true;
    material.clippingPlanes = clip === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), clip * height)];
    material.needsUpdate = true;
  }, [uniforms, material, gl, heat, color, layerHeight, layers, clip, height]);
  return <mesh geometry={geo} material={material} rotation={Z_UP} castShadow receiveShadow />;
}

function Bed() {
  const print = useStore((s) => s.params.print);
  const bed = bedSize(print);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[bed.bedX, bed.bedY]} />
        <meshStandardMaterial color="#e9e4dc" roughness={1} />
      </mesh>
      <gridHelper
        args={[Math.max(bed.bedX, bed.bedY), Math.round(Math.max(bed.bedX, bed.bedY) / 20), '#d6cfc4', '#e0d9cf']}
        position={[0, 0, 0]}
      />
    </group>
  );
}

function Dimensions({ mesh }: { mesh: MeshPayload | null }) {
  const num = useNum();
  const t = useT();
  const { maxR, zAtMax } = useMemo(() => extent(mesh), [mesh]);
  if (!mesh) return null;
  const h = mesh.height;
  const x = maxR + 14;
  const label = 'rounded bg-white/90 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink shadow';
  return (
    <group>
      <Line
        points={[
          [x, 0, 0],
          [x, h, 0],
        ]}
        color="#b4643c"
        lineWidth={1}
      />
      <Line
        points={[
          [x - 4, 0, 0],
          [x + 4, 0, 0],
        ]}
        color="#b4643c"
        lineWidth={1}
      />
      <Line
        points={[
          [x - 4, h, 0],
          [x + 4, h, 0],
        ]}
        color="#b4643c"
        lineWidth={1}
      />
      <Html position={[x + 4, h / 2, 0]} center={false} zIndexRange={[10, 0]}>
        <div className={label}>
          {num(h, 1)} {t('unit.mm')}
        </div>
      </Html>
      <Line
        points={Array.from(
          { length: 97 },
          (_, i) =>
            [Math.cos((i / 48) * Math.PI) * (maxR + 1.5), zAtMax, Math.sin((i / 48) * Math.PI) * (maxR + 1.5)] as [
              number,
              number,
              number,
            ],
        )}
        color="#b4643c"
        lineWidth={1}
        dashed
        dashSize={3}
        gapSize={2}
      />
      <Html position={[0, zAtMax, maxR + 2]} center zIndexRange={[10, 0]}>
        <div className={label}>
          Ø {num(2 * maxR, 1)} {t('unit.mm')}
        </div>
      </Html>
    </group>
  );
}

function CameraRig({ height }: { height: number }) {
  const controls = useRef<OrbitImpl>(null);
  const { camera } = useThree();
  const last = useRef(0);
  useEffect(() => {
    if (Math.abs(last.current - height) < 25) return;
    last.current = height;
    const d = height * 2.4 + 80;
    camera.position.set(d * 0.55, height * 0.75, d * 0.8);
    controls.current?.target.set(0, height * 0.45, 0);
    controls.current?.update();
  }, [camera, height]);
  return <OrbitControls ref={controls} makeDefault enableDamping maxPolarAngle={Math.PI * 0.55} />;
}

function Toolbar() {
  const t = useT();
  const viewer = useStore((s) => s.viewer);
  const setViewer = useStore((s) => s.setViewer);
  const render = useStore((s) => s.params.render);
  const setParam = useStore((s) => s.setParam);
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs backdrop-blur transition ${on ? 'border-accent bg-accent text-white' : 'border-line bg-white/80 hover:border-muted'}`;
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
      <button type="button" className={chip(viewer.heatmap)} onClick={() => setViewer({ heatmap: !viewer.heatmap })}>
        {t('viewer.heatmap')}
      </button>
      <button type="button" className={chip(viewer.layers)} onClick={() => setViewer({ layers: !viewer.layers })}>
        {t('viewer.layers')}
      </button>
      <button type="button" className={chip(viewer.dims)} onClick={() => setViewer({ dims: !viewer.dims })}>
        {t('viewer.dims')}
      </button>
      <button
        type="button"
        className={chip(viewer.clip !== null)}
        onClick={() => setViewer({ clip: viewer.clip === null ? 0.5 : null })}
      >
        {t('viewer.clip')}
      </button>
      {viewer.clip !== null && (
        <input
          type="range"
          min={0.02}
          max={1}
          step={0.005}
          value={viewer.clip}
          onChange={(e) => setViewer({ clip: Number(e.target.value) })}
          className="w-28"
          dir="ltr"
        />
      )}
      <select
        className="rounded-full border border-line bg-white/80 px-2 py-1 text-xs"
        value={render.viewMaterial}
        onChange={(e) => setParam('render.viewMaterial', e.target.value)}
        aria-label={t('viewer.material')}
      >
        {(['matte', 'silk', 'gloss', 'translucent'] as const).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 rounded-full border border-line bg-white/80 px-2 py-0.5 text-xs">
        <input
          type="color"
          value={render.color}
          onChange={(e) => setParam('render.color', e.target.value)}
          className="h-5 w-5 cursor-pointer border-0 bg-transparent"
        />
        {t('viewer.color')}
      </label>
    </div>
  );
}

export function Viewer() {
  const result = useStore((s) => s.result);
  const dims = useStore((s) => s.viewer.dims);
  const t = useT();
  const num = useNum();
  const mesh = result?.mesh ?? null;
  const height = mesh?.height ?? 180;
  return (
    <div className="relative h-full w-full bg-gradient-to-b from-[#f3efe9] to-[#e4ddd2]">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 32, near: 1, far: 5000, position: [300, 200, 400] }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <hemisphereLight args={['#ffffff', '#b9ae9f', 0.9]} />
        <directionalLight
          position={[180, 320, 220]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-200}
          shadow-camera-right={200}
          shadow-camera-top={200}
          shadow-camera-bottom={-200}
        />
        <directionalLight position={[-220, 120, -160]} intensity={0.6} />
        <Vase mesh={mesh} />
        {result?.saucer && <Vase mesh={result.saucer} />}
        <Bed />
        {dims && <Dimensions mesh={mesh} />}
        <CameraRig height={height} />
      </Canvas>
      <div className="pointer-events-none absolute inset-x-3 top-3 flex justify-between gap-2">
        <Toolbar />
      </div>
      {mesh && (
        <div className="pointer-events-none absolute bottom-3 rounded-full bg-white/80 px-3 py-1 text-[11px] text-muted shadow-sm ltr:left-3 rtl:right-3">
          {num(mesh.triangleCount)} △ · {num(mesh.nTheta)}×{num(mesh.nZ)} · {t('viewer.regen')} {num(mesh.ms, 0)} ms
        </div>
      )}
    </div>
  );
}
