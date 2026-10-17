import { create } from 'zustand';
import type { ExportFormat } from '../core/export';
import { normalizeParams } from '../core/params/normalize';
import { diffParams, setPath, type ParamDiff } from '../core/params/paths';
import { mutate, randomize } from '../core/params/random';
import { decodeShare, encodeShare } from '../core/params/share';
import { DEFAULT_PARAMS, type Effect, type I18nText, type VaseParams } from '../core/params/schema';
import { applyImageAnalysis, applyProposal, applyRefine, applySilhouette } from '../ai/apply';
import { aiDesign, aiImage, aiRefine } from '../ai/client';
import type { ParamChange } from '../core/printability/types';
import type { Lang } from '../i18n';
import { PRESETS } from '../presets';
import type { RegenResult } from '../workers/protocol';
import { getExportWorker, previewWorker, RegenScheduler } from './engine';

export type TabId = 'shape' | 'section' | 'twist' | 'surface' | 'rimBase' | 'print' | 'ai';
export const TABS: TabId[] = ['shape', 'section', 'twist', 'surface', 'rimBase', 'print', 'ai'];

export interface ViewerState {
  heatmap: boolean;
  layers: boolean;
  dims: boolean;
  /** Clipping height as a fraction of height, or null when off. */
  clip: number | null;
}

export interface FixState {
  status: 'idle' | 'running' | 'done';
  diff: ParamDiff[];
  before: number;
  after: number;
  prev: VaseParams | null;
}

interface Store {
  params: VaseParams;
  past: VaseParams[];
  future: VaseParams[];
  dragBase: VaseParams | null;
  result: RegenResult | null;
  error: string | null;
  lang: Lang;
  level: 'basic' | 'advanced';
  tab: TabId;
  viewer: ViewerState;
  fix: FixState;
  toast: string | null;
  exporting: boolean;
  ai: AiState;

  setParam(path: string, value: unknown, opts?: { transient?: boolean }): void;
  endDrag(): void;
  replace(params: VaseParams, history?: boolean): void;
  applyChanges(changes: ParamChange[]): void;
  undo(): void;
  redo(): void;
  loadPreset(id: string): void;
  randomize(): void;
  mutate(): void;
  surprise(): Promise<void>;
  autoFix(): Promise<void>;
  undoFix(): void;
  addEffect(type: Effect['type']): void;
  moveEffect(i: number, dir: -1 | 1): void;
  removeEffect(i: number): void;
  toggleLock(path: string): void;
  exportAs(format: ExportFormat): Promise<void>;
  shareLink(): Promise<void>;
  setLang(l: Lang): void;
  setLevel(l: 'basic' | 'advanced'): void;
  setTab(t: TabId): void;
  setViewer(v: Partial<ViewerState>): void;
  showToast(msg: string | null): void;
  aiDesign(prompt: string): Promise<void>;
  aiRefine(message: string): Promise<void>;
  aiImage(
    base64: string,
    mediaType: string,
    note: string,
    silhouette: { t: number; r: number }[] | null,
  ): Promise<void>;
  applySilhouette(points: { t: number; r: number }[], heightToWidth: number): void;
  makeVariations(): Promise<void>;
  pickVariation(i: number): void;
}

export interface AiChatEntry {
  role: 'user' | 'assistant';
  text: string;
  summary?: I18nText;
}

export interface AiState {
  busy: null | 'design' | 'refine' | 'image' | 'variations';
  error: I18nText | null;
  chat: AiChatEntry[];
  /** Interpretation of the last AI change. */
  last: { summary: I18nText; rejected: string[]; fixed: number; score: number } | null;
  variations: VaseParams[];
}

const HISTORY = 200;
const PREFS = 'vaseforge:prefs';

function loadPrefs(): { lang: Lang; level: 'basic' | 'advanced' } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
    return { lang: p.lang === 'en' ? 'en' : 'fa', level: p.level === 'advanced' ? 'advanced' : 'basic' };
  } catch {
    return { lang: 'fa', level: 'basic' };
  }
}

