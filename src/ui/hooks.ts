import { useCallback } from 'react';
import { formatNumber, translate, type MsgKey } from '../i18n';
import type { I18nText } from '../core/params/schema';
import { useStore } from '../state/store';

export function useT() {
  const lang = useStore((s) => s.lang);
  return useCallback((key: MsgKey) => translate(lang, key), [lang]);
}

export function useTxt() {
  const lang = useStore((s) => s.lang);
  return useCallback((txt: I18nText) => txt[lang], [lang]);
}

export function useNum() {
  const lang = useStore((s) => s.lang);
  return useCallback((x: number, digits = 0, fixed = false) => formatNumber(lang, x, digits, fixed), [lang]);
}

/** Current UI phase: parameters/options from later phases stay hidden. */
export const UI_PHASE = 2;
