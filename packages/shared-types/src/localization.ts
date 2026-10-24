/**
 * Currency display and languages (ADR 0020). The tenant's currency is fixed when it is
 * provisioned (ADR 0002); how amounts look (symbol, display, format locale) and which languages
 * its screens offer are configuration, resolved in layers (docs/configuration.md): MADAR's
 * defaults, then the tenant.
 */
import type { Locale } from './enums';
import type { ConfigLayer } from './features';

type ValueOf<T> = T[keyof T];

/** The currency of a tenant provisioned without one: MADAR's home market (ADR 0020). */
export const DEFAULT_TENANT_CURRENCY = 'ILS';

/** How the currency is written next to an amount (`Intl.NumberFormat`'s `currencyDisplay`). */
export const CurrencyDisplay = {
  /** The shortest local symbol: ₪, $, €, £. */
  NARROW_SYMBOL: 'narrowSymbol',
  /** The symbol that cannot be confused abroad: US$, UK£, and ₪ for the shekel. */
  SYMBOL: 'symbol',
  /** The ISO 4217 code: ILS, USD. */
  CODE: 'code',
} as const;
export type CurrencyDisplay = ValueOf<typeof CurrencyDisplay>;
export const CURRENCY_DISPLAYS = Object.values(CurrencyDisplay) as readonly CurrencyDisplay[];

/**
 * The digits numbers are written in when the language is Arabic: Latin (0-9) or Arabic-Indic
 * (٠-٩). CLDR numbering-system names. English is always written in Latin digits.
 */
export const DigitStyle = { LATN: 'latn', ARAB: 'arab' } as const;
export type DigitStyle = ValueOf<typeof DigitStyle>;
export const DIGIT_STYLES = Object.values(DigitStyle) as readonly DigitStyle[];

/**
 * Locales a tenant may format amounts in regardless of the screen's language: a closed list, so
 * the admin can offer it and nothing a tenant types reaches `Intl` unchecked. Without one,
 * amounts follow the screen's language.
 */
export const FORMAT_LOCALES = [
  'en-US',
  'en-GB',
  'ar-PS',
  'ar-JO',
  'ar-SA',
  'ar-AE',
  'fr-FR',
  'de-DE',
] as const;
export type FormatLocale = (typeof FORMAT_LOCALES)[number];

/** Longest currency symbol a tenant may set (₪, NIS, د.أ, JD…). */
export const CURRENCY_SYMBOL_MAX_LENGTH = 8;

/** The currency settings a tenant may change. Its currency and decimal places are not among them. */
export interface CurrencyDisplayValues {
  /** Written instead of the currency's own symbol; null: `Intl`'s symbol for the display. */
  symbol: string | null;
  display: CurrencyDisplay;
  /** Amounts are formatted in this locale on every screen; null: the screen's language. */
  formatLocale: FormatLocale | null;
}
export type CurrencyDisplayKey = keyof CurrencyDisplayValues;
export const CURRENCY_DISPLAY_KEYS = [
  'symbol',
  'display',
  'formatLocale',
] as const satisfies readonly CurrencyDisplayKey[];

/** Everything needed to show an amount of a tenant's money. */
export interface CurrencyConfiguration extends CurrencyDisplayValues {
  /** ISO 4217; fixed when the tenant is provisioned. */
  code: string;
  /** ISO 4217 minor-unit digits (2 for ILS, 3 for JOD): derived from the code, never set. */
  decimalPlaces: number;
}

/** A tenant's currency as resolved, with the layer each display setting came from. */
export interface ResolvedCurrency extends CurrencyConfiguration {
  sources: Record<CurrencyDisplayKey, ConfigLayer>;
}

/** The languages a tenant offers and how they write numbers. */
export interface LocaleConfiguration {
  /** What a screen shows when nothing else decides; always among `supported`. */
  default: Locale;
  supported: Locale[];
  digits: DigitStyle;
}

/** A tenant's languages as resolved, with the layer the digit style came from. */
export interface ResolvedLocales extends LocaleConfiguration {
  sources: { digits: ConfigLayer };
}
