import type { VaseParams } from '../core/params/schema';

/** Placement controls of the Motif block (shown for every source). */
export const MOTIF_PATHS = [
  'motif.source',
  'motif.persian.preset',
  'motif.persian.tiling',
  'motif.persian.contactAngle',
  'motif.persian.offset',
  'motif.persian.strapWidth',
  'motif.persian.interlace',
  'motif.persian.sizing',
  'motif.persian.cellSize',
  'motif.persian.autoRotate',
  'motif.placement',
  'motif.repeatsAround',
  'motif.repeatsUp',
  'motif.bandStart',
  'motif.bandEnd',
  'motif.fill',
  'motif.angle',
  'motif.height',
  'motif.size',
  'motif.rotation',
  'motif.strokeWidth',
];

const SINGLE_ONLY = new Set(['motif.height', 'motif.size']);
const REPEAT_ONLY = new Set(['motif.repeatsUp', 'motif.bandStart', 'motif.bandEnd', 'motif.fill']);

export function motifVisible(path: string, p: VaseParams): boolean {
  const m = p.motif;
  if (path === 'motif.source') return true;
  if (m.source === 'none') return false;
  if (path.startsWith('motif.persian.')) {
    if (m.source !== 'persian') return false;
    const f = path.slice('motif.persian.'.length);
    if (['tiling', 'contactAngle', 'offset'].includes(f)) return m.persian.preset === 'custom';
    if (f === 'cellSize') return m.persian.sizing === 'cellSize';
    return true;
  }
  if (m.source === 'persian' && path === 'motif.repeatsAround') return m.persian.sizing === 'repeatCount';
  if (m.source === 'persian' && path === 'motif.rotation') return !m.persian.autoRotate;
  if (m.source === 'persian')
    return (
      !SINGLE_ONLY.has(path) && !REPEAT_ONLY.has(path) && path !== 'motif.strokeWidth' && path !== 'motif.placement'
    );
  if (path === 'motif.strokeWidth') return m.source === 'svg';
  if (path === 'motif.fill' && m.source === 'text') return m.placement === 'repeat';
  if (SINGLE_ONLY.has(path)) return m.placement === 'single';
  if (REPEAT_ONLY.has(path)) return m.placement === 'repeat';
  return true;
}
