import { DomainError, formatMinorAsDecimal, parseDecimalToMinor } from '@pos/domain';
import { formatMoney } from '@pos/i18n';
import { useCallback } from 'react';
import { z } from 'zod';
import { useCurrentLocale } from './locale';

export type SignDisplay = 'auto' | 'exceptZero';

/** Money formatting bound to a currency and the active locale. */
export function useMoneyFormat(currency: string | null) {
  const locale = useCurrentLocale();
  const format = useCallback(
    (minor: number, options?: { sign?: SignDisplay }) =>
      currency ? formatMoney(minor, currency, locale, options) : String(minor),
    [currency, locale],
  );
  const toInput = useCallback(
    (minor: number | null) =>
      minor === null || !currency ? '' : formatMinorAsDecimal(minor, currency),
    [currency],
  );
  return { currency, format, toInput };
}

function parseMoney(value: string, currency: string, ctx: z.RefinementCtx): number {
  try {
    const minor = parseDecimalToMinor(value, currency);
    if (minor < 0) throw new DomainError('INVALID_MONEY_AMOUNT', 'negative');
    return minor;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'common:validation.invalidAmount' });
    return 0;
  }
}

/**
 * Form field for a money amount typed as a decimal string ("18.50"). Parsed to integer minor
 * units with the currency's precision; extra decimals are rejected, never rounded.
 */
export function moneyField(currency: string) {
  return z
    .string()
    .trim()
    .min(1, 'common:validation.required')
    .transform((value, ctx) => parseMoney(value, currency, ctx));
}

/** Like moneyField, but an empty input means "no value" (null). */
export function optionalMoneyField(currency: string) {
  return z
    .string()
    .trim()
    .transform((value, ctx) => (value === '' ? null : parseMoney(value, currency, ctx)));
}
