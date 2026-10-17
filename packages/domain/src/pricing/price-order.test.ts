import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { priceOrder } from './price-order';
import type { PricingLineInput } from './types';

const VAT10 = { taxId: 'vat', rateBps: 1000 };
const VAT15 = { taxId: 'vat15', rateBps: 1500 };
const CITY = { taxId: 'city', rateBps: 500 };

const line = (
  lineId: string,
  unitPrice: number,
  quantity = 1,
  taxes = [VAT10],
): PricingLineInput => ({
  lineId,
  unitPrice,
  quantity,
  taxes,
});

describe('priceOrder — tax exclusive', () => {
  it('matches the specification example (2000 − 200 + 180 = 1980)', () => {
    const p = priceOrder({
      taxInclusive: false,
      lines: [line('a', 1000, 2)],
      discounts: [{ discountId: 'd', type: 'PERCENTAGE', value: 1000 }],
    });
    expect(p).toMatchObject({ subtotal: 2000, discount: 200, tax: 180, fees: 0, total: 1980 });
    expect(p.lines[0]).toMatchObject({
      gross: 2000,
      discount: 200,
      net: 1800,
      tax: 180,
      total: 1980,
    });
    expect(p.taxBreakdown).toEqual([
      { taxId: 'vat', rateBps: 1000, taxableAmount: 1800, amount: 180 },
    ]);
  });

  it('rounds tax per line, half up', () => {
    const p = priceOrder({
      taxInclusive: false,
      lines: [line('a', 1850, 1, [VAT15]), line('b', 999, 1, [VAT15])],
    });
    // 277.5 → 278, 149.85 → 150
    expect(p.lines.map((l) => l.tax)).toEqual([278, 150]);
    expect(p.tax).toBe(428);
    expect(p.total).toBe(1850 + 999 + 428);
  });

  it('applies multiple taxes and tax-free lines', () => {
    const p = priceOrder({
      taxInclusive: false,
      lines: [line('a', 1000, 1, [VAT10, CITY]), line('b', 500, 1, [])],
    });
    expect(p.lines[0]!.taxes).toEqual([
      { taxId: 'vat', amount: 100 },
      { taxId: 'city', amount: 50 },
    ]);
    expect(p.lines[1]!.tax).toBe(0);
    expect(p.total).toBe(1650);
  });

  it('allocates order discounts across lines exactly, by weight', () => {
    const p = priceOrder({
      taxInclusive: false,
      lines: [line('a', 333), line('b', 333), line('c', 334)],
      discounts: [{ discountId: 'd', type: 'FIXED', value: 100 }],
    });
    expect(p.lines.map((l) => l.discount).reduce((a, b) => a + b, 0)).toBe(100);
    expect(p.lines.map((l) => l.discount)).toEqual([33, 33, 34]);
  });

  it('caps discounts at the subtotal and applies them in order', () => {
    const p = priceOrder({
      taxInclusive: false,
      lines: [line('a', 1000)],
      discounts: [
        { discountId: 'half', type: 'PERCENTAGE', value: 5000 },
        { discountId: 'big', type: 'FIXED', value: 9999 },
      ],
    });
    expect(p.appliedDiscounts).toEqual([
      { discountId: 'half', amount: 500 },
      { discountId: 'big', amount: 500 },
    ]);
    expect(p).toMatchObject({ discount: 1000, tax: 0, total: 0 });
  });

  it('adds fees (not discounted) with their own taxes', () => {
    const p = priceOrder({
      taxInclusive: false,
      lines: [line('a', 1000)],
      discounts: [{ discountId: 'd', type: 'PERCENTAGE', value: 10_000 }],
      fees: [{ feeId: 'delivery', amount: 500, taxes: [VAT10] }],
    });
    expect(p).toMatchObject({ subtotal: 1000, discount: 1000, fees: 500, tax: 50, total: 550 });
  });
});

describe('priceOrder — tax inclusive', () => {
  it('extracts tax from inclusive prices without changing the total', () => {
    const p = priceOrder({ taxInclusive: true, lines: [line('a', 11500, 1, [VAT15])] });
    expect(p).toMatchObject({ subtotal: 11500, tax: 1500, total: 11500 });
    expect(p.taxBreakdown[0]).toEqual({
      taxId: 'vat15',
      rateBps: 1500,
      taxableAmount: 10000,
      amount: 1500,
    });
  });

  it('splits a combined inclusive portion across taxes exactly', () => {
    const p = priceOrder({ taxInclusive: true, lines: [line('a', 1150, 1, [VAT10, CITY])] });
    // 1150 × 1500 / 11500 = 150 → split 2:1
    expect(p.lines[0]!.taxes).toEqual([
      { taxId: 'vat', amount: 100 },
      { taxId: 'city', amount: 50 },
    ]);
    expect(p.total).toBe(1150);
  });

  it('computes inclusive tax after discounts', () => {
    const p = priceOrder({
      taxInclusive: true,
      lines: [line('a', 2300, 1, [VAT15])],
      discounts: [{ discountId: 'd', type: 'FIXED', value: 1150 }],
    });
    expect(p).toMatchObject({ discount: 1150, tax: 150, total: 1150 });
  });
});

describe('priceOrder — validation', () => {
  it('handles empty orders', () => {
    expect(priceOrder({ taxInclusive: false, lines: [] })).toMatchObject({
      subtotal: 0,
      total: 0,
      tax: 0,
    });
  });

  it.each([0, -1, 1.5, 1000])('rejects quantity %s', (quantity) => {
    expect(() => priceOrder({ taxInclusive: false, lines: [line('a', 100, quantity)] })).toThrow(
      DomainError,
    );
  });

  it('rejects fractional prices, bad rates and duplicate taxes', () => {
    expect(() => priceOrder({ taxInclusive: false, lines: [line('a', 10.5)] })).toThrow(
      DomainError,
    );
    expect(() =>
      priceOrder({
        taxInclusive: false,
        lines: [line('a', 10, 1, [{ taxId: 'x', rateBps: 10_001 }])],
      }),
    ).toThrow(DomainError);
    expect(() =>
      priceOrder({ taxInclusive: false, lines: [line('a', 10, 1, [VAT10, VAT10])] }),
    ).toThrow(DomainError);
    expect(() =>
      priceOrder({
        taxInclusive: false,
        lines: [line('a', 10)],
        discounts: [{ discountId: 'd', type: 'PERCENTAGE', value: 20_000 }],
      }),
    ).toThrow(DomainError);
  });

  it('is deterministic and never produces fractional amounts', () => {
    for (let unit = 1; unit < 2000; unit += 37) {
      for (const inclusive of [true, false]) {
        const p = priceOrder({
          taxInclusive: inclusive,
          lines: [line('a', unit, 3, [VAT15, CITY]), line('b', unit + 7, 2, [VAT10])],
          discounts: [{ discountId: 'd', type: 'PERCENTAGE', value: 1234 }],
        });
        const all = [
          p.subtotal,
          p.discount,
          p.tax,
          p.total,
          ...p.lines.flatMap((l) => [l.gross, l.discount, l.net, l.tax, l.total]),
        ];
        expect(all.every(Number.isSafeInteger)).toBe(true);
        expect(p.lines.reduce((s, l) => s + l.total, 0)).toBe(p.total);
        expect(p.taxBreakdown.reduce((s, t) => s + t.amount, 0)).toBe(p.tax);
      }
    }
  });
});
