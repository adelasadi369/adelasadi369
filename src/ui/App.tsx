import { useEffect, useState } from 'react';
import type { MsgKey } from '../i18n';
import { TABS, useStore, type TabId } from '../state/store';
import { useT } from './hooks';
import { TabPanel } from './Panels';
import { PrintCheck } from './PrintCheck';
import { TopBar } from './TopBar';
import { Viewer } from './viewer/Viewer';

const ICONS: Record<TabId, string> = {
  shape: '◠',
  section: '⬡',
  twist: '↻',
  surface: '≋',
  rimBase: '◫',
  print: '⎙',
  ai: '✦',
};

function Tabs({ vertical }: { vertical?: boolean }) {
  const t = useT();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  return (
    <nav
      className={
        vertical
          ? 'flex flex-col gap-0.5 border-line p-1.5 ltr:border-r rtl:border-l'
          : 'scroll-thin flex gap-0.5 overflow-x-auto border-b border-line px-2 py-1'
      }
    >
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] transition ${
            vertical ? 'flex-col gap-0.5 px-1 py-2 text-[11px]' : ''
          } ${tab === id ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-line/50 hover:text-ink'}`}
        >
          <span className="text-base leading-none">{ICONS[id]}</span>
          {t(`tab.${id}` as MsgKey)}
        </button>
      ))}
    </nav>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const show = useStore((s) => s.showToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => show(null), 2600);
    return () => clearTimeout(id);
  }, [toast, show]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">
      {toast}
    </div>
  );
}

function useIsDesktop() {
  const q = '(min-width: 1024px)';
  const [desk, setDesk] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setDesk(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return desk;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const lang = useStore((s) => s.lang);
  const tab = useStore((s) => s.tab);
  const error = useStore((s) => s.error);
  const t = useT();
  const [sheet, setSheet] = useState<'edit' | 'check' | null>('edit');
  const desktop = useIsDesktop();
  useShortcuts();
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.title = `${t('app.title')} — ${t('app.tagline')}`;
  }, [lang, t]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {error && <div className="bg-err px-4 py-1 text-xs text-white">{error}</div>}
      {desktop ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[360px] shrink-0 border-line bg-card ltr:border-r rtl:border-l">
            <Tabs vertical />
            <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">
              <TabPanel tab={tab} />
            </div>
          </aside>
          <main className="min-w-0 flex-1">
            <Viewer />
          </main>
          <aside className="scroll-thin w-[320px] shrink-0 overflow-y-auto border-line bg-paper ltr:border-l rtl:border-r">
            <div className="px-4 pt-3 text-xs font-semibold tracking-wide text-muted uppercase">{t('check.title')}</div>
            <PrintCheck />
          </aside>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Viewer />
          </div>
          <div
            className={`flex flex-col rounded-t-2xl border-t border-line bg-card shadow-[0_-8px_30px_rgba(0,0,0,0.08)] ${sheet ? 'h-[52%]' : ''}`}
          >
            <div className="flex items-center justify-center gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => setSheet(sheet ? null : 'edit')}
                className="h-1.5 w-10 rounded-full bg-line"
                aria-label="toggle sheet"
              />
            </div>
            <div className="flex gap-1 px-3 pt-1">
              {(['edit', 'check'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSheet(k)}
                  className={`rounded-full px-3 py-1 text-xs ${sheet === k ? 'bg-ink text-white' : 'text-muted'}`}
                >
                  {k === 'edit' ? t('tab.shape') + ' …' : t('tab.check')}
                </button>
              ))}
            </div>
            {sheet === 'edit' && (
              <>
                <Tabs />
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                  <TabPanel tab={tab} />
                </div>
              </>
            )}
            {sheet === 'check' && (
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                <PrintCheck />
              </div>
            )}
          </div>
        </div>
      )}
      <Toast />
    </div>
  );
}
