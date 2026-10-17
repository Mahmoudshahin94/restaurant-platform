import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  type PaymentEntry,
  assertRefund,
  assertSafeCardReference,
  derivePaymentStatus,
  paymentTotals,
  prepareCharge,
  refundableAmount,
  roundCash,
  shiftCashSummary,
} from './payments';

const charge = (id: string, amount: number): PaymentEntry => ({
  id,
  type: 'CHARGE',
  amount,
  refundOfId: null,
});
const refund = (id: string, of: string, amount: number): PaymentEntry => ({
  id,
  type: 'REFUND',
  amount,
  refundOfId: of,
});

function expectCode(fn: () => unknown, code: string, details?: Record<string, unknown>) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    if (details) expect((e as DomainError).details).toMatchObject(details);
    return;
  }
  throw new Error('expected error');
}

describe('payment status', () => {
  it.each([
    [[], 'UNPAID'],
    [[charge('a', 400)], 'PARTIALLY_PAID'],
    [[charge('a', 400), charge('b', 600)], 'PAID'],
    [[charge('a', 1000), refund('r', 'a', 300)], 'PARTIALLY_REFUNDED'],
    [[charge('a', 1000), refund('r', 'a', 1000)], 'REFUNDED'],
  ] as const)('%j → %s', (entries, status) => {
    expect(derivePaymentStatus(1000, entries)).toBe(status);
  });

  it('computes the balance due with refunds', () => {
    expect(paymentTotals(1000, [charge('a', 600)])).toEqual({
      paid: 600,
      refunded: 0,
      balanceDue: 400,
    });
    expect(paymentTotals(1000, [charge('a', 1000), refund('r', 'a', 200)]).balanceDue).toBe(200);
  });
});

describe('prepareCharge', () => {
  const base = { orderStatus: 'CONFIRMED' as const, balanceDue: 1850 };

  it('returns cash change', () => {
    expect(prepareCharge({ ...base, method: 'CASH', amount: 1850, tendered: 2000 })).toEqual({
      amount: 1850,
      tendered: 2000,
      change: 150,
      roundingAdjustment: 0,
    });
  });

  it('supports split payments without change', () => {
    expect(prepareCharge({ ...base, method: 'CARD', amount: 850 })).toMatchObject({
      amount: 850,
      change: 0,
      tendered: null,
    });
  });

  it('rounds the settling cash payment to the location increment', () => {
    const result = prepareCharge({
      ...base,
      balanceDue: 1853,
      method: 'CASH',
      amount: 1853,
      tendered: 2000,
      cashRoundingIncrement: 5,
    });
    expect(result).toEqual({ amount: 1853, tendered: 2000, change: 145, roundingAdjustment: 2 });
  });

  it('rejects overpayment, short cash, unpayable orders and tendering by card', () => {
    expectCode(() => prepareCharge({ ...base, method: 'CARD', amount: 1851 }), 'PAYMENT_FAILED', {
      reason: 'INVALID_AMOUNT',
    });
    expectCode(
      () => prepareCharge({ ...base, method: 'CASH', amount: 1850, tendered: 1000 }),
      'PAYMENT_FAILED',
      {
        reason: 'INSUFFICIENT_TENDERED',
      },
    );
    expectCode(
      () => prepareCharge({ ...base, orderStatus: 'CANCELLED', method: 'CASH', amount: 100 }),
      'INVALID_ORDER_STATE',
    );
    expectCode(
      () => prepareCharge({ ...base, balanceDue: 0, method: 'CASH', amount: 100 }),
      'PAYMENT_FAILED',
      {
        reason: 'ALREADY_PAID',
      },
    );
    expectCode(
      () => prepareCharge({ ...base, method: 'CARD', amount: 100, tendered: 200 }),
      'PAYMENT_FAILED',
      {
        reason: 'TENDERED_NOT_CASH',
      },
    );
  });
});

describe('cash rounding', () => {
  it.each([
    [1853, 5, 1855],
    [1852, 5, 1850],
    [1862, 25, 1850],
    [1863, 25, 1875],
    [1853, null, 1853],
    [1853, 1, 1853],
  ])('%i rounded to %s → %i', (amount, increment, expected) => {
    expect(roundCash(amount, increment)).toBe(expected);
  });
});

describe('refunds', () => {
  const entries = [charge('a', 1000), refund('r1', 'a', 300)];

  it('limits refunds to what is left of the charge', () => {
    expect(refundableAmount(entries[0]!, entries)).toBe(700);
    expect(() => {
      assertRefund(entries[0], entries, 700, 'Cold food');
    }).not.toThrow();
    expectCode(
      () => {
        assertRefund(entries[0], entries, 701, 'x');
      },
      'REFUND_NOT_ALLOWED',
      { reason: 'EXCEEDS_REFUNDABLE', refundable: 700 },
    );
  });

  it('requires a reason and a real charge', () => {
    expectCode(
      () => {
        assertRefund(entries[0], entries, 100, ' ');
      },
      'REFUND_NOT_ALLOWED',
      { reason: 'REASON_REQUIRED' },
    );
    expectCode(() => {
      assertRefund(entries[1], entries, 100, 'x');
    }, 'PAYMENT_NOT_FOUND');
  });
});

describe('shift cash', () => {
  it('computes the expected drawer amount', () => {
    expect(
      shiftCashSummary(10_000, [
        { type: 'SALE', amount: 5_000 },
        { type: 'SALE', amount: 2_500 },
        { type: 'REFUND', amount: 1_000 },
        { type: 'PAY_IN', amount: 2_000 },
        { type: 'PAY_OUT', amount: 3_000 },
      ]),
    ).toEqual({
      openingFloat: 10_000,
      cashSales: 7_500,
      cashRefunds: 1_000,
      payIns: 2_000,
      payOuts: 3_000,
      expectedCash: 15_500,
    });
  });
});

describe('card references', () => {
  it('rejects anything that looks like a card number', () => {
    expectCode(() => {
      assertSafeCardReference('4111 1111 1111 1111');
    }, 'VALIDATION_FAILED');
    expect(() => {
      assertSafeCardReference('AUTH-839201');
    }).not.toThrow();
    expect(() => {
      assertSafeCardReference('839201');
    }).not.toThrow();
  });
});
