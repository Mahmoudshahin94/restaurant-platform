import { formatMinorAsDecimal, resolveCurrency } from '@pos/domain';
import type { CurrencyConfiguration, DigitStyle, Locale } from '@pos/shared-types';

export type { DigitStyle };

export interface FormatOptions {
  /** Arabic may be written in Latin (0-9) or Arabic-Indic (٠-٩) digits; tenants choose (ADR 0020). */
  digits?: DigitStyle;
}

export interface MoneyFormatOptions extends FormatOptions {
  /** `exceptZero` renders surcharges as "+3.00" with the sign placed correctly for the locale. */
  sign?: 'auto' | 'exceptZero';
}

/**
 * The `Intl` locale for a language (or a tenant's format locale such as `ar-JO`) with its
 * numbering system. Arabic-Indic digits apply to Arabic only: English stays in Latin digits.
 */
function localeTag(locale: string, { digits = 'latn' }: FormatOptions = {}): string {
  const arabic = locale === 'ar' || locale.startsWith('ar-');
  return `${locale}-u-nu-${arabic ? digits : 'latn'}`;
}

/** A letter at the edge of a symbol needs a space between it and the digits ("JD 5.000"). */
const LETTER = /\p{L}/u;

/**
 * Formats integer minor units as localized money without converting to a float: the exact
 * decimal string is passed to Intl.NumberFormat, which formats strings losslessly.
 *
 * `currency` is the tenant's configuration (ADR 0020): its symbol (₪ by default for ILS), its
 * display (narrow symbol, symbol or code) and its format locale, which, when set, wins over the
 * screen's language. A bare currency code means MADAR's defaults for it. Amounts always show the
 * currency's ISO decimal places (three for JOD), never `Intl`'s own guess.
 */
export function formatMoney(
  minorUnits: number,
  currency: CurrencyConfiguration | string,
  locale: Locale,
  options?: MoneyFormatOptions,
): string {
  const config = typeof currency === 'string' ? resolveCurrency(currency) : currency;
  const decimal = formatMinorAsDecimal(minorUnits, config.code);
  const formatter = new Intl.NumberFormat(localeTag(config.formatLocale ?? locale, options), {
    style: 'currency',
    currency: config.code,
    currencyDisplay: config.display,
    minimumFractionDigits: config.decimalPlaces,
    maximumFractionDigits: config.decimalPlaces,
    signDisplay: options?.sign ?? 'auto',
  });
  // Intl.NumberFormat accepts decimal strings (ES2023); the casts satisfy older lib typings.
  const value = decimal as unknown as number;
  const symbol = config.symbol;
  if (symbol === null || config.display === 'code') return formatter.format(value);
  const parts = formatter.formatToParts(value);
  return parts
    .map((part, i) => {
      if (part.type !== 'currency') return part.value;
      const before = parts[i - 1];
      const after = parts[i + 1];
      const spaceBefore = before && before.type !== 'literal' && LETTER.test(symbol.at(0) ?? '');
      const spaceAfter = after && after.type !== 'literal' && LETTER.test(symbol.at(-1) ?? '');
      return `${spaceBefore ? '\u00a0' : ''}${symbol}${spaceAfter ? '\u00a0' : ''}`;
    })
    .join('');
}

export function formatNumber(value: number, locale: Locale, options?: FormatOptions): string {
  return new Intl.NumberFormat(localeTag(locale, options)).format(value);
}

/** Formats a UTC instant in the location's timezone; conversion happens only here, at presentation. */
export function formatDateTime(
  isoUtc: string,
  timeZone: string,
  locale: Locale,
  options?: FormatOptions,
): string {
  return new Intl.DateTimeFormat(localeTag(locale, options), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(isoUtc));
}

/** The time of day of a UTC instant in the location's timezone (e.g. "14:30" / "2:30 PM"). */
export function formatTime(
  isoUtc: string,
  timeZone: string,
  locale: Locale,
  options?: FormatOptions,
): string {
  return new Intl.DateTimeFormat(localeTag(locale, options), {
    timeStyle: 'short',
    timeZone,
  }).format(new Date(isoUtc));
}

/**
 * A business date (YYYY-MM-DD, already the location's calendar day) as a localized date. It is
 * formatted in UTC so no time-zone conversion can move it to another day.
 */
export function formatBusinessDate(date: string, locale: Locale, options?: FormatOptions): string {
  return new Intl.DateTimeFormat(localeTag(locale, options), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Basis points as a localized percentage (2500 → "25%", 4523 → "45.2%"). */
export function formatBps(bps: number, locale: Locale, options?: FormatOptions): string {
  return new Intl.NumberFormat(localeTag(locale, options), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(bps / 10_000);
}
