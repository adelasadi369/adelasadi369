import type { I18nText } from '../params/schema';

/**
 * Vessel silhouettes inspired by classic Persian forms (docs/persian-patterns.md §5). They are starting points for
 * the custom profile, not replicas of historical objects: points are (t % of height, r × maxDiameter / 2), and every
 * slope is kept within 45° so the forms print as vases. They stay fully editable in the profile editor.
 */
export interface PersianForm {
  id: string;
  name: I18nText;
  /** Shape intent in one line. */
  intent: I18nText;
  height: number;
  maxDiameter: number;
  points: { t: number; r: number }[];
}

const P = (pairs: number[]) => {
  const out: { t: number; r: number }[] = [];
  for (let k = 0; k < pairs.length; k += 2) out.push({ t: pairs[k], r: pairs[k + 1] });
  return out;
};

export const PERSIAN_FORMS: PersianForm[] = [
  {
    id: 'golabpash',
    name: { fa: 'گلاب‌پاش (الهام‌گرفته)', en: 'Golabpash (inspired by)' },
    intent: {
      fa: 'گلاب‌پاش: پایهٔ کوچک، بدنهٔ گرد و گردنی بلند و باریک که دهانه‌اش کمی باز می‌شود.',
      en: 'Rosewater sprinkler: small foot, round bulb, long slender neck opening slightly at the mouth.',
    },
    height: 220,
    maxDiameter: 130,
    // the foot stays ≥ 0.35 × height wide (stability); the shoulder closes at ≤ 45° (vase-mode overhang)
    points: P([
      0, 0.6, 5, 0.58, 13, 0.74, 24, 0.96, 32, 1, 40, 0.9, 50, 0.62, 60, 0.38, 68, 0.24, 78, 0.17, 92, 0.18, 100, 0.24,
    ]),
  },
  {
    id: 'seljukJar',
    name: { fa: 'خمرهٔ سلجوقی (الهام‌گرفته)', en: 'Seljuk storage jar (inspired by)' },
    intent: {
      fa: 'خمرهٔ انبار: بدنهٔ تخم‌مرغی پهن در میانه و گردنی کوتاه با لبهٔ کمی برگشته.',
      en: 'Storage jar: ovoid body widest at mid-height and a short neck with a slightly everted lip.',
    },
    height: 220,
    maxDiameter: 180,
    points: P([0, 0.45, 8, 0.62, 25, 0.88, 45, 1, 64, 0.92, 80, 0.68, 90, 0.5, 95, 0.46, 100, 0.52]),
  },
  {
    id: 'kashanBowl',
    name: { fa: 'کاسهٔ کاشان (الهام‌گرفته)', en: 'Kashan bowl (inspired by)' },
    intent: {
      fa: 'کاسهٔ پهن مخروطی روی پایهٔ حلقه‌ای کوچک، با دیوارهٔ صاف رو به بیرون.',
      en: 'Wide conical bowl on a small ring foot, with straight flaring walls.',
    },
    height: 120,
    maxDiameter: 220,
    points: P([0, 0.3, 4, 0.31, 16, 0.42, 42, 0.68, 75, 0.9, 100, 1]),
  },
  {
    id: 'safavidEwer',
    name: { fa: 'بدنهٔ آفتابهٔ صفوی (الهام‌گرفته)', en: 'Safavid ewer body (inspired by)' },
    intent: {
      fa: 'بدنهٔ گلابی‌شکل: پهن پایین، باریک‌شونده به گردنی بلند و دهانه‌ای کمی باز (بدون دسته و لوله).',
      en: 'Pear-shaped body: wide low belly narrowing into a tall neck with a slightly open mouth (no handle or spout).',
    },
    height: 240,
    maxDiameter: 150,
    points: P([0, 0.5, 6, 0.56, 20, 0.9, 30, 1, 45, 0.92, 62, 0.64, 75, 0.44, 86, 0.36, 95, 0.38, 100, 0.43]),
  },
  {
    id: 'qajarTrumpet',
    name: { fa: 'گلدان شیپوری قاجار (الهام‌گرفته)', en: 'Qajar trumpet vase (inspired by)' },
    intent: {
      fa: 'گلدان گل: بدنهٔ باریک با کمر و دهانهٔ شیپوری باز.',
      en: 'Flower vase: slim waisted body and a wide trumpet mouth.',
    },
    height: 220,
    maxDiameter: 130,
    points: P([0, 0.46, 10, 0.52, 34, 0.64, 54, 0.5, 70, 0.38, 84, 0.5, 100, 0.86]),
  },
];
