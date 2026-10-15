import { normalizeParams } from '../core/params/normalize';
import type { I18nText, VaseParams } from '../core/params/schema';
import index from './index.json';

const files = import.meta.glob<{ default: unknown }>('./*.json', { eager: true });

export interface Preset {
  id: string;
  name: I18nText;
  params: VaseParams;
}

export const PRESETS: Preset[] = index.map((p) => ({
  id: p.id,
  name: p.name,
  params: normalizeParams(files[`./${p.id}.json`].default),
}));
