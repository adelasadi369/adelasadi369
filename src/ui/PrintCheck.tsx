import { paramInfo } from '../core/params/meta';
import type { Issue } from '../core/printability/types';
import { useStore } from '../state/store';
import { useNum, useT, useTxt } from './hooks';

const SEV = {
  error: { dot: 'bg-err', text: 'text-err', key: 'severity.error' },
  warn: { dot: 'bg-warn', text: 'text-warn', key: 'severity.warn' },
  info: { dot: 'bg-muted', text: 'text-muted', key: 'severity.info' },
} as const;

function ScoreRing({ score }: { score: number }) {
  const num = useNum();
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? 'var(--color-ok)' : score >= 70 ? 'var(--color-warn)' : 'var(--color-err)';
  return (
    <svg viewBox="0 0 76 76" className="h-20 w-20 shrink-0">
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--color-line)" strokeWidth="7" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`}
        transform="rotate(-90 38 38)"
        style={{ transition: 'stroke-dasharray .4s' }}
      />
      <text x="38" y="44" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--color-ink)">
        {num(score)}
      </text>
    </svg>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const t = useT();
  const txt = useTxt();
  const num = useNum();
  const applyChanges = useStore((s) => s.applyChanges);
  const autoFix = useStore((s) => s.autoFix);
  const s = SEV[issue.severity];
  return (
    <li className="rounded-lg border border-line bg-card p-2.5 text-[13px] leading-6">
      <div className="flex items-start gap-2">
        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <div className="flex-1">
          <span className={`me-1 text-xs font-semibold ${s.text}`}>{t(s.key)}</span>
          {issue.heightRange && (
            <span className="me-1 text-xs text-muted">
              ({num(issue.heightRange[0])}–{num(issue.heightRange[1])}
              {t('unit.%')})
            </span>
          )}
          {txt(issue.message)}
        </div>
      </div>
      {issue.fix && (
        <div className="mt-1.5 ms-4 flex flex-wrap gap-1.5">
          {[issue.fix, ...(issue.fixes ?? [])].map((f, k) => (
            <button
              key={k}
              type="button"
              onClick={() => (f.kind === 'patch' ? applyChanges(f.changes) : autoFix())}
              className="rounded-md border border-accent/40 px-2 py-0.5 text-xs text-accent hover:bg-accent-soft"
            >
              {txt(f.label)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function FixDiff() {
  const t = useT();
  const txt = useTxt();
  const num = useNum();
  const fix = useStore((s) => s.fix);
  const params = useStore((s) => s.params);
  const undoFix = useStore((s) => s.undoFix);
  if (fix.status !== 'done') return null;
  const label = (path: string) => {
    const m = /^effects\.(\d+)\./.exec(path);
    const info = paramInfo(path, m ? params.effects[Number(m[1])]?.type : undefined);
    return info ? txt(info.meta.label) : path;
  };
  const fmt = (v: unknown) => (typeof v === 'number' ? num(v, 2) : String(v));
  return (
    <div className="rounded-xl border border-ok/40 bg-[#eef6f0] p-3 text-[13px]">
      {fix.diff.length === 0 ? (
        <p>{t('check.noChange')}</p>
      ) : (
        <>
          <p className="mb-1 font-medium">
            {t('check.fixed')} ({num(fix.before)} → {num(fix.after)})
          </p>
          <ul className="space-y-0.5">
            {fix.diff.map((d) => (
              <li key={d.path} className="flex justify-between gap-2">
                <span>{label(d.path)}</span>
                <span className="tabular-nums text-muted" dir="ltr">
                  {fmt(d.from)} → <b className="text-ink">{fmt(d.to)}</b>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={undoFix} className="mt-2 text-xs text-accent underline">
            {t('check.undoFix')}
          </button>
        </>
      )}
    </div>
  );
}

export function PrintCheck() {
  const t = useT();
  const num = useNum();
  const report = useStore((s) => s.result?.report);
  const fix = useStore((s) => s.fix);
  const autoFix = useStore((s) => s.autoFix);
  const sleeve = useStore((s) => s.params.print.outputMode === 'sleeve');
  if (!report) return <div className="p-4 text-sm text-muted">…</div>;
  const s = report.stats;
  const hasProblems = report.issues.some((i) => i.severity !== 'info');
  const stats: [string, string][] = [
    [t('stats.height'), `${num(s.height, 1)} ${t('unit.mm')}`],
    [t('stats.maxDiameter'), `${num(s.maxDiameter, 1)} ${t('unit.mm')}`],
    ...(s.boreDiameter !== undefined
      ? ([[t('stats.bore'), `${num(s.boreDiameter, 2, true)} ${t('unit.mm')}`]] as [string, string][])
      : []),
    ...(s.boreContact !== undefined
      ? ([[t('stats.boreContact'), `${num(s.boreContact * 100)}${t('unit.%')}`]] as [string, string][])
      : []),
    ...(sleeve ? [] : ([[t('stats.capacity'), `${num(s.capacityMl)} ${t('unit.ml')}`]] as [string, string][])),
    [t('stats.weight'), `${num(s.weightG)} ${t('unit.g')}`],
    [t('stats.time'), `${num(s.printMinutes)} ${t('unit.min')}`],
    [t('stats.area'), `${num(s.surfaceCm2)} ${t('unit.cm2')}`],
    [t('stats.triangles'), num(s.triangles)],
    [t('stats.fileSize'), `${num(s.stlBytes / 1e6, 1)} MB`],
  ];
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-card p-3">
        <ScoreRing score={report.score} />
        <div className="flex-1">
          <div className="text-xs text-muted">{t('check.score')}</div>
          <div className="text-sm font-medium">{hasProblems ? '' : t('check.ok')}</div>
          {hasProblems && (
            <button
              type="button"
              onClick={autoFix}
              disabled={fix.status === 'running'}
              className="mt-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:brightness-110 disabled:opacity-60"
            >
              {fix.status === 'running' ? t('check.fixing') : `✓ ${t('btn.fix')}`}
            </button>
          )}
        </div>
      </div>
      <FixDiff />
      {report.issues.length > 0 && (
        <ul className="space-y-1.5">
          {report.issues.map((i) => (
            <IssueRow key={i.id} issue={i} />
          ))}
        </ul>
      )}
      <div className="rounded-xl border border-line bg-card p-3">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t('check.stats')}</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
          {stats.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
