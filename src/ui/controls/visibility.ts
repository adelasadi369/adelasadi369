import { paramInfo } from '../../core/params/meta';
import type { EffectType } from '../../core/params/schema';
import { UI_PHASE } from '../hooks';

/** Whether a control renders at the current level/phase. */
export function isShown(path: string, level: 'basic' | 'advanced', effectType?: EffectType, force?: boolean): boolean {
  const info = paramInfo(path, effectType);
  if (!info || info.meta.phase > UI_PHASE) return false;
  return force || level === 'advanced' || info.meta.level === 'basic';
}
