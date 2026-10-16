import { normalizeParams } from '../core/params/normalize';
import type { I18nText, VaseParams } from '../core/params/schema';
import { PRESET_FILES } from './files';
import index from './index.json';

export interface Preset {
  id: string;
  name: I18nText;
  params: VaseParams;
}

export const PRESETS: Preset[] = index.map((p) => ({
  id: p.id,
  name: p.name,
  params: normalizeParams(PRESET_FILES[p.id]),
}));
