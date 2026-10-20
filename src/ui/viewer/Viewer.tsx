import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { boreBottom, usesBore } from '../../core/insert';
import { bedSize, VIEW_MATERIAL_LABELS, VIEW_MATERIALS } from '../../core/params/schema';
import { useStore } from '../../state/store';
import type { MeshPayload } from '../../workers/protocol';
import { useNum, useT } from '../hooks';
import { curvatureMask, GOLD, heatmapColors, makeMaterial, type LayerUniforms } from './materials';
import { snapshot } from './snapshot';

/** Model is Z-up (mm); the scene is Y-up, so the vase group is rotated −90° about X. */
const Z_UP: [number, number, number] = [-Math.PI / 2, 0, 0];

type Look = (typeof VIEW_MATERIALS)[number];

function useGeometry(mesh: MeshPayload | null, heat: boolean, limit: number, look: Look, goldMask: string) {
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
  // gold plating mask: everywhere, or edges and tips from the surface curvature
  useEffect(() => {
    if (!mesh || look !== 'gold') {
      geo.deleteAttribute('aMask');
      return;
    }
    const mask =
      goldMask === 'whole'
        ? new Float32Array(mesh.positions.length / 3).fill(1)
        : curvatureMask(mesh.positions, mesh.normals, mesh.indices);
    geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
  }, [geo, mesh, look, goldMask]);
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
  const { gl, invalidate } = useThree();
  const heat = viewer.heatmap;
  // The heatmap reads best on a matte surface regardless of the chosen look.
  const look = heat ? 'matte' : params.render.viewMaterial;
  const geo = useGeometry(mesh, heat, params.print.maxOverhang, look, params.render.goldMask);
  const uniforms = useMemo<LayerUniforms>(
    () => ({ uLayerH: { value: 0.24 }, uLayers: { value: 0 }, uColor2: { value: new THREE.Color() } }),
    [],
  );
  const material = useMemo(() => makeMaterial(look, uniforms), [look, uniforms]);
  useEffect(() => () => material.dispose(), [material]);
  const height = mesh?.height ?? params.dimensions.height;
  const { layerHeight } = params.print;
  const { color, color2, goldMask } = params.render;
  const { layers, clip } = viewer;
  useEffect(() => {
    uniforms.uLayerH.value = layerHeight;
    uniforms.uLayers.value = layers ? 1 : 0;
    material.vertexColors = heat;
    material.color.set(heat ? '#ffffff' : look === 'gold' && goldMask === 'whole' ? GOLD : color);
    uniforms.uColor2.value.set(color2);
    gl.localClippingEnabled = true;
    material.clippingPlanes = clip === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), clip * height)];
    material.needsUpdate = true;
  }, [uniforms, material, gl, heat, look, color, color2, goldMask, layerHeight, layers, clip, height]);
  // on-demand rendering: the effects above mutate three objects directly, so ask for a frame after every render
  useEffect(() => invalidate());
  return <mesh geometry={geo} material={material} rotation={Z_UP} castShadow receiveShadow />;
}

