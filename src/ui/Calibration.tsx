import { useState } from 'react';
import { calibrateHoleCompensation, computeBore } from '../core/insert';
import { PRINTER_PRESETS } from '../core/params/schema';
import { useStore } from '../state/store';
import { useNum, useT } from './hooks';
import { Modal } from './Modals';

const parseNum = (s: string) =>
  Number(s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٫,]/, '.'));

/** Bore R_bore readout: design Ø (incl. compensation) and the target Ø the printed hole should have. */
export function BoreReadout() {
  const t = useT();
  const num = useNum();
  const params = useStore((s) => s.params);
  const b = computeBore(params.insert, params.print.printer);
  return (
    <div className="my-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2" dir="ltr">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{t('insert.bore')}</span>
        <span className="text-xl font-semibold text-accent tabular-nums">
          {num(b.diameter, 2, true)} {t('unit.mm')}
        </span>
      </div>
      <div className="mt-0.5 flex justify-between gap-2 text-[11px] text-muted tabular-nums">
        <span>
          R {num(b.radius, 3, true)} · {t('insert.target')} Ø {num(b.targetDiameter, 2, true)}
        </span>
        <span>
          +{num(b.holeCompensation, 3, true)} {t('insert.compensation')}
        </span>
      </div>
    </div>
  );
}

/** Calibration wizard: print the Fit Test Ring, measure it, save the corrected hole compensation. */
export function CalibrationModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const num = useNum();
  const params = useStore((s) => s.params);
  const exportAs = useStore((s) => s.exportAs);
  const exporting = useStore((s) => s.exporting);
  const calibrate = useStore((s) => s.calibrate);
  const showToast = useStore((s) => s.showToast);
  const bore = computeBore(params.insert, params.print.printer);
  const [text, setText] = useState('');
  const measured = parseNum(text);
  const valid = text.trim() !== '' && Number.isFinite(measured) && measured > 0;
  const result = valid ? calibrateHoleCompensation(bore, measured) : null;
  const printer = PRINTER_PRESETS[params.print.printer.preset].name;
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted">{k}</span>
      <span className="font-medium tabular-nums" dir="ltr">
        {v}
      </span>
    </div>
  );
  return (
    <Modal title={t('calib.title')} onClose={onClose}>
      <div className="mx-auto max-w-md space-y-4 text-sm">
        <div className="rounded-xl border border-line bg-card p-3">
          {row(t('calib.printer'), printer)}
          {row(t('calib.designed'), `${num(bore.diameter, 2, true)} ${t('unit.mm')}`)}
          {row(t('calib.targetD'), `${num(bore.targetDiameter, 2, true)} ${t('unit.mm')}`)}
          {row(t('calib.result'), `${num(bore.holeCompensation, 3, true)} ${t('unit.mm')}`)}
        </div>
        <div>
          <p className="mb-2">{t('calib.step1')}</p>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportAs('fitRing')}
            className="rounded-lg border border-line bg-card px-3 py-1.5 hover:border-accent disabled:opacity-50"
          >
            ⤓ {t('export.fitRing')}
          </button>
        </div>
        <div>
          <p className="mb-2">{t('calib.step2')}</p>
          <label className="flex items-center gap-2">
            <span className="text-muted">{t('calib.measured')}</span>
            <input
              className="w-28 rounded-md border border-line bg-card px-2 py-1 text-end tabular-nums outline-none focus:border-accent"
              inputMode="decimal"
              dir="ltr"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={num(bore.targetDiameter, 2, true)}
            />
            <span className="text-muted">{t('unit.mm')}</span>
          </label>
        </div>
        {result && (
          <div className="rounded-xl border border-accent/40 bg-accent-soft p-3">
            <div className="text-xs text-muted" dir="ltr">
              {t('calib.formula')}
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums" dir="ltr">
              {t('calib.result')}: {num(result.old, 3, true)} →{' '}
              <span className="text-accent">{num(result.next, 3, true)}</span> {t('unit.mm')}
            </div>
            {result.clamped && <div className="mt-1 text-xs text-err">{t('calib.clamped')}</div>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 hover:bg-line/60">
            {t('btn.close')}
          </button>
          <button
            type="button"
            disabled={!result}
            onClick={() => {
              if (!result) return;
              void calibrate(result.next);
              showToast(t('calib.saved'));
              onClose();
            }}
            className="rounded-lg bg-ink px-3 py-1.5 text-white hover:bg-ink/85 disabled:opacity-40"
          >
            {t('calib.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
