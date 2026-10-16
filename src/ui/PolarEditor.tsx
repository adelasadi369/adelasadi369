import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { makeSection } from '../core/geometry/sections';
import { useStore } from '../state/store';
import { useT } from './hooks';

const S = 240;
const C = S / 2;
const RAD = S / 2 - 14;

/** Polar section editor: draw one sector, it repeats k times around ("windmill"). */
export function PolarEditor({ which }: { which: 'bottom' | 'top' }) {
  const t = useT();
  const sec = useStore((s) => s.params.section[which]);
  const { setParam, endDrag } = useStore.getState();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const k = sec.custom.symmetry;
  const sector = (2 * Math.PI) / k;
  const pts = sec.custom.points;
  const base = `section.${which}.custom`;

  const outline = useMemo(() => {
    const f = makeSection({ ...sec, aspectXY: 1 });
    const N = 360;
    return Array.from({ length: N }, (_, i) => {
      const th = (2 * Math.PI * i) / N;
      const r = f(th, 0) * RAD;
      return `${C + r * Math.cos(th)},${C - r * Math.sin(th)}`;
    }).join(' ');
  }, [sec]);

  const toXY = (a: number, r: number) => {
    const th = a * sector;
    return [C + r * RAD * Math.cos(th), C - r * RAD * Math.sin(th)];
  };

  const onMove = (e: PointerEvent) => {
    if (drag === null || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * S - C;
    const y = C - ((e.clientY - box.top) / box.height) * S;
    let th = Math.atan2(y, x);
    if (th < 0) th += 2 * Math.PI;
    const lo = drag > 0 ? pts[drag - 1].a + 0.01 : 0;
    const hi = drag < pts.length - 1 ? pts[drag + 1].a - 0.01 : 0.999;
    const a = Math.min(hi, Math.max(lo, th / sector));
    const r = Math.min(1, Math.max(0.2, Math.hypot(x, y) / RAD));
    const next = pts.map((p, i) =>
      i === drag ? { a: Math.round(a * 1000) / 1000, r: Math.round(r * 1000) / 1000 } : p,
    );
    setParam(`${base}.points`, next, { transient: true });
  };

  const add = () => {
    if (pts.length >= 24) return;
    let gi = pts.length - 1;
    let gap = 1 - pts[gi].a + pts[0].a;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i + 1].a - pts[i].a > gap) {
        gap = pts[i + 1].a - pts[i].a;
        gi = i;
      }
    }
    const a = gi === pts.length - 1 ? (pts[gi].a + 1) / 2 : (pts[gi].a + pts[gi + 1].a) / 2;
    const np = { a: Math.min(0.999, a), r: 0.8 };
    setParam(
      `${base}.points`,
      [...pts, np].sort((p, q) => p.a - q.a),
    );
  };

  return (
    <div className="my-2 rounded-xl border border-line bg-paper p-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${S} ${S}`}
        className="mx-auto block w-full max-w-[260px] touch-none select-none"
        onPointerMove={onMove}
        onPointerUp={() => {
          if (drag !== null) endDrag();
          setDrag(null);
        }}
      >
        <circle cx={C} cy={C} r={RAD} fill="none" stroke="#e2dbd0" strokeDasharray="3 3" />
        <path
          d={`M${C},${C} L${C + RAD},${C} A${RAD},${RAD} 0 ${sector > Math.PI ? 1 : 0} 0 ${C + RAD * Math.cos(sector)},${C - RAD * Math.sin(sector)} Z`}
          fill="var(--color-accent-soft)"
          opacity={0.7}
        />
        <polygon points={outline} fill="#efe3d8" fillOpacity={0.6} stroke="var(--color-accent)" strokeWidth={1.5} />
        {pts.map((p, i) => {
          const [x, y] = toXY(p.a, p.r);
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r={11}
                fill="transparent"
                className="cursor-grab"
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setDrag(i);
                  setSel(i);
                }}
              />
              <circle
                cx={x}
                cy={y}
                r={4.5}
                fill={sel === i ? 'var(--color-accent)' : '#fff'}
                stroke="var(--color-accent)"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
      <div className="flex gap-1.5 pt-1 text-xs">
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-line bg-card px-2 py-1 hover:border-accent"
        >
          + {t('btn.addPoint')}
        </button>
        <button
          type="button"
          disabled={sel === null || pts.length <= 3}
          onClick={() => {
            setParam(
              `${base}.points`,
              pts.filter((_, i) => i !== sel),
            );
            setSel(null);
          }}
          className="rounded-md border border-line bg-card px-2 py-1 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