function Bed() {
  const print = useStore((s) => s.params.print);
  const bed = bedSize(print);
  return (
    <group userData={{ noSnapshot: true }}>
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
  const boreD = useStore((s) => s.result?.report.stats.boreDiameter);
  const { maxR, zAtMax } = useMemo(() => extent(mesh), [mesh]);
  if (!mesh) return null;
  const h = mesh.height;
  const x = maxR + 14;
  const label = 'rounded bg-white/90 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink shadow';
  return (
    <group userData={{ noSnapshot: true }}>
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
      {boreD !== undefined && (
        <>
          <Line
            points={Array.from(
              { length: 97 },
              (_, i) =>
                [Math.cos((i / 48) * Math.PI) * (boreD / 2), h + 0.5, Math.sin((i / 48) * Math.PI) * (boreD / 2)] as [
                  number,
                  number,
                  number,
                ],
            )}
            color="#2f6f8f"
            lineWidth={1.5}
          />
          <Html position={[0, h + 6, 0]} center zIndexRange={[10, 0]}>
            <div className={label}>
              {t('insert.bore')} {num(boreD, 2, true)} {t('unit.mm')}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/**
 * Render-only tube insert (S4): clear glass with transmission, or brushed steel. It sits on the bore bottom
 * (the bed for an open bottom) and is never part of any export.
 */
function Insert() {
  const insert = useStore((s) => s.params.insert);
  const { invalidate } = useThree();
  const steel = insert.type === 'steel';
  const geo = useMemo(() => {
    // hollow tube: lathe of the wall section (outer radius = OD/2, glass wall 1.6 mm, steel 1 mm)
    const ro = insert.od / 2;
    const ri = ro - (steel ? 1 : 1.6);
    const h = insert.length;
    const pts = [
      new THREE.Vector2(ri, 0),
      new THREE.Vector2(ro, 0),
      new THREE.Vector2(ro, h),
      new THREE.Vector2(ri, h),
      new THREE.Vector2(ri, 0),
    ];
    return new THREE.LatheGeometry(pts, 96);
  }, [insert.od, insert.length, steel]);
  const material = useMemo(
    () =>
      steel
        ? new THREE.MeshPhysicalMaterial({ color: '#c8ccd2', metalness: 1, roughness: 0.34, envMapIntensity: 1.2 })
        : new THREE.MeshPhysicalMaterial({
            color: '#ffffff',
            metalness: 0,
            roughness: 0.04,
            transmission: 1,
            thickness: 1.6,
            ior: 1.5,
            envMapIntensity: 1,
            transparent: true,
            opacity: 0.6,
          }),
    [steel],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => invalidate());
  // scene is Y-up and the lathe runs along Y: the tube rests on the bore bottom (lip / floor top), or on the bed
  return <mesh geometry={geo} material={material} position={[0, boreBottom(insert), 0]} renderOrder={2} />;
}

/** Procedural room environment for reflections (no network): metals, glass and silk need something to mirror. */
function RoomEnv() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
}

/**
 * Square 1080 × 1080 PNG of the current view for social posts: bed, grid and dimension lines hidden, background
 * white or transparent, rendered at the canvas size × 2 and cropped to the centre square.
 */
function SnapshotRig() {
  const { gl, scene, camera, size } = useThree();
  useEffect(() => {
    snapshot.take = (bg) => {
      const hidden: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o.userData.noSnapshot && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      });
      const prevBg = scene.background;
      const prevRatio = gl.getPixelRatio();
      const prevClear = gl.getClearAlpha();
      scene.background = bg === 'white' ? new THREE.Color('#ffffff') : null;
      gl.setClearAlpha(0);
      gl.setPixelRatio(2);
      gl.render(scene, camera);
      const side = Math.min(size.width, size.height) * 2;
      const out = document.createElement('canvas');
      out.width = out.height = 1080;
      const ctx = out.getContext('2d')!;
      const src = gl.domElement;
      ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 1080, 1080);
      const url = out.toDataURL('image/png');
      for (const o of hidden) o.visible = true;
      scene.background = prevBg;
      gl.setPixelRatio(prevRatio);
      gl.setClearAlpha(prevClear);
      gl.render(scene, camera);
      return url;
    };
    return () => {
      snapshot.take = null;
    };
  }, [gl, scene, camera, size]);
  return null;
}

function CameraRig({ height }: { height: number }) {
  const controls = useRef<OrbitImpl>(null);
  const { camera, invalidate } = useThree();
  const last = useRef(0);
  useEffect(() => {
    if (Math.abs(last.current - height) < 25) return;
    last.current = height;
    const d = height * 2.4 + 80;
    camera.position.set(d * 0.55, height * 0.75, d * 0.8);
    controls.current?.target.set(0, height * 0.45, 0);
    controls.current?.update();
    invalidate();
  }, [camera, height, invalidate]);
  return <OrbitControls ref={controls} makeDefault enableDamping maxPolarAngle={Math.PI * 0.55} />;
}

function Toolbar() {
  const t = useT();
  const viewer = useStore((s) => s.viewer);
  const setViewer = useStore((s) => s.setViewer);
  const render = useStore((s) => s.params.render);
  const name = useStore((s) => s.params.name);
  const bore = useStore((s) => usesBore(s.params));
  const lang = useStore((s) => s.lang);
  const setParam = useStore((s) => s.setParam);
  const [snapBg, setSnapBg] = useState<'white' | 'transparent'>('white');
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
      {bore && (
        <button type="button" className={chip(viewer.insert)} onClick={() => setViewer({ insert: !viewer.insert })}>
          {t('viewer.insert')}
        </button>
      )}
      <select
        className="rounded-full border border-line bg-white/80 px-2 py-1 text-xs"
        value={render.viewMaterial}
        onChange={(e) => setParam('render.viewMaterial', e.target.value)}
        aria-label={t('viewer.material')}
      >
        {VIEW_MATERIALS.map((m) => (
          <option key={m} value={m}>
            {VIEW_MATERIAL_LABELS[m][lang]}
          </option>
        ))}
      </select>
      {render.viewMaterial === 'gold' && (
        <select
          className="rounded-full border border-line bg-white/80 px-2 py-1 text-xs"
          value={render.goldMask}
          onChange={(e) => setParam('render.goldMask', e.target.value)}
          aria-label={t('viewer.goldMask')}
        >
          <option value="edges">{t('viewer.goldEdges')}</option>
          <option value="whole">{t('viewer.goldWhole')}</option>
        </select>
      )}
      <label className="flex items-center gap-1 rounded-full border border-line bg-white/80 px-2 py-0.5 text-xs">
        <input
          type="color"
          value={render.color}
          onChange={(e) => setParam('render.color', e.target.value)}
          className="h-5 w-5 cursor-pointer border-0 bg-transparent"
        />
        {t('viewer.color')}
      </label>
      {render.viewMaterial === 'dualSilk' && (
        <label className="flex items-center gap-1 rounded-full border border-line bg-white/80 px-2 py-0.5 text-xs">
          <input
            type="color"
            value={render.color2}
            onChange={(e) => setParam('render.color2', e.target.value)}
            className="h-5 w-5 cursor-pointer border-0 bg-transparent"
          />
          {t('viewer.color2')}
        </label>
      )}
      <span className="flex items-center gap-0.5 rounded-full border border-line bg-white/80 px-1 py-0.5 text-xs">
        <select
          className="bg-transparent px-1"
          value={snapBg}
          onChange={(e) => setSnapBg(e.target.value as 'white' | 'transparent')}
          aria-label={t('viewer.snapshotBg')}
        >
          <option value="white">{t('viewer.bgWhite')}</option>
          <option value="transparent">{t('viewer.bgTransparent')}</option>
        </select>
        <button
          type="button"
          className="rounded-full px-1.5 hover:text-accent"
          onClick={() => {
            const url = snapshot.take?.(snapBg);
            if (!url) return;
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(name || 'vaseforge').replace(/[^\p{L}\p{N}]+/gu, '-')}.png`;
            a.click();
          }}
        >
          {t('viewer.snapshot')}
        </button>
      </span>
    </div>
  );
}

export function Viewer() {
  const result = useStore((s) => s.result);
  const dims = useStore((s) => s.viewer.dims);
  const showInsert = useStore((s) => s.viewer.insert);
  const bore = useStore((s) => usesBore(s.params));
  const t = useT();
  const num = useNum();
  const mesh = result?.mesh ?? null;
  const height = mesh?.height ?? 180;
  return (
    <div className="relative h-full w-full bg-gradient-to-b from-[#f3efe9] to-[#e4ddd2]">
      <Canvas
        frameloop="demand"
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
        <RoomEnv />
        <SnapshotRig />
        {bore && showInsert && <Insert />}
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
          {num(mesh.triangleCount)} △ ·{' '}
          {mesh.voxel !== undefined
            ? `${t('viewer.voxel')} ${num(mesh.voxel, 1)} ${t('unit.mm')}`
            : `${num(mesh.nTheta)}×${num(mesh.nZ)}`}{' '}
          · {t('viewer.regen')} {num(mesh.ms, 0)} ms
        </div>
      )}
    </div>
  );
}
