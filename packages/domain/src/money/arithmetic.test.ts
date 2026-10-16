import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  allocateProportionally,
  applyBps,
  divideRoundHalfUp,
  formatMinorAsDecimal,
  inclusiveTaxPortion,
  multiplyMinor,
  parseDecimalToMinor,
  sumMinor,
} from './arithmetic';
import { currencyExponent, isSupportedCurrency } from './currency';

describe('divideRoundHalfUp', () => {
  it.each([
    [10, 4, 3], // 2.5 -> 3
    [9, 4, 2], // 2.25 -> 2
    [11, 4, 3], // 2.75 -> 3
    [-10, 4, -3], // half away from zero
    [-9, 4, -2],
    [0, 7, 0],
  ])('%i / %i = %i', (n, d, expected) => {
    expect(divideRoundHalfUp(n, d)).toBe(expected);
  });

  it('rejects non-integer input and non-positive denominators', () => {
    expect(() => divideRoundHalfUp(1.5, 2)).toThrow(DomainError);
    expect(() => divideRoundHalfUp(1, 0)).toThrow(DomainError);
    expect(() => divideRoundHalfUp(1, -2)).toThrow(DomainError);
  });
});

describe('applyBps', () => {
  it('computes a 15% tax on 18.50', () => {
    expect(applyBps(1850, 1500)).toBe(278); // 277.5 -> 278
  });

  it('computes a 10% discount on 20.00 exactly', () => {
    expect(applyBps(2000, 1000)).toBe(200);
  });

  it('avoids floating-point drift that 0.1 + 0.2 style math would cause', () => {
    // 3 × 0.10 at 5% in floats gives 0.015000000000000003; integers give 2 (1.5 rounds up).
    expect(applyBps(multiplyMinor(10, 3), 500)).toBe(2);
  });
});

describe('inclusiveTaxPortion', () => {
  it('extracts 15% VAT from a tax-inclusive 115.00', () => {
    expect(inclusiveTaxPortion(11500, 1500)).toBe(1500);
  });

  it('extracts 5% VAT from 10.00 inclusive', () => {
    expect(inclusiveTaxPortion(1000, 500)).toBe(48); // 47.619 -> 48
  });
});

describe('allocateProportionally', () => {
  it('always sums exactly to the total', () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(sumMinor(parts)).toBe(100);
  });

  it('allocates by weight', () => {
    expect(allocateProportionally(200, [1500, 500])).toEqual([150, 50]);
  });

  it('handles negative totals and zero weights', () => {
    expect(allocateProportionally(-10, [1, 1, 1])).toEqual([-4, -3, -3]);
    expect(allocateProportionally(10, [0, 0])).toEqual([0, 0]);
    expect(allocateProportionally(10, [])).toEqual([]);
  });

  it('rejects negative weights', () => {
    expect(() => allocateProportionally(10, [1, -1])).toThrow(DomainError);
  });
});

describe('decimal parsing and formatting', () => {
  it('parses per currency exponent', () => {
    expect(parseDecimalToMinor('18.5', 'SAR')).toBe(1850);
    expect(parseDecimalToMinor('18.500', 'KWD')).toBe(18500);
    expect(parseDecimalToMinor('7', 'USD')).toBe(700);
    expect(parseDecimalToMinor('-0.05', 'USD')).toBe(-5);
  });

  it('rejects too many decimals instead of rounding', () => {
    expect(() => parseDecimalToMinor('1.005', 'SAR')).toThrow(DomainError);
    expect(() => parseDecimalToMinor('abc', 'SAR')).toThrow(DomainError);
  });

  it('formats minor units', () => {
    expect(formatMinorAsDecimal(1850, 'SAR')).toBe('18.50');
    expect(formatMinorAsDecimal(5, 'KWD')).toBe('0.005');
    expect(formatMinorAsDecimal(-5, 'USD')).toBe('-0.05');
  });

  it('round-trips', () => {
    for (const value of ['0.00', '1.23', '999999.99']) {
      expect(formatMinorAsDecimal(parseDecimalToMinor(value, 'AED'), 'AED')).toBe(value);
    }
  });
});

describe('currency', () => {
  it('knows 2- and 3-decimal currencies', () => {
    expect(currencyExponent('SAR')).toBe(2);
    expect(currencyExponent('BHD')).toBe(3);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(() => currencyExponent('XYZ')).toThrow(DomainError);
  });
});

describe('overflow protection', () => {
  it('throws instead of losing precision', () => {
    expect(() => multiplyMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow(DomainError);
  });
});
