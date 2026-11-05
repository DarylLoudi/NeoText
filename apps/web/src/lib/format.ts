import { getLocale, translate } from './i18n';

const DASH = '—';

function num(value: number, locale: string, min: number, max: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value);
}

/**
 * Cost in USD. Null is blank, zero is "$0", anything under $0.0001 is "<$0.0001"
 * (never rounds a real cost down to "$0"), otherwise 2 to 4 decimals, so 0.042
 * stays "$0.042" and 1.5 becomes "$1.50".
 */
export function formatCost(usd: number | null, locale: string = getLocale()): string {
  if (usd === null) return '';
  if (usd === 0) return '$0';
  if (usd < 0.0001) return `<$${num(0.0001, locale, 4, 4)}`;
  return `$${usd >= 1 ? num(usd, locale, 2, 2) : num(usd, locale, 2, 4)}`;
}

/** Price per 1M tokens: whole dollars stay bare ("$15"), fractions show 2 to 3 decimals. */
export function formatPricePerM(perM: number | null, locale: string = getLocale()): string {
  if (perM === null) return DASH;
  if (perM === 0) return translate('common.free', { lng: locale });
  if (perM < 0.001) return `<$${num(0.001, locale, 3, 3)}`;
  if (Number.isInteger(perM)) return `$${num(perM, locale, 0, 0)}`;
  return `$${num(perM, locale, 2, 3)}`;
}

function compact(n: number, locale: string): string {
  if (n < 1000) return num(n, locale, 0, 0);
  const k = Math.round((n / 1000) * 10) / 10;
  if (k < 1000) return `${num(k, locale, 0, 1)}k`;
  return `${num(n / 1_000_000, locale, 0, 1)}M`;
}

export function formatTokens(n: number, locale: string = getLocale()): string {
  return compact(n, locale);
}

export function formatContext(n: number | null, locale: string = getLocale()): string {
  return n === null ? DASH : compact(n, locale);
}

export function formatDuration(ms: number, locale: string = getLocale()): string {
  const unit = (k: string) => translate(`common.units.${k}`, { lng: locale });
  if (ms < 1000) return `${num(Math.round(ms), locale, 0, 0)} ${unit('millisecond')}`;
  if (ms < 60_000) return `${num(Math.round(ms / 100) / 10, locale, 0, 1)} ${unit('second')}`;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const head = `${num(minutes, locale, 0, 0)} ${unit('minute')}`;
  return seconds === 0 ? head : `${head} ${num(seconds, locale, 0, 0)} ${unit('second')}`;
}

export type DateBucket =
  | { kind: 'today' | 'yesterday' | 'previous7' | 'previous30' }
  | { kind: 'month'; year: number; month: number };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Groups a timestamp by local calendar day relative to `now`. `month` is 1-12. */
export function dateBucket(ts: number, now: number): DateBucket {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'yesterday' };
  if (days <= 7) return { kind: 'previous7' };
  if (days <= 30) return { kind: 'previous30' };
  const d = new Date(ts);
  return { kind: 'month', year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** One formatter per locale and style: building one costs more than formatting a date. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateFormat(locale: string, style: 'month' | 'time'): Intl.DateTimeFormat {
  const key = `${style}|${locale}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      locale,
      style === 'month'
        ? { month: 'long', year: 'numeric' }
        : { hour: 'numeric', minute: '2-digit' },
    );
    formatters.set(key, format);
  }
  return format;
}

/** `month` is 1-12. */
export function formatMonth(year: number, month: number, locale: string): string {
  return dateFormat(locale, 'month').format(new Date(year, month - 1, 1));
}

export function formatTime(ts: number, locale: string): string {
  return dateFormat(locale, 'time').format(new Date(ts));
}
