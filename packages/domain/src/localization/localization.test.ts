import { LOCALES } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { formatMinorAsDecimal, parseDecimalToMinor } from '../money/arithmetic';
import { SUPPORTED_CURRENCIES, currencyExponent } from '../money/currency';
import {
  resolveCurrency,
  resolveLocales,
  selectLocale,
  showsLanguageSwitcher,
} from './resolve-localization';

describe('the currency table (ISO 4217 minor units)', () => {
  it.each([
    ['ILS', 2],
    ['USD', 2],
    ['EUR', 2],
    ['GBP', 2],
    ['JOD', 3],
    ['SAR', 2],
    ['AED', 2],
    ['EGP', 2],
    ['KWD', 3],
    ['BHD', 3],
    ['OMR', 3],
    ['IQD', 3],
    ['TND', 3],
  ])('%s has %i decimal places', (code, places) => {
    expect(currencyExponent(code)).toBe(places);
  });

  it('round-trips minor units through decimals in every supported currency', () => {
    for (const code of SUPPORTED_CURRENCIES) {
      const places = currencyExponent(code);
      for (const minor of [0, 1, 5, 99, 100, 1234, 1_000_001, 999_999_999]) {
        const decimal = formatMinorAsDecimal(minor, code);
        expect(decimal.split('.')[1]).toHaveLength(places);
        expect(parseDecimalToMinor(decimal, code)).toBe(minor);
      }
    }
  });

  it('reads JOD in fils and rejects a fourth decimal instead of rounding', () => {
    expect(parseDecimalToMinor('12.345', 'JOD')).toBe(12_345);
    expect(formatMinorAsDecimal(12_345, 'JOD')).toBe('12.345');
    expect(parseDecimalToMinor('0.1', 'JOD')).toBe(100);
    expect(() => parseDecimalToMinor('1.2345', 'JOD')).toThrow(DomainError);
    expect(() => parseDecimalToMinor('1.005', 'ILS')).toThrow(DomainError);
  });
});

describe('resolveCurrency', () => {
  it('gives the shekel its symbol by default', () => {
    expect(resolveCurrency('ILS')).toEqual({
      code: 'ILS',
      decimalPlaces: 2,
      symbol: '₪',
      display: 'narrowSymbol',
      formatLocale: null,
      sources: { symbol: 'PLATFORM', display: 'PLATFORM', formatLocale: 'PLATFORM' },
    });
  });

  it("leaves other currencies to Intl's symbols", () => {
    expect(resolveCurrency('USD')).toMatchObject({ symbol: null, decimalPlaces: 2 });
    expect(resolveCurrency('JOD')).toMatchObject({ symbol: null, decimalPlaces: 3 });
  });

  it("applies the tenant's settings and names their layer; null inherits", () => {
    const resolved = resolveCurrency('JOD', {
      symbol: 'JD',
      display: null,
      formatLocale: 'ar-JO',
    });
    expect(resolved).toMatchObject({
      symbol: 'JD',
      display: 'narrowSymbol',
      formatLocale: 'ar-JO',
      decimalPlaces: 3,
      sources: { symbol: 'TENANT', display: 'PLATFORM', formatLocale: 'TENANT' },
    });
    expect(resolveCurrency('ILS', { display: 'code' })).toMatchObject({
      symbol: '₪',
      display: 'code',
    });
  });

  it('refuses a currency the platform does not support', () => {
    expect(() => resolveCurrency('XYZ')).toThrow(DomainError);
  });
});

describe('resolveLocales', () => {
  it('keeps the platform order and always includes the default', () => {
    expect(resolveLocales({ defaultLocale: 'ar', supportedLocales: ['ar', 'en'] })).toEqual({
      default: 'ar',
      supported: ['en', 'ar'],
      digits: 'latn',
      sources: { digits: 'PLATFORM' },
    });
    expect(resolveLocales({ defaultLocale: 'ar', supportedLocales: [] }).supported).toEqual(['ar']);
    expect(resolveLocales({ defaultLocale: 'en', supportedLocales: null }).supported).toEqual([
      'en',
    ]);
  });

  it('takes the tenant digit style', () => {
    expect(
      resolveLocales({ defaultLocale: 'ar', supportedLocales: ['ar'], digits: 'arab' }),
    ).toMatchObject({ digits: 'arab', sources: { digits: 'TENANT' } });
  });
});

describe('selectLocale', () => {
  const both = ['en', 'ar'] as const;

  it("prefers the device's own choice when the tenant offers it", () => {
    expect(selectLocale({ stored: 'ar', preferred: 'en', supported: both, fallback: 'en' })).toBe(
      'ar',
    );
  });

  it("falls back to the user's preferred locale, then to the tenant default", () => {
    expect(selectLocale({ stored: null, preferred: 'ar', supported: both, fallback: 'en' })).toBe(
      'ar',
    );
    expect(selectLocale({ stored: null, preferred: null, supported: both, fallback: 'ar' })).toBe(
      'ar',
    );
  });

  it('skips choices the tenant does not offer', () => {
    expect(selectLocale({ stored: 'en', preferred: 'en', supported: ['ar'], fallback: 'ar' })).toBe(
      'ar',
    );
    expect(selectLocale({ stored: 'ar', preferred: 'en', supported: ['en'], fallback: 'en' })).toBe(
      'en',
    );
    expect(
      selectLocale({ stored: 'en', preferred: 'ar', supported: ['ar', 'en'], fallback: 'ar' }),
    ).toBe('en');
  });

  it('a website visitor without a choice gets the tenant default', () => {
    expect(selectLocale({ stored: null, preferred: null, supported: both, fallback: 'ar' })).toBe(
      'ar',
    );
  });
});

describe('showsLanguageSwitcher', () => {
  it('hides the switcher for a single-locale tenant', () => {
    expect(showsLanguageSwitcher(['ar'])).toBe(false);
    expect(showsLanguageSwitcher(['en'])).toBe(false);
    expect(showsLanguageSwitcher(LOCALES)).toBe(true);
  });
});
