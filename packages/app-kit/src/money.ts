import {
  DomainError,
  formatMinorAsDecimal,
  parseDecimalToMinor,
  resolveCurrency,
} from '@pos/domain';
import { formatMoney } from '@pos/i18n';
import type { CurrencyConfiguration } from '@pos/shared-types';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';
import { useCurrentLocale } from './locale';
import { useFormatOptions, useLocalization } from './localization';

export type SignDisplay = 'auto' | 'exceptZero';

/**
 * The configuration to show amounts of `code` with: the tenant's (ADR 0020) when it is the
 * tenant's currency, else MADAR's display of that currency. Without a code, the tenant's.
 */
export function moneyConfiguration(
  code: string | null | undefined,
  tenant: CurrencyConfiguration | null,
): CurrencyConfiguration | null {
  const wanted = code ?? tenant?.code ?? null;
  if (!wanted) return null;
  return tenant?.code === wanted ? tenant : resolveCurrency(wanted);
}

/**
 * Money formatting in the active language with the tenant's currency configuration (symbol,
 * display, format locale) and digit style. `currency` is the amount's own currency (an order's,
 * a menu's), which is the tenant's; leave it out to use the tenant's directly. Formats exact
 * decimal strings: never a float.
 */
export function useMoneyFormat(currency?: string | null) {
  const locale = useCurrentLocale();
  const options = useFormatOptions();
  const tenant = useLocalization().currency;
  const config = useMemo(() => moneyConfiguration(currency, tenant), [currency, tenant]);
  const format = useCallback(
    (minor: number, signOptions?: { sign?: SignDisplay }) =>
      config ? formatMoney(minor, config, locale, { ...options, ...signOptions }) : String(minor),
    [config, locale, options],
  );
  const toInput = useCallback(
    (minor: number | null) =>
      minor === null || !config ? '' : formatMinorAsDecimal(minor, config.code),
    [config],
  );
  return { currency: config?.code ?? null, config, format, toInput };
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
