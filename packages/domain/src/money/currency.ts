import { DomainError } from '../errors';

/**
 * ISO 4217 minor-unit exponents for the currencies the platform supports. A tenant's
 * currency is configuration; adding a currency means adding it here (validated server-side).
 */
const CURRENCY_EXPONENTS = {
  AED: 2,
  BHD: 3,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LBP: 2,
  MAD: 2,
  OMR: 3,
  QAR: 2,
  SAR: 2,
  TND: 3,
  TRY: 2,
  USD: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENTS) as CurrencyCode[];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return Object.hasOwn(CURRENCY_EXPONENTS, code);
}

/** Number of minor-unit digits, e.g. 2 for SAR (halala), 3 for KWD (fils). */
export function currencyExponent(code: string): number {
  if (!isSupportedCurrency(code)) {
    throw new DomainError('UNSUPPORTED_CURRENCY', `Unsupported currency ${code}`, {
      currency: code,
    });
  }
  return CURRENCY_EXPONENTS[code];
}
