import { normalizeParams } from '../core/params/normalize';
import type { I18nText, VaseParams } from '../core/params/schema';
import { PRESET_FILES } from './files';
import index from './index.json';

export interface Preset {
  id: string;
  name: I18nText;
  /** 'persian': the Persian collection (pattern engine, muqarnas, forms). */
  collection?: string;
  params: VaseParams;
}

export const PRESETS: Preset[] = (index as { id: string; name: I18nText; collection?: string }[]).map((p) => ({
  id: p.id,
  name: p.name,
  ...(p.collection && { collection: p.collection }),
  params: normalizeParams(PRESET_FILES[p.id]),
}));

/**
 * Vase-mode presets (the golden test and vase-only checks run over these; the Persian collection is kept out so the
 * golden hashes stay fixed), sleeve presets (all), and the Persian collection.
 */
export const VASE_PRESETS = PRESETS.filter((p) => p.params.print.outputMode !== 'sleeve' && !p.collection);
export const SLEEVE_PRESETS = PRESETS.filter((p) => p.params.print.outputMode === 'sleeve');
export const PERSIAN_PRESETS = PRESETS.filter((p) => p.collection === 'persian');
