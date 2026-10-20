import { useState } from 'react';
import { EFFECT_FIELDS } from '../core/params/meta';
import type { Effect } from '../core/params/schema';
import type { MsgKey } from '../i18n';
import { useStore } from '../state/store';
import { ParamControl } from './controls/ParamControl';
import { useT } from './hooks';

const ADDABLE: Effect['type'][] = ['ribs', 'waves', 'noise', 'organic', 'texture', 'facets', 'steps', 'glitch'];
const WINDOW = ['start', 'end', 'fade'];
const HIDDEN = ['id', 'type', 'enabled', ...WINDOW];

/** Conditional fields per effect type. */
const SHOW: Record<string, (e: Effect) => boolean> = {
  crisscross: (e) => e.type === 'ribs' && e.helixTurns !== 0,
  stretch: (e) => e.type === 'organic' && e.style !== 'softBulges',
  warp: (e) => e.type === 'organic' && e.style === 'blobs',
};

function EffectCard({ e, i, n }: { e: Effect; i: number; n: number }) {
  const t = useT();
  const level = useStore((s) => s.level);
  const { setParam, moveEffect, removeEffect } = useStore.getState();
  const [open, setOpen] = useState(true);
  const fields = EFFECT_FIELDS[e.type].filter((f) => !HIDDEN.includes(f.path) && (SHOW[f.path]?.(e) ?? true));
  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-paper hover:text-ink disabled:opacity-30';
  return (
    <div className={`rounded-xl border bg-card ${e.enabled ? 'border-line' : 'border-dashed border-line opacity-60'}`}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          role="switch"
          aria-checked={e.enabled}
          onClick={() => setParam(`effects.${i}.enabled`, !e.enabled)}
          className={`h-4 w-4 rounded border ${e.enabled ? 'border-accent bg-accent' : 'border-muted'}`}
          title={t(`effect.${e.type}` as MsgKey)}
        />
        <button type="button" onClick={() => setOpen(!open)} className="flex-1 px-1 text-start text-sm font-medium">
          {i + 1}. {t(`effect.${e.type}` as MsgKey)}
          <span className="ms-2 text-xs text-muted">
            {e.start}–{e.end}%
          </span>
        </button>
        <button type="button" className={iconBtn} disabled={i === 0} onClick={() => moveEffect(i, -1)} aria-label="up">
          ↑
        </button>
        <button
          type="button"
          className={iconBtn}
          disabled={i === n - 1}
          onClick={() => moveEffect(i, 1)}
          aria-label="down"
        >
          ↓
        </button>
        <button type="button" className={iconBtn} onClick={() => removeEffect(i)} aria-label={t('btn.delete')}>
          ✕
        </button>
      </div>
      {open && (
        <div className="border-t border-line px-3 pb-2">
          {fields.map((f) => (
            <ParamControl key={f.path} path={`effects.${i}.${f.path}`} effectType={e.type} />
          ))}
          {level === 'advanced' && (
            <div className="mt-1 rounded-lg bg-paper px-2">
              <div className="pt-2 text-xs text-muted">{t('effect.window')}</div>
              {WINDOW.map((w) => (
                <ParamControl key={w} path={`effects.${i}.${w}`} effectType={e.type} force />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EffectStack() {
  const t = useT();
  const effects = useStore((s) => s.params.effects);
  const add = useStore((s) => s.addEffect);
  return (
    <div className="space-y-2 p-3">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-muted uppercase">{t('effects.title')}</h3>
      {effects.length === 0 && <p className="px-1 py-3 text-sm text-muted">{t('effects.empty')}</p>}
      {effects.map((e, i) => (
        <EffectCard key={e.id ?? i} e={e} i={i} n={effects.length} />
      ))}
      <div className="flex flex-wrap gap-1.5 pt-2">
        {ADDABLE.map((type) => (
          <button
            key={type}
            type="button"
            disabled={effects.length >= 12}
            onClick={() => add(type)}
            className="rounded-full border border-line bg-card px-3 py-1 text-xs hover:border-accent hover:text-accent"
          >
            + {t(`effect.${type}` as MsgKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
