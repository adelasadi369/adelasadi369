import { PERSIAN_FORMS } from '../core/persian/silhouettes';
import { setPath } from '../core/params/paths';
import { useStore } from '../state/store';
import { useT, useTxt } from './hooks';

/** Profile starting points inspired by Persian vessel forms (custom profile: stays editable). */
export function PersianForms() {
  const t = useT();
  const txt = useTxt();
  const params = useStore((s) => s.params);
  const replace = useStore((s) => s.replace);
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-muted">{t('forms.persian')}</span>
      <select
        className="max-w-[60%] rounded-md border border-line bg-card px-2 py-1 text-xs"
        value=""
        onChange={(e) => {
          const f = PERSIAN_FORMS.find((x) => x.id === e.target.value);
          if (!f) return;
          let p = setPath(params, 'profile.preset', 'custom');
          p = setPath(
            p,
            'profile.controlPoints',
            f.points.map((q) => ({ ...q, sharp: false })),
          );
          p = setPath(p, 'dimensions.height', f.height);
          p = setPath(p, 'dimensions.maxDiameter', f.maxDiameter);
          replace(p);
        }}
      >
        <option value="">{t('forms.pick')}</option>
        {PERSIAN_FORMS.map((f) => (
          <option key={f.id} value={f.id} title={txt(f.intent)}>
            {txt(f.name)}
          </option>
        ))}
      </select>
    </label>
  );
}
