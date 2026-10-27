import { useMemo, useRef, useState } from 'react';
import { applySilhouette } from '../ai/apply';
import { polylinesToPolar, type Pt } from '../core/geometry/svgPolar';
import { encodeShapes } from '../core/motif/blob';
import { polylinesToProfile } from '../core/motif/silhouette';
import { setPath } from '../core/params/paths';
import { useStore } from '../state/store';
import { parseSvg, type SvgParseResult } from '../svg/parse';
import { useT, useTxt } from './hooks';
import { MOTIF_PATHS, motifVisible } from './motifPaths';

type Use = 'section' | 'silhouette' | 'pattern';

/** Bounding box of parsed polylines (SVG units). */
function bbox(r: SvgParseResult) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; // prettier-ignore
  for (const p of r.polylines)
    for (let k = 0; k < p.pts.length; k += 2) {
      x0 = Math.min(x0, p.pts[k]);
      x1 = Math.max(x1, p.pts[k]);
      y0 = Math.min(y0, p.pts[k + 1]);
      y1 = Math.max(y1, p.pts[k + 1]);
    }
  return { x0, y0, w: Math.max(1e-9, x1 - x0), h: Math.max(1e-9, y1 - y0) };
}

/**
 * SVG import (both modes): the file is parsed as data only (src/svg/parse.ts: no DOM, scripts / images / references
 * dropped) and used as a cross-section, a silhouette, or a pattern (relief, or sleeve openings). Only the result
 * reaches params: polar samples, profile points, or the compressed polyline blob.
 */
