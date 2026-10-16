import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { deleteDesign, listDesigns, type SavedDesign } from '../persist/db';
import { PRESETS } from '../presets';
import { useStore } from '../state/store';
import { useT, useTxt } from './hooks';
import { thumbnail } from './thumbnails';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-t-2xl bg-paper shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label={t('btn.close')}>
            ✕
          </button>
        </div>
        <div className="scroll-thin max-h-[calc(85vh-52px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Thumb({ id, params }: { id: string; params: SavedDesign['params'] }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void thumbnail(id, params).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [id, params]);
  return src ? (
    <img src={src} alt="" className="h-full w-full object-contain" />
  ) : (
    <div className="h-full w-full animate-pulse bg-line/40" />
  );
}

export function PresetGallery({ onClose }: { onClose: () => void }) {
  const t = useT();
  const txt = useTxt();
  const load = useStore((s) => s.loadPreset);
  return (
    <Modal title={t('btn.presets')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              load(p.id);
              onClose();
            }}
            className="group overflow-hidden rounded-xl border border-line bg-gradient-to-b from-white to-[#efe9e1] text-start transition hover:border-accent hover:shadow-md"
          >
            <div className="aspect-[5/6] p-1">
              <Thumb id={`preset:${p.id}`} params={p.params} />
            </div>
            <div className="border-t border-line bg-card px-2 py-1.5 text-[13px] font-medium group-hover:text-accent">
              {txt(p.name)}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Library({ onClose }: { onClose: () => void }) {
  const t = useT();
  const replace = useStore((s) => s.replace);
  const lang = useStore((s) => s.lang);
  const [items, setItems] = useState<SavedDesign[] | null>(null);
  const refresh = () => void listDesigns().then(setItems, () => setItems([]));
  useEffect(refresh, []);
  return (
    <Modal title={t('btn.library')} onClose={onClose}>
      {items && items.length === 0 && <p className="py-6 text-center text-sm text-muted">{t('library.empty')}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items?.map((d) => (
          <div key={d.id} className="overflow-hidden rounded-xl border border-line bg-card">
            <button
              type="button"
              className="block aspect-[5/6] w-full bg-gradient-to-b from-white to-[#efe9e1] p-1"
              onClick={() => {
                replace(d.params);
                onClose();
              }}
            >
              {d.thumbnail ? (
                <img src={d.thumbnail} alt="" className="h-full w-full object-contain" />
              ) : (
                <Thumb id={`saved:${d.id}:${d.updatedAt}`} params={d.params} />
              )}
            </button>
            <div className="flex items-center justify-between border-t border-line px-2 py-1.5 text-[13px]">
              <div className="min-w-0">
                <div className="truncate font-medium">{d.name || t('name.placeholder')}</div>
                <div className="text-[11px] text-muted">
                  {new Date(d.updatedAt).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-US')}
                </div>
              </div>
              <button
                type="button"
                className="text-xs text-muted hover:text-err"
                onClick={() => void deleteDesign(d.id).then(refresh)}
              >
                {t('btn.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
