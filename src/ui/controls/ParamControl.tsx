import { useState, type ReactNode } from 'react';
import { paramInfo, type ParamInfo } from '../../core/params/meta';
import { getPath } from '../../core/params/paths';
import type { EffectType } from '../../core/params/schema';
import type { MsgKey } from '../../i18n';
import { useStore } from '../../state/store';
import { useNum, useT, useTxt } from '../hooks';
import { isShown } from './visibility';

/** Enum options hidden until their phase ships. */
const LATER_OPTIONS: Record<string, string[]> = {};

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] text-muted">
        i
      </span>
      <span className="pointer-events-none absolute top-5 z-30 hidden w-56 rounded-lg bg-ink px-3 py-2 text-xs leading-5 text-white shadow-lg group-hover:block ltr:left-0 rtl:right-0">
        {text}
      </span>
    </span>
  );
}

function LockButton({ path }: { path: string }) {
  const locked = useStore((s) => s.params.random.locks.includes(path));
  const toggle = useStore((s) => s.toggleLock);
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => toggle(path)}
      title={locked ? t('unlock') : t('lock')}
      className={`text-xs transition ${locked ? 'text-accent' : 'text-line hover:text-muted'}`}
      aria-pressed={locked}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  );
}

function Row({ info, children, lock }: { info: ParamInfo; children: ReactNode; lock?: boolean }) {
  const txt = useTxt();
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center gap-1.5 text-[13px]">
        <span className="font-medium">{txt(info.meta.label)}</span>
        <InfoTip text={txt(info.meta.help)} />
        <span className="flex-1" />
        {lock !== false && <LockButton path={info.path} />}
      </div>
      {children}
    </div>
  );
}

function NumberControl({ info, value }: { info: ParamInfo; value: number }) {
  const setParam = useStore((s) => s.setParam);
  const endDrag = useStore((s) => s.endDrag);
  const t = useT();
  const num = useNum();
  const [text, setText] = useState<string | null>(null);
  const { min = 0, max = 1, step = info.kind === 'int' ? 1 : 0.01, unit } = info.meta;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const unitLabel = unit ? t(`unit.${unit}` as MsgKey) : '';
  return (
    <div className="flex items-center gap-2" dir="ltr">
      <input
        type="range"
        className="h-1.5 flex-1 cursor-pointer"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyUp={endDrag}
        onBlur={endDrag}
        onChange={(e) => setParam(info.path, Number(e.target.value), { transient: true })}
        aria-label={info.path}
      />
      <label className="flex w-24 items-center rounded-md border border-line bg-card px-1.5 text-xs focus-within:border-accent">
        <input
          className="w-full bg-transparent py-1 text-end tabular-nums outline-none"
          inputMode="decimal"
          value={text ?? num(value, digits)}
          onFocus={() => setText(String(value))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number((text ?? '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace('٫', '.'));
            if (Number.isFinite(v)) setParam(info.path, Math.min(max, Math.max(min, v)));
            setText(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="ps-1 text-muted">{unitLabel}</span>
      </label>
    </div>
  );
}

function EnumControl({ info, value }: { info: ParamInfo; value: string }) {
  const setParam = useStore((s) => s.setParam);
  const txt = useTxt();
  const key = info.path.split('.').pop()!;
  const hidden = LATER_OPTIONS[key] ?? [];
  const opts = (info.options ?? []).filter((o) => !hidden.includes(o) || o === value);
  const label = (o: string) => (info.meta.options?.[o] ? txt(info.meta.options[o]) : o);
  if (opts.length <= 4) {
    return (
      <div className="flex flex-wrap gap-1">
        {opts.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setParam(info.path, o)}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              o === value ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card hover:border-muted'
            }`}
          >
            {label(o)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select
      className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-accent"
      value={value}
      onChange={(e) => setParam(info.path, e.target.value)}
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  );
}

function BoolControl({ info, value }: { info: ParamInfo; value: boolean }) {
  const setParam = useStore((s) => s.setParam);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => setParam(info.path, !value)}
      className={`relative h-5 w-9 rounded-full transition ${value ? 'bg-accent' : 'bg-line'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? 'start-[18px]' : 'start-0.5'}`}
      />
    </button>
  );
}

export function ParamControl({ path, effectType, force }: { path: string; effectType?: EffectType; force?: boolean }) {
  const value = useStore((s) => getPath(s.params, path));
  const level = useStore((s) => s.level);
  const info = paramInfo(path, effectType);
  if (!info || value === undefined || !isShown(path, level, effectType, force)) return null;
  const lock = !path.startsWith('print.') && !path.startsWith('render.');
  return (
    <Row info={info} lock={lock}>
      {info.kind === 'number' || info.kind === 'int' ? (
        <NumberControl info={info} value={value as number} />
      ) : info.kind === 'enum' ? (
        <EnumControl info={info} value={value as string} />
      ) : info.kind === 'bool' ? (
        <BoolControl info={info} value={value as boolean} />
      ) : null}
    </Row>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3 last:border-b-0">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
