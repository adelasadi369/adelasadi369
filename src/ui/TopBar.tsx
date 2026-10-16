import { useState } from 'react';
import type { ExportFormat } from '../core/export';
import { saveDesign } from '../persist/db';
import { useStore } from '../state/store';
import { useT } from './hooks';
import { Library, PresetGallery } from './Modals';

function Btn({
  onClick,
  children,
  title,
  disabled,
  primary,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-[13px] whitespace-nowrap transition disabled:opacity-40 ${
        primary ? 'bg-ink text-white hover:bg-ink/85' : 'hover:bg-line/60'
      }`}
    >
      {children}
    </button>
  );
}

function ExportMenu() {
  const t = useT();
  const exportAs = useStore((s) => s.exportAs);
  const exporting = useStore((s) => s.exporting);
  const [open, setOpen] = useState(false);
  const items: [ExportFormat, Parameters<typeof t>[0]][] = [
    ['stl', 'export.stl'],
    ['3mf', 'export.3mf'],
    ['obj', 'export.obj'],
    ['json', 'export.json'],
  ];
  return (
    <div className="relative">
      <Btn primary onClick={() => setOpen(!open)} disabled={exporting}>
        {exporting ? t('export.busy') : `⤓ ${t('btn.export')}`}
      </Btn>
      {open && (
        <div className="absolute top-10 z-40 w-56 overflow-hidden rounded-xl border border-line bg-card shadow-xl ltr:right-0 rtl:left-0">
          {items.map(([f, k]) => (
            <button
              key={f}
              type="button"
              className="block w-full px-4 py-2.5 text-start text-sm hover:bg-paper"
              onClick={() => {
                setOpen(false);
                void exportAs(f);
              }}
            >
              {t(k)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const t = useT();
  const s = useStore();
  const [modal, setModal] = useState<'presets' | 'library' | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const canvas = document.querySelector('canvas');
    const id = s.params.name ? `name:${s.params.name}` : `d${Date.now().toString(36)}`;
    await saveDesign({
      id,
      name: s.params.name,
      params: s.params,
      thumbnail: canvas?.toDataURL('image/jpeg', 0.7),
      updatedAt: Date.now(),
    });
    s.showToast(t('save.saved'));
  };
  return (
    <header className="flex items-center gap-1 border-b border-line bg-card/80 px-3 py-2 backdrop-blur">
      <div className="me-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-lg text-white">⚱</span>
        <div className="hidden leading-tight md:block">
          <div className="text-sm font-bold">{t('app.title')}</div>
          <div className="text-[11px] text-muted">{t('app.tagline')}</div>
        </div>
      </div>
      <input
        className="hidden w-36 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-accent focus:outline-none lg:block"
        placeholder={t('name.placeholder')}
        value={s.params.name}
        onChange={(e) => s.replace({ ...s.params, name: e.target.value }, false)}
      />
      <div className="mx-1 h-6 w-px bg-line" />
      <Btn onClick={() => setModal('presets')}>▦ {t('btn.presets')}</Btn>
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <Btn onClick={s.randomize} title={t('btn.randomize')}>
          🎲 <span className="hidden sm:inline">{t('btn.randomize')}</span>
        </Btn>
        <Btn onClick={s.mutate} title={t('btn.mutate')}>
          ✳ <span className="hidden sm:inline">{t('btn.mutate')}</span>
        </Btn>
        <Btn
          disabled={busy}
          title={t('btn.surprise')}
          onClick={() => {
            setBusy(true);
            void s.surprise().finally(() => setBusy(false));
          }}
        >
          ✨ <span className="hidden sm:inline">{t('btn.surprise')}</span>
        </Btn>
        <div className="mx-1 h-6 w-px bg-line" />
        <Btn onClick={s.undo} disabled={!s.past.length} title={t('btn.undo')}>
          ↶
        </Btn>
        <Btn onClick={s.redo} disabled={!s.future.length} title={t('btn.redo')}>
          ↷
        </Btn>
        <div className="mx-1 h-6 w-px bg-line" />
        <Btn
          onClick={() => {
            void s.shareLink().then(() => s.showToast(t('share.copied')));
          }}
        >
          🔗 <span className="hidden md:inline">{t('btn.share')}</span>
        </Btn>
        <Btn onClick={() => void save()}>
          💾 <span className="hidden md:inline">{t('btn.save')}</span>
        </Btn>
        <Btn onClick={() => setModal('library')}>
          ☰ <span className="hidden md:inline">{t('btn.library')}</span>
        </Btn>
      </div>
      <div className="flex items-center gap-1">
        <div className="hidden rounded-lg border border-line p-0.5 text-xs sm:flex">
          {(['basic', 'advanced'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => s.setLevel(l)}
              className={`rounded-md px-2 py-1 ${s.level === l ? 'bg-ink text-white' : 'text-muted'}`}
            >
              {t(`mode.${l}`)}
            </button>
          ))}
        </div>
        <Btn onClick={() => s.setLang(s.lang === 'fa' ? 'en' : 'fa')}>{t('lang.toggle')}</Btn>
        <ExportMenu />
      </div>
      {modal === 'presets' && <PresetGallery onClose={() => setModal(null)} />}
      {modal === 'library' && <Library onClose={() => setModal(null)} />}
    </header>
  );
}