function initialParams(): VaseParams {
  const m = /[#&]d=([^&]+)/.exec(location.hash);
  if (m) {
    const p = decodeShare(decodeURIComponent(m[1]));
    if (p) return p;
  }
  return PRESETS[0]?.params ?? DEFAULT_PARAMS;
}

const prefs = loadPrefs();

export const useStore = create<Store>((set, get) => {
  const push = (prev: VaseParams) => {
    const past = [...get().past, prev];
    if (past.length > HISTORY) past.shift();
    return past;
  };
  const commit = (next: VaseParams, prev = get().params) =>
    set({ params: next, past: push(prev), future: [], dragBase: null, fix: { ...get().fix, status: 'idle' } });
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ lang: get().lang, level: get().level }));
    } catch {
      /* private mode */
    }
  };

  const setAi = (patch: Partial<AiState>) => set({ ai: { ...get().ai, ...patch } });
  /** AI output → validated/clamped params → auto-fix in the worker → one undoable history entry. */
  const finishAi = async (params: VaseParams, summary: I18nText, rejected: string[], chat: AiChatEntry[]) => {
    const prev = get().params;
    const fixed = await previewWorker.fixForAi(params);
    commit(fixed.params, prev);
    setAi({ busy: null, error: null, chat, last: { summary, rejected, fixed: fixed.changed, score: fixed.score } });
  };

  return {
    params: initialParams(),
    past: [],
    future: [],
    dragBase: null,
    result: null,
    error: null,
    lang: prefs.lang,
    level: prefs.level,
    tab: 'shape',
    viewer: { heatmap: false, layers: false, dims: true, clip: null },
    fix: { status: 'idle', diff: [], before: 0, after: 0, prev: null },
    toast: null,
    exporting: false,
    ai: { busy: null, error: null, chat: [], last: null, variations: [] },

    setParam(path, value, opts) {
      const { params, dragBase } = get();
      const next = normalizeParams(setPath(params, path, value));
      if (opts?.transient) set({ params: next, dragBase: dragBase ?? params });
      else commit(next, dragBase ?? params);
    },
    endDrag() {
      const { dragBase, params } = get();
      if (dragBase) commit(params, dragBase);
    },
    replace(params, history = true) {
      if (history) commit(normalizeParams(params));
      else set({ params: normalizeParams(params) });
    },
    applyChanges(changes) {
      let p = get().params;
      for (const c of changes) p = setPath(p, c.path, c.value);
      commit(normalizeParams(p));
    },
    undo() {
      const { past, params, future } = get();
      if (!past.length) return;
      set({ params: past[past.length - 1], past: past.slice(0, -1), future: [params, ...future] });
    },
    redo() {
      const { past, params, future } = get();
      if (!future.length) return;
      set({ params: future[0], future: future.slice(1), past: [...past, params] });
    },
    loadPreset(id) {
      const p = PRESETS.find((x) => x.id === id);
      if (p) commit(structuredClone(p.params));
    },
    randomize() {
      commit(randomize(get().params));
    },
    mutate() {
      commit(mutate(get().params));
    },
    async surprise() {
      const p = get().params;
      const next = await previewWorker.surprise(p.random.seed, p);
      commit(next);
    },
    async autoFix() {
      const prev = get().params;
      set({ fix: { status: 'running', diff: [], before: 0, after: 0, prev } });
      const r = await previewWorker.autoFix(prev);
      if (get().params !== prev) return set({ fix: { ...get().fix, status: 'idle' } });
      commit(r.params, prev);
      set({ fix: { status: 'done', diff: diffParams(prev, r.params), before: r.before, after: r.after, prev } });
    },
    undoFix() {
      const { fix } = get();
      if (fix.prev) commit(fix.prev);
      set({ fix: { status: 'idle', diff: [], before: 0, after: 0, prev: null } });
    },
    addEffect(type) {
      const p = get().params;
      commit(normalizeParams({ ...p, effects: [...p.effects, { type }] }));
    },
    moveEffect(i, dir) {
      const fx = [...get().params.effects];
      const j = i + dir;
      if (j < 0 || j >= fx.length) return;
      [fx[i], fx[j]] = [fx[j], fx[i]];
      commit({ ...get().params, effects: fx });
    },
    removeEffect(i) {
      commit({ ...get().params, effects: get().params.effects.filter((_, k) => k !== i) });
    },
    toggleLock(path) {
      const p = get().params;
      const locks = p.random.locks.includes(path)
        ? p.random.locks.filter((l) => l !== path)
        : [...p.random.locks, path];
      set({ params: { ...p, random: { ...p.random, locks } } });
    },
    async exportAs(format) {
      set({ exporting: true });
      try {
        const f = await getExportWorker().exportDesign(get().params, format);
        const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } finally {
        set({ exporting: false });
      }
    },
    async shareLink() {
      const url = `${location.origin}${location.pathname}#d=${encodeShare(get().params)}`;
      history.replaceState(null, '', url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard blocked: the URL bar still has the link */
      }
    },
    setLang(lang) {
      set({ lang });
      savePrefs();
    },
    setLevel(level) {
      set({ level });
      savePrefs();
    },
    setTab: (tab) => set({ tab }),
    setViewer: (v) => set({ viewer: { ...get().viewer, ...v } }),
    showToast: (toast) => set({ toast }),

    async aiDesign(prompt) {
      const lang = get().lang;
      setAi({ busy: 'design', error: null });
      const r = await aiDesign(prompt, lang);
      if (!r.ok) return setAi({ busy: null, error: r.error.message });
      const applied = applyProposal(r.data, PRESETS);
      await finishAi(applied.params, r.data.summary, applied.rejected, [
        { role: 'user', text: prompt },
        { role: 'assistant', text: r.data.summary.en, summary: r.data.summary },
      ]);
    },
    async aiRefine(message) {
      const { params, ai } = get();
      setAi({ busy: 'refine', error: null });
      const history = ai.chat.slice(-10).map((c) => ({ role: c.role, text: c.text }));
      const r = await aiRefine(params, message, history);
      if (!r.ok) return setAi({ busy: null, error: r.error.message });
      const applied = applyRefine(get().params, r.data);
      await finishAi(applied.params, r.data.summary, applied.rejected, [
        ...get().ai.chat,
        { role: 'user', text: message },
        { role: 'assistant', text: r.data.summary.en, summary: r.data.summary },
      ]);
    },
    async aiImage(base64, mediaType, note, silhouette) {
      setAi({ busy: 'image', error: null });
      const r = await aiImage(base64, mediaType, note, silhouette);
      if (!r.ok) return setAi({ busy: null, error: r.error.message });
      await finishAi(applyImageAnalysis(r.data, get().params), r.data.summary, [], get().ai.chat);
    },
    applySilhouette(points, hw) {
      commit(applySilhouette(points, hw, get().params));
    },
    async makeVariations() {
      setAi({ busy: 'variations', error: null });
      const p = get().params;
      const variations = await previewWorker.variations(p, (p.random.seed * 31 + Date.now()) >>> 0);
      setAi({ busy: null, variations });
    },
    pickVariation(i) {
      const v = get().ai.variations[i];
      if (v) commit(v);
    },
  };
});

// ---- regeneration: every params change → worker (low quality while dragging)
const scheduler = new RegenScheduler(
  (result) => useStore.setState({ result, error: null }),
  (e) => useStore.setState({ error: String(e) }),
);

function requestRegen() {
  const { params, dragBase } = useStore.getState();
  scheduler.request(params, dragBase ? 'low' : params.render.previewQuality);
}

useStore.subscribe((s, prev) => {
  if (s.params !== prev.params || (prev.dragBase && !s.dragBase)) requestRegen();
});
requestRegen();
