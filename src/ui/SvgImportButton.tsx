import { useRef, useState } from 'react';
import { polylinesToPolar } from '../core/geometry/svgPolar';
import { useStore } from '../state/store';
import { useT, useTxt } from './hooks';
import { svgToPolylines } from './svgImport';

export function SvgImportButton({ which }: { which: 'bottom' | 'top' }) {
  const t = useT();
  const txt = useTxt();
  const name = useStore((s) => s.params.section[which].svg.name);
  const params = useStore((s) => s.params);
  const replace = useStore((s) => s.replace);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (f: File) => {
    const res = polylinesToPolar(svgToPolylines(await f.text()));
    if (!res.ok) return setError(txt(res.message));
    setError(null);
    const sec = {
      ...params.section[which],
      shape: 'svg' as const,
      svg: { name: f.name.slice(0, 120), samples: res.samples },
    };
    replace({ ...params, section: { ...params.section, [which]: sec } });
  };
  return (
    <div className="py-2">
      <input
        ref={input}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="rounded-md border border-line bg-card px-3 py-1.5 text-sm hover:border-accent"
      >
        ⇪ {t('svg.import')}
      </button>
      {name && <span className="ms-2 text-xs text-muted">{name}</span>}
      {error && <p className="mt-2 rounded-lg bg-[#fbeceb] p-2 text-xs leading-5 text-err">{error}</p>}
      <p className="mt-1 text-[11px] leading-5 text-muted">{t('svg.hint')}</p>
    </div>
  );
}
