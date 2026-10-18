import en from './en.json';
import fa from './fa.json';

export type Lang = 'fa' | 'en';
export type MsgKey = keyof typeof en;

const DICTS: Record<Lang, Record<string, string>> = { fa, en };

export function translate(lang: Lang, key: MsgKey): string {
  return DICTS[lang][key] ?? DICTS.en[key] ?? key;
}

const nf = { fa: new Intl.NumberFormat('fa-IR'), en: new Intl.NumberFormat('en-US') };
const nfd: Record<string, Intl.NumberFormat> = {};

/** Locale number formatting (Persian digits in fa). `fixed` keeps trailing zeros (50.90, not 50.9). */
export function formatNumber(lang: Lang, x: number, digits = 0, fixed = false): string {
  if (digits === 0) return nf[lang].format(Math.round(x));
  const k = `${lang}${digits}${fixed ? 'f' : ''}`;
  nfd[k] ??= new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: fixed ? digits : 0,
  });
  return nfd[k].format(x);
}
