import { useEffect, useRef, useState } from 'react';
import { aiHealth } from '../ai/client';
import { useStore } from '../state/store';
import { useT, useTxt } from './hooks';
import { extractSilhouette, type Silhouette } from './silhouette';
import { thumbnail } from './thumbnails';

const EXAMPLES = {
  fa: [
    'گلدان لاله‌ای با دنده‌های مارپیچ و رنگ سبز مات',
    'گلدان شش‌ضلعی پیچان، بلند و باریک',
    'گلدان گیاه فضای باز با زهکشی و زیرگلدانی',
  ],
  en: [
    'Tall tulip vase with spiral ribs in matte sage',
    'Squat hammered urn, copper silk',
    'Outdoor planter with drainage and a saucer',
  ],
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function VariationThumb({ i }: { i: number }) {
  const v = useStore((s) => s.ai.variations[i]);
  const pick = useStore((s) => s.pickVariation);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (v) void thumbnail(`var:${JSON.stringify(v).length}:${v.random.seed}:${i}`, v).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [v, i]);
  return (
    <button
      type="button"
      onClick={() => pick(i)}
      className="aspect-[5/6] overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-[#efe9e1] hover:border-accent"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" />
      ) : (
        <div className="h-full w-full animate-pulse bg-line/40" />
      )}
    </button>
  );
}

export function AiPanel() {
  const t = useT();
  const txt = useTxt();
  const lang = useStore((s) => s.lang);
  const ai = useStore((s) => s.ai);
  const { aiDesign, aiRefine, aiImage, applySilhouette, makeVariations } = useStore.getState();
  const [prompt, setPrompt] = useState('');
  const [msg, setMsg] = useState('');
  const [health, setHealth] = useState<Awaited<ReturnType<typeof aiHealth>> | null>(null);
  const [image, setImage] = useState<{ url: string; base64: string; type: string; sil: Silhouette | null } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void aiHealth().then(setHealth);
  }, []);

  const onImage = async (f: File) => {
    const url = URL.createObjectURL(f);
    const bmp = await createImageBitmap(f);
    // downscale for the API (long edge ≤ 1280 px) and re-encode as JPEG
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const base64 = c.toDataURL('image/jpeg', 0.88).split(',')[1];
    setImage({ url, base64, type: 'image/jpeg', sil: extractSilhouette(bmp) });
  };

  const busy = ai.busy;
  const btn =
    'rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-50';
  const ghost = 'rounded-lg border border-line bg-card px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50';

  return (
    <div>
      {health && !health.configured && (
        <div className="mx-4 mt-3 rounded-lg bg-[#fbf3e3] p-2.5 text-xs leading-5 text-warn">
          {health.reachable ? t('ai.noKey') : t('ai.noServer')}
        </div>
      )}
      {ai.error && (
        <div className="mx-4 mt-3 rounded-lg bg-[#fbeceb] p-2.5 text-xs leading-5 text-err">{txt(ai.error)}</div>
      )}

      <Section title={t('ai.describe')}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder={EXAMPLES[lang][0]}
          className="w-full resize-none rounded-lg border border-line bg-card p-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {EXAMPLES[lang].map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!!busy || !prompt.trim()}
          onClick={() => void aiDesign(prompt.trim())}
          className={`mt-2 ${btn}`}
        >
          {busy === 'design' ? t('ai.thinking') : `✦ ${t('ai.generate')}`}
        </button>
      </Section>

      {ai.last && (
        <Section title={t('ai.interpretation')}>
          <p className="text-sm leading-6">{txt(ai.last.summary)}</p>
          <p className="mt-1 text-xs text-muted">
            {t('check.score')}: {ai.last.score}
            {ai.last.fixed > 0 && ` · ${t('ai.autofixed')} (${ai.last.fixed})`}
            {ai.last.rejected.length > 0 && ` · ${t('ai.rejected')}: ${ai.last.rejected.join(', ')}`}
          </p>
        </Section>
      )}

      <Section title={t('ai.refine')}>
        {ai.chat.length > 0 && (
          <ul className="mb-2 max-h-48 space-y-1.5 overflow-y-auto text-[13px]">
            {ai.chat.map((c, i) => (
              <li key={i} className={`rounded-lg px-2.5 py-1.5 ${c.role === 'user' ? 'bg-accent-soft' : 'bg-paper'}`}>
                {c.summary ? txt(c.summary) : c.text}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            void aiRefine(msg.trim());
            setMsg('');
          }}
        >
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={t('ai.refineHint')}
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <button type="submit" disabled={!!busy || !msg.trim()} className={btn}>
            {busy === 'refine' ? '…' : '↵'}
          </button>
        </form>
      </Section>

      <Section title={t('ai.image')}>
        <input
          ref={file}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void onImage(e.target.files[0])}
        />
        <button type="button" onClick={() => file.current?.click()} className={ghost}>
          ⇪ {t('ai.upload')}
        </button>
        {image && (
          <div className="mt-2">
            <div className="relative mx-auto w-40">
              <img src={image.url} alt="" className="w-full rounded-lg" />
              {image.sil && (
                <svg
                  viewBox={`0 0 ${image.sil.width} ${image.sil.height}`}
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  preserveAspectRatio="none"
                >
                  <polyline
                    points={[
                      ...image.sil.rows.map(([y, l]) => `${l},${y}`),
                      ...[...image.sil.rows].reverse().map(([y, , r]) => `${r},${y}`),
                    ].join(' ')}
                    fill="none"
                    stroke="#b4643c"
                    strokeWidth={2}
                  />
                </svg>
              )}
            </div>
            <p className="mt-1 text-center text-[11px] text-muted">{image.sil ? t('ai.silFound') : t('ai.silNone')}</p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('ai.imageNote')}
              className="mt-2 w-full rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void aiImage(image.base64, image.type, note, image.sil?.points ?? null)}
                className={btn}
              >
                {busy === 'image' ? t('ai.thinking') : `✦ ${t('ai.analyze')}`}
              </button>
              {image.sil && (
                <button
                  type="button"
                  onClick={() => applySilhouette(image.sil!.points, image.sil!.heightToWidth)}
                  className={ghost}
                >
                  {t('ai.useSilhouette')}
                </button>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title={t('ai.variations')}>
        <button type="button" disabled={!!busy} onClick={() => void makeVariations()} className={ghost}>
          {busy === 'variations' ? t('ai.thinking') : `⟳ ${t('ai.makeVariations')}`}
        </button>
        {ai.variations.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {ai.variations.map((_, i) => (
              <VariationThumb key={i} i={i} />
            ))}
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted">{t('ai.variationsHint')}</p>
      </Section>
    </div>
  );
}
