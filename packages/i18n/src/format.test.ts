import { resolveCurrency } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMoney, formatNumber } from './format';

/** Arabic amounts start with a right-to-left mark (U+200F); Intl adds it, not the platform. */
const RLM = '\u200f';
/** Intl separates a symbol from the digits with a no-break space (U+00A0). */
const NBSP = '\u00a0';

describe('formatMoney in English and Arabic (ADR 0020)', () => {
  it.each([
    ['ILS', 'en', '₪1,234.56'],
    ['ILS', 'ar', `${RLM}1,234.56${NBSP}₪`],
    ['USD', 'en', '$1,234.56'],
    ['USD', 'ar', `${RLM}1,234.56${NBSP}US$`],
    ['EUR', 'en', '€1,234.56'],
    ['EUR', 'ar', `${RLM}1,234.56${NBSP}€`],
    ['GBP', 'en', '£1,234.56'],
    ['GBP', 'ar', `${RLM}1,234.56${NBSP}UK£`],
  ] as const)('%s in %s', (code, locale, expected) => {
    expect(formatMoney(123_456, code, locale)).toBe(expected);
  });

  it('shows JOD in fils: three decimal places', () => {
    expect(formatMoney(123_456, 'JOD', 'en')).toBe(`JOD${NBSP}123.456`);
    expect(formatMoney(123_456, 'JOD', 'ar')).toBe(`${RLM}123.456${NBSP}د.أ.${RLM}`);
    expect(formatMoney(5, 'JOD', 'en')).toBe(`JOD${NBSP}0.005`);
  });

  it("uses the ISO decimal places even where Intl's own differ", () => {
    // CLDR shows IQD without decimals; the platform stores it in fils (3).
    expect(formatMoney(1_500, 'IQD', 'en')).toBe(`IQD${NBSP}1.500`);
  });

  it('never rounds through a float', () => {
    expect(formatMoney(999_999_999, 'ILS', 'en')).toBe('₪9,999,999.99');
    expect(formatMoney(1, 'ILS', 'en')).toBe('₪0.01');
    expect(formatMoney(-300, 'ILS', 'en')).toBe('-₪3.00');
  });

  it('places the sign of a surcharge for the locale', () => {
    expect(formatMoney(300, 'ILS', 'en', { sign: 'exceptZero' })).toBe('+₪3.00');
    expect(formatMoney(300, 'ILS', 'ar', { sign: 'exceptZero' })).toContain(`+3.00${NBSP}₪`);
  });
});

describe("formatMoney with the tenant's currency configuration", () => {
  it('writes the symbol override, with a space next to letters', () => {
    expect(formatMoney(5_000, resolveCurrency('JOD', { symbol: 'JD' }), 'en')).toBe(
      `JD${NBSP}5.000`,
    );
    expect(formatMoney(5_000, resolveCurrency('JOD', { symbol: 'JD' }), 'ar')).toContain(
      `5.000${NBSP}JD`,
    );
    expect(formatMoney(123_456, resolveCurrency('ILS', { symbol: 'NIS' }), 'en')).toBe(
      `NIS${NBSP}1,234.56`,
    );
    expect(formatMoney(123_456, resolveCurrency('USD', { symbol: '$' }), 'ar')).toBe(
      `${RLM}1,234.56${NBSP}$`,
    );
  });

  it('shows the code when the display is code, whatever the symbol', () => {
    expect(formatMoney(5_000, resolveCurrency('ILS', { display: 'code' }), 'en')).toBe(
      `ILS${NBSP}50.00`,
    );
    expect(formatMoney(5_000, resolveCurrency('ILS', { display: 'code' }), 'ar')).toBe(
      `${RLM}50.00${NBSP}ILS`,
    );
  });

  it('formats in the format locale on every screen when one is set', () => {
    const euro = resolveCurrency('EUR', { formatLocale: 'de-DE' });
    expect(formatMoney(123_456, euro, 'en')).toBe(`1.234,56${NBSP}€`);
    expect(formatMoney(123_456, euro, 'ar')).toBe(`1.234,56${NBSP}€`);
  });
});

describe('digits', () => {
  it('writes Arabic in Arabic-Indic digits when the tenant chose them', () => {
    expect(formatMoney(123_456, 'ILS', 'ar', { digits: 'arab' })).toBe(`${RLM}١٬٢٣٤٫٥٦${NBSP}₪`);
    expect(formatNumber(42, 'ar', { digits: 'arab' })).toBe('٤٢');
    expect(formatDateTime('2026-10-24T09:05:00Z', 'UTC', 'ar', { digits: 'arab' })).toContain(
      '٢٠٢٦',
    );
  });

  it('keeps English in Latin digits', () => {
    expect(formatMoney(123_456, 'ILS', 'en', { digits: 'arab' })).toBe('₪1,234.56');
    expect(formatNumber(42, 'en', { digits: 'arab' })).toBe('42');
  });

  it('defaults to Latin digits in Arabic', () => {
    expect(formatNumber(42, 'ar')).toBe('42');
  });
});
