import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { priceOrder } from '../pricing';
import {
  averageMinor,
  businessDatesInRange,
  businessDaysInRange,
  shareBps,
  splitRefund,
} from './reports';

describe('splitRefund', () => {
  it('gives back exactly the order figures for a full refund', () => {
    // Tax-exclusive: 100.00 + 15% VAT + 5.00 untaxed fee.
    expect(splitRefund(12_000, { total: 12_000, taxes: [1_500], fees: 500 })).toEqual({
      taxes: [1_500],
      fees: 500,
      netSales: 10_000,
    });
  });

  it('splits a partial refund in proportion and always sums to the refund', () => {
    const split = splitRefund(1_000, { total: 11_500, taxes: [1_500], fees: 0 });
    expect(split).toEqual({ taxes: [130], fees: 0, netSales: 870 });
    for (const amount of [1, 2, 3, 333, 999, 5_751, 11_499]) {
      const s = splitRefund(amount, { total: 11_500, taxes: [1_000, 500], fees: 250 });
      expect(s.taxes.reduce((a, b) => a + b, 0) + s.fees + s.netSales).toBe(amount);
    }
  });

  it('matches the pricing engine on a tax-inclusive order (3-decimal currency)', () => {
    const priced = priceOrder({
      taxInclusive: true,
      lines: [
        { lineId: 'a', unitPrice: 2_750, quantity: 2, taxes: [{ taxId: 'vat', rateBps: 1_000 }] },
      ],
      discounts: [],
    });
    const sale = { total: priced.total, taxes: [priced.tax], fees: priced.fees };
    expect(splitRefund(priced.total, sale)).toEqual({
      taxes: [priced.tax],
      fees: 0,
      netSales: priced.total - priced.tax,
    });
    // Half of a 5.500 KWD order including 0.500 tax.
    expect(splitRefund(2_750, sale)).toEqual({ taxes: [250], fees: 0, netSales: 2_500 });
  });

  it('handles untaxed orders and zero refunds', () => {
    expect(splitRefund(400, { total: 1_000, taxes: [], fees: 0 })).toEqual({
      taxes: [],
      fees: 0,
      netSales: 400,
    });
    expect(splitRefund(0, { total: 1_000, taxes: [100], fees: 0 })).toEqual({
      taxes: [0],
      fees: 0,
      netSales: 0,
    });
  });

  it('refuses inconsistent sales', () => {
    expect(() => splitRefund(100, { total: 0, taxes: [], fees: 0 })).toThrow(DomainError);
    expect(() => splitRefund(100, { total: 100, taxes: [200], fees: 0 })).toThrow(DomainError);
    expect(() => splitRefund(-1, { total: 100, taxes: [], fees: 0 })).toThrow(DomainError);
  });
});

describe('report arithmetic', () => {
  it('averages and shares with half-up rounding', () => {
    expect(averageMinor(1_000, 3)).toBe(333);
    expect(averageMinor(1_001, 2)).toBe(501);
    expect(averageMinor(500, 0)).toBe(0);
    expect(shareBps(1, 3)).toBe(3_333);
    expect(shareBps(2, 3)).toBe(6_667);
    expect(shareBps(5, 0)).toBe(0);
  });

  it('lists business dates across month and year ends', () => {
    expect(businessDatesInRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(businessDaysInRange('2026-10-01', '2026-10-01')).toBe(1);
    expect(businessDaysInRange('2028-01-01', '2028-12-31')).toBe(366);
    expect(businessDatesInRange('2026-10-02', '2026-10-01')).toEqual([]);
  });
});
