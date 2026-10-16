import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { buildProfile, profileKnots } from '../core/geometry/profile';
import { R_MIN } from '../core/geometry/field';
import { useStore } from '../state/store';
import { useT } from './hooks';

const W = 260;
const H = 220;
const PAD = 14;

/** 2D profile editor: mirrored silhouette, draggable control points for the custom profile. */
export function ProfileEditor() {
  const t = useT();
  const params = useStore((s) => s.params);
  const { setParam, endDrag, replace } = useStore.getState();
  const svg = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const custom = params.profile.preset === 'custom';
  const height = params.dimensions.height;
  const rm = params.dimensions.maxDiameter / 2;

  const { path, knots, scale } = useMemo(() => {
    const prof = buildProfile(params, R_MIN);
    const N = 120;
    const samples: [number, number][] = [];
    let maxR = 1;
    const { flare, flareZone } = params.rim;
    for (let k = 0; k <= N; k++) {
      const tt = k / N;
      let r = prof.R(tt);
      const zone = flareZone / 100;
      if (flare && zone > 0 && tt > 1 - zone) r += flare * ((tt - (1 - zone)) / zone) ** 2;
      samples.push([tt, r]);
      maxR = Math.max(maxR, r);
    }
    const ks = profileKnots(params);
    for (const k of ks) maxR = Math.max(maxR, k.r);
    const sc = Math.min((W / 2 - PAD) / maxR, (H - 2 * PAD) / height);
    const X = (r: number, side: 1 | -1) => W / 2 + side * r * sc;
    const Y = (tt: number) => H - PAD - tt * height * sc;
    const right = samples.map(([tt, r]) => `${X(r, 1)},${Y(tt)}`);
    const left = samples.map(([tt, r]) => `${X(r, -1)},${Y(tt)}`).reverse();
    return { path: `M${right.join('L')}L${left.join('L')}Z`, knots: ks, scale: sc };
  }, [params, height]);

  const Y = (tt: number) => H - PAD - tt * height * scale;
  const X = (r: number) => W / 2 + r * scale;

  const toCustom = () => {
    let pts = knots.slice(0, 12);
    const maxR = Math.max(...pts.map((k) => k.r));
    const newRm = Math.min(125, Math.max(rm, maxR));
    pts = pts.map((k) => ({ ...k, r: k.r }));
    replace({
      ...params,
      dimensions: { ...params.dimensions, maxDiameter: Math.round(newRm * 2 * 2) / 2 },
      profile: {
        ...params.profile,
        preset: 'custom',
        controlPoints: pts.map((k) => ({
          t: Math.round(k.t * 1000) / 10,
          r: Math.min(1, Math.max(0.05, k.r / newRm)),
          sharp: !!k.sharp,
        })),
      },
    });
  };

  const onMove = (e: PointerEvent) => {
    if (drag === null || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const py = ((e.clientY - box.top) / box.height) * H;
    const pts = params.profile.controlPoints.map((p) => ({ ...p }));
    const last = pts.length - 1;
    const tt =
      drag === 0 ? 0 : drag === last ? 100 : Math.min(99.5, Math.max(0.5, ((H - PAD - py) / scale / height) * 100));
    const r = Math.min(1, Math.max(0.05, Math.abs(px - W / 2) / scale / rm));
    pts[drag] = { ...pts[drag], t: Math.round(tt * 10) / 10, r: Math.round(r * 1000) / 1000 };
    if (drag > 0 && drag < last) {
      pts[drag].t = Math.min(pts[drag + 1].t - 0.5, Math.max(pts[drag - 1].t + 0.5, pts[drag].t));
    }
    setParam('profile.controlPoints', pts, { transient: true });
  };

  const addPoint = () => {
    const pts = params.profile.controlPoints;
    if (pts.length >= 12) return;
    let gi = 0;
    for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1].t - pts[i].t > pts[gi + 1].t - pts[gi].t) gi = i;
    const np = { t: (pts[gi].t + pts[gi + 1].t) / 2, r: (pts[gi].r + pts[gi + 1].r) / 2, sharp: false };
    setParam('profile.controlPoints', [...pts.slice(0, gi + 1), np, ...pts.slice(gi + 1)]);
  };
  const editSel = (fn: 'sharp' | 'delete') => {
    if (sel === null) return;
    const pts = params.profile.controlPoints;
    if (fn === 'delete') {
      if (pts.length <= 3 || sel === 0 || sel === pts.length - 1) return;
      setParam(
        'profile.controlPoints',
        pts.filter((_, i) => i !== sel),
      );
      setSel(null);
    } else
      setParam(
        'profile.controlPoints',
        pts.map((p, i) => (i === sel ? { ...p, sharp: !p.sharp } : p)),
      );
  };

  return (
    <div className="my-2 rounded-xl border border-line bg-paper p-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto block w-full max-w-[300px] touch-none select-none"
        onPointerMove={onMove}
        onPointerUp={() => {
          if (drag !== null) endDrag();
          setDrag(null);
        }}
      >
        <line x1={W / 2} x2={W / 2} y1={PAD - 6} y2={H - PAD + 4} stroke="#d8d1c6" strokeDasharray="3 3" />
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="#d8d1c6" />
        <path d={path} fill="#efe3d8" stroke="var(--color-accent)" strokeWidth={1.5} />
        {(custom
          ? params.profile.controlPoints.map((p) => ({ t: p.t / 100, r: p.r * rm, sharp: p.sharp }))
          : knots
        ).map((k, i) => (
          <g key={i}>
            {custom && (
              <circle
                cx={X(k.r)}
                cy={Y(k.t)}
                r={10}
                fill="transparent"
                className="cursor-grab"
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setDrag(i);
                  setSel(i);
                }}
              />
            )}
            {k.sharp ? (
              <rect
                x={X(k.r) - 4}
                y={Y(k.t) - 4}
                width={8}
                height={8}
                fill={sel === i ? 'var(--color-accent)' : '#fff'}
                stroke="var(--color-accent)"
                pointerEvents="none"
              />
            ) : (
              <circle
                cx={X(k.r)}
                cy={Y(k.t)}
                r={custom ? 4.5 : 2.5}
                fill={custom ? (sel === i ? 'var(--color-accent)' : '#fff') : 'var(--color-accent)'}
                stroke="var(--color-accent)"
                pointerEvents="none"
              />
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
        {!custom ? (
          <button
            type="button"
            onClick={toCustom}
            className="rounded-md border border-line bg-card px-2 py-1 hover:border-accent"
          >
            ✎ {t('btn.editPoints')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={addPoint}
              className="rounded-md border border-line bg-card px-2 py-1 hover:border-accent"
            >
              + {t('btn.addPoint')}
            </button>
            <button
              type="button"
              disabled={sel === null}
              onClick={() => editSel('sharp')}
              className="rounded-md border border-line bg-card px-2 py-1 disabled:opacity-40"
            >
              ◇
            </button>
            <button
              type="button"
              disabled={sel === null}
              onClick={() => editSel('delete')}
              className="rounded-md border border-line bg-card px-2 py-1 disabled:opacity-40"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
