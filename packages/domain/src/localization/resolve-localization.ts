import {
  CURRENCY_DISPLAY_KEYS,
  type CurrencyDisplayKey,
  type CurrencyDisplayValues,
  type DigitStyle,
  LOCALES,
  type Locale,
  type ResolvedCurrency,
  type ResolvedLocales,
} from '@pos/shared-types';
import { type LayerValues, resolveLayered } from '../config/resolve-layered';
import { currencyExponent } from '../money/currency';

/**
 * Symbols MADAR writes instead of `Intl`'s, per currency. `Intl` already writes ₪ for the shekel
 * in English and Arabic; the default keeps it ₪ whatever display or format locale is chosen.
 */
export const PLATFORM_CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { ILS: '₪' };

/** MADAR's currency display for every tenant: the narrow symbol, in the screen's language. */
export const PLATFORM_CURRENCY_DISPLAY: Omit<CurrencyDisplayValues, 'symbol'> = {
  display: 'narrowSymbol',
  formatLocale: null,
};

/** MADAR's digits: Latin, also in Arabic. */
export const PLATFORM_DIGIT_STYLE: DigitStyle = 'latn';

/** What the tenant set; null or missing inherits. */
export type CurrencyDisplayLayer = { [K in CurrencyDisplayKey]?: CurrencyDisplayValues[K] | null };

/** The layer without its unset values: null inherits, like a missing key. */
function present(
  layer: CurrencyDisplayLayer | null | undefined,
): LayerValues<CurrencyDisplayKey, unknown> {
  const out: LayerValues<CurrencyDisplayKey, unknown> = {};
  for (const key of CURRENCY_DISPLAY_KEYS) {
    const value = layer?.[key];
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Resolves how a tenant's amounts are shown (ADR 0020, docs/configuration.md): MADAR's defaults,
 * then the tenant. The decimal places come from the currency code (ISO 4217) and cannot be set;
 * an unsupported code throws `UNSUPPORTED_CURRENCY`. Pure: the cloud, the hub and the apps
 * resolve the same way; without a tenant layer it is MADAR's display of that currency.
 */
export function resolveCurrency(
  code: string,
  tenant: CurrencyDisplayLayer | null = null,
): ResolvedCurrency {
  const decimalPlaces = currencyExponent(code);
  const resolved = resolveLayered<CurrencyDisplayKey, unknown>(CURRENCY_DISPLAY_KEYS, {
    PLATFORM: { ...PLATFORM_CURRENCY_DISPLAY, symbol: PLATFORM_CURRENCY_SYMBOLS[code] ?? null },
    TENANT: present(tenant),
  });
  return {
    code,
    decimalPlaces,
    symbol: resolved.symbol.value as CurrencyDisplayValues['symbol'],
    display: resolved.display.value as CurrencyDisplayValues['display'],
    formatLocale: resolved.formatLocale.value as CurrencyDisplayValues['formatLocale'],
    sources: {
      symbol: resolved.symbol.source,
      display: resolved.display.source,
      formatLocale: resolved.formatLocale.source,
    },
  };
}

export interface LocalesInput {
  defaultLocale: Locale;
  /** As stored; an empty or missing list means the default locale alone. */
  supportedLocales?: readonly Locale[] | null;
  /** The tenant's digit style; null inherits MADAR's. */
  digits?: DigitStyle | null;
}

/**
 * The languages a tenant offers (ADR 0020): its supported locales in the platform's order, always
 * including its default, and its digit style (MADAR's Latin unless the tenant chose).
 */
export function resolveLocales(input: LocalesInput): ResolvedLocales {
  const chosen = new Set<Locale>([...(input.supportedLocales ?? []), input.defaultLocale]);
  const digits = resolveLayered<'digits', DigitStyle>(['digits'], {
    PLATFORM: { digits: PLATFORM_DIGIT_STYLE },
    TENANT: input.digits ? { digits: input.digits } : {},
  }).digits;
  return {
    default: input.defaultLocale,
    supported: LOCALES.filter((l) => chosen.has(l)),
    digits: digits.value,
    sources: { digits: digits.source },
  };
}

export interface LocaleChoice {
  /** The locale this device or browser chose with the language switcher; null: none. */
  stored: Locale | null;
  /** The signed-in user's preferred locale; null: nobody signed in (or the website). */
  preferred: Locale | null;
  supported: readonly Locale[];
  /** The tenant's default locale. */
  fallback: Locale;
}

/**
 * The language a screen shows for a tenant (ADR 0020): the device's own choice if the tenant
 * offers it, else the signed-in user's preferred locale if offered, else the tenant's default.
 * The customer website has no user: the visitor's choice, else the tenant's default.
 */
export function selectLocale({ stored, preferred, supported, fallback }: LocaleChoice): Locale {
  if (stored && supported.includes(stored)) return stored;
  if (preferred && supported.includes(preferred)) return preferred;
  return fallback;
}

/** A language switcher is shown only when there is something to switch to. */
export function showsLanguageSwitcher(supported: readonly Locale[]): boolean {
  return supported.length > 1;
}
