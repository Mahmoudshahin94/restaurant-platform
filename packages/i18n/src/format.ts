import { formatMinorAsDecimal } from '@pos/domain';
import type { Locale } from '@pos/shared-types';

/** Arabic UIs may show Latin (0-9) or Arabic-Indic (٠-٩) digits; restaurants choose. */
export type DigitStyle = 'latn' | 'arab';

export interface FormatOptions {
  digits?: DigitStyle;
}

export interface MoneyFormatOptions extends FormatOptions {
  /** `exceptZero` renders surcharges as "+3.00" with the sign placed correctly for the locale. */
  sign?: 'auto' | 'exceptZero';
}

function localeTag(locale: Locale, { digits = 'latn' }: FormatOptions = {}): string {
  return `${locale}-u-nu-${digits}`;
}

/**
 * Formats integer minor units as localized currency without converting to a float: the exact
 * decimal string is passed to Intl.NumberFormat, which formats strings losslessly.
 */
export function formatMoney(
  minorUnits: number,
  currency: string,
  locale: Locale,
  options?: MoneyFormatOptions,
): string {
  const decimal = formatMinorAsDecimal(minorUnits, currency);
  const formatter = new Intl.NumberFormat(localeTag(locale, options), {
    style: 'currency',
    currency,
    signDisplay: options?.sign ?? 'auto',
  });
  // Intl.NumberFormat.format accepts decimal strings (ES2023); the cast satisfies older lib typings.
  return formatter.format(decimal as unknown as number);
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