function SvgImport() {
  const t = useT();
  const txt = useTxt();
  const params = useStore((s) => s.params);
  const replace = useStore((s) => s.replace);
  const showToast = useStore((s) => s.showToast);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; res: SvgParseResult } | null>(null);
  const [use, setUse] = useState<Use>('pattern');
  const [centre, setCentre] = useState<Pt | null>(null);
  const [msg, setMsg] = useState<{ kind: 'err' | 'warn'; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const box = useMemo(() => (file ? bbox(file.res) : null), [file]);

  const load = async (f: File) => {
    setMsg(null);
    setCentre(null);
    if (f.size > 5_000_000) return setMsg({ kind: 'err', text: t('svg.tooBig') });
    const res = parseSvg(await f.text());
    if (!res.polylines.length) return setMsg({ kind: 'err', text: t('svg.empty') });
    setFile({ name: f.name.slice(0, 120), res });
    const dropped = Object.keys(res.dropped).filter((k) => !['title', 'desc', 'metadata', 'defs'].includes(k));
    if (dropped.length) setMsg({ kind: 'warn', text: `${t('svg.dropped')} ${dropped.join(', ')}` });
  };

  const apply = () => {
    if (!file) return;
    const polys = file.res.polylines;
    if (use === 'section') {
      const pts = polys
        .filter((p) => p.closed)
        .map((p) => {
          const out: Pt[] = [];
          for (let k = 0; k < p.pts.length; k += 2) out.push([p.pts[k], p.pts[k + 1]]);
          return out;
        });
      const r = polylinesToPolar(pts, 720, centre ?? undefined);
      if (!r.ok) return setMsg({ kind: 'err', text: txt(r.message) });
      let p = params;
      for (const w of ['bottom', 'top'] as const) {
        p = setPath(p, `section.${w}.shape`, 'svg');
        p = setPath(p, `section.${w}.svg`, { name: file.name, samples: r.samples });
      }
      replace(p);
      setMsg(r.warning ? { kind: 'warn', text: txt(r.warning) } : null);
      showToast(t('svg.applied'));
    } else if (use === 'silhouette') {
      const r = polylinesToProfile(polys);
      if (!r.ok) return setMsg({ kind: 'err', text: txt(r.message) });
      replace(applySilhouette(r.points, r.heightToWidth, params));
      showToast(t('svg.applied'));
    } else {
      const enc = encodeShapes(polys);
      if (!enc.ok) return setMsg({ kind: 'err', text: t(enc.reason === 'empty' ? 'svg.empty' : 'svg.tooBig') });
      let p = setPath(params, 'motif.source', 'svg');
      p = setPath(p, 'motif.svg', { name: file.name, data: enc.data, hash: enc.hash, points: enc.points });
      replace(p);
      showToast(t('svg.applied'));
    }
  };

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (use !== 'section' || !box) return;
    const r = e.currentTarget.getBoundingClientRect();
    const s = Math.max(box.w, box.h) * 1.1;
    const x = box.x0 + box.w / 2 - s / 2 + ((e.clientX - r.left) / r.width) * s;
    const y = box.y0 + box.h / 2 - s / 2 + ((e.clientY - r.top) / r.height) * s;
    setCentre([x, y]);
  };

  const s = box ? Math.max(box.w, box.h) * 1.1 : 1;
  return (
    <div className="space-y-2 py-1">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void load(f);
        }}
        className={`flex items-center gap-3 rounded-xl border border-dashed p-2 ${drag ? 'border-accent bg-paper' : 'border-line'}`}
      >
        <input
          ref={input}
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])}
        />
        {box && file ? (
          <svg
            viewBox={`${box.x0 + box.w / 2 - s / 2} ${box.y0 + box.h / 2 - s / 2} ${s} ${s}`}
            className={`h-20 w-20 shrink-0 rounded-lg bg-white ${use === 'section' ? 'cursor-crosshair' : ''}`}
            onClick={pick}
            role="img"
            aria-label={file.name}
          >
            {file.res.polylines.map((p, i) => (
              <path
                key={i}
                d={`M${Array.from({ length: p.pts.length / 2 }, (_, k) => `${p.pts[2 * k]} ${p.pts[2 * k + 1]}`).join('L')}${p.closed ? 'Z' : ''}`}
                fill={p.closed ? '#d9cbb5' : 'none'}
                fillRule="evenodd"
                stroke="#3a3530"
                strokeWidth={s / 150}
              />
            ))}
            {centre && <circle cx={centre[0]} cy={centre[1]} r={s / 40} fill="#c0492b" />}
          </svg>
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-paper text-2xl text-muted">
            ⇪
          </div>
        )}
        <div className="min-w-0 text-xs leading-5">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-md border border-line bg-card px-3 py-1 text-sm hover:border-accent"
          >
            {t('svg.choose')}
          </button>
          <p className="mt-1 text-muted">{file ? `${file.name} · ${file.res.points} pts` : t('svg.drop')}</p>
        </div>
      </div>
      {file && (
        <>
          <div className="flex rounded-lg border border-line p-0.5 text-xs" role="radiogroup">
            {(['section', 'silhouette', 'pattern'] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={use === u}
                onClick={() => setUse(u)}
                className={`flex-1 rounded-md px-2 py-1 ${use === u ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}
              >
                {t(`svg.use.${u}`)}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-5 text-muted">{t(`svg.hint.${use}`)}</p>
          <button
            type="button"
            onClick={apply}
            className="w-full rounded-lg bg-ink px-3 py-1.5 text-sm text-white hover:bg-ink/85"
          >
            {t('svg.apply')}
          </button>
        </>
      )}
      {msg && (
        <p
          className={`rounded-lg p-2 text-xs leading-5 ${msg.kind === 'err' ? 'bg-[#fbeceb] text-err' : 'bg-[#fdf5e1] text-ink'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

let fontPromise: Promise<import('opentype.js').Font> | null = null;
/** Vazirmatn (OFL, public/fonts) parsed once, on first use; opentype.js is loaded lazily with it. */
function loadFont() {
  fontPromise ??= (async () => {
    const [{ default: opentype }, buf] = await Promise.all([
      import('opentype.js'),
      fetch(`${import.meta.env.BASE_URL}fonts/Vazirmatn-Regular.ttf`).then((r) => r.arrayBuffer()),
    ]);
    return opentype.parse(buf);
  })();
  return fontPromise;
}

/** Persian / Latin text → shaped outline (src/text/outline.ts) → the same motif blob as an SVG shape. */
function TextMotif() {
  const t = useT();
  const params = useStore((s) => s.params);
  const replace = useStore((s) => s.replace);
  const [value, setValue] = useState(params.motif.text.value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { textOutline } = await import('../text/outline');
      const polys = textOutline(await loadFont(), value.trim());
      const enc = encodeShapes(polys);
      if (!enc.ok) return setErr(t(enc.reason === 'empty' ? 'svg.empty' : 'svg.tooBig'));
      let p = setPath(params, 'motif.source', 'text');
      p = setPath(p, 'motif.text', { value: value.trim(), data: enc.data, hash: enc.hash, points: enc.points });
      if (params.motif.source !== 'text') p = setPath(p, 'motif.placement', 'single');
      replace(p);
    } catch {
      setErr(t('text.fontError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 py-1">
      <div className="flex gap-2">
        <input
          dir="auto"
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('text.placeholder')}
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={() => void apply()}
          className="rounded-md bg-ink px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {t('svg.apply')}
        </button>
      </div>
      <p className="text-[11px] leading-5 text-muted">{t('text.hint')}</p>
      {err && <p className="rounded-lg bg-[#fbeceb] p-2 text-xs text-err">{err}</p>}
    </div>
  );
}

/** Use the current motif: as relief (adds a Motif effect) or, on sleeves, as openings (hole pattern). */
function MotifUse() {
  const t = useT();
  const params = useStore((s) => s.params);
  const replace = useStore((s) => s.replace);
  if (params.motif.source === 'none') return null;
  const relief = params.effects.some((e) => e.type === 'motif');
  const sleeve = params.print.outputMode === 'sleeve';
  const holes = sleeve && params.sleeve.holes.mode === 'pattern';
  return (
    <div className="flex flex-wrap gap-2 py-1">
      <button
        type="button"
        disabled={relief}
        onClick={() =>
          replace(
            setPath(params, 'effects', [
              ...params.effects,
              { type: 'motif', relief: 'raised', depth: 1.2, softness: 1.2 },
            ]),
          )
        }
        className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent disabled:opacity-40"
      >
        {relief ? `✓ ${t('motif.relief')}` : `+ ${t('motif.relief')}`}
      </button>
      {sleeve && (
        <button
          type="button"
          onClick={() => replace(setPath(params, 'sleeve.holes.mode', holes ? 'none' : 'pattern'))}
          className={`rounded-md border px-2.5 py-1 text-xs ${holes ? 'border-accent text-accent' : 'border-line hover:border-accent'}`}
        >
          {holes ? `✓ ${t('motif.holes')}` : `+ ${t('motif.holes')}`}
        </button>
      )}
      <p className="w-full text-[11px] leading-5 text-muted">{t('motif.useHint')}</p>
    </div>
  );
}

export function MotifPanelBody({ Params }: { Params: (props: { paths: string[] }) => React.ReactNode }) {
  const t = useT();
  const params = useStore((s) => s.params);
  return (
    <>
      <h4 className="mt-1 text-[11px] font-semibold text-muted">{t('group.svg')}</h4>
      <SvgImport />
      <h4 className="mt-2 text-[11px] font-semibold text-muted">{t('group.text')}</h4>
      <TextMotif />
      <h4 className="mt-2 text-[11px] font-semibold text-muted">{t('group.motif')}</h4>
      <Params paths={MOTIF_PATHS.filter((p) => motifVisible(p, params))} />
      <MotifUse />
    </>
  );
}
