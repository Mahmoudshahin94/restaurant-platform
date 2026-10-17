import type { OrderStatus, PaymentMethodType, PaymentStatus } from '@pos/shared-types';
import { DomainError } from '../errors';
import { assertMinorUnits, divideRoundHalfUp, sumMinor } from '../money/arithmetic';

/** A settled payment movement on an order (failed/cancelled attempts are excluded by callers). */
export interface PaymentEntry {
  id: string;
  type: 'CHARGE' | 'REFUND';
  amount: number;
  /** For REFUND rows: the CHARGE being refunded. */
  refundOfId: string | null;
}

export interface PaymentTotals {
  paid: number;
  refunded: number;
  /** total − (paid − refunded), never negative. */
  balanceDue: number;
}

export function paymentTotals(orderTotal: number, entries: readonly PaymentEntry[]): PaymentTotals {
  const paid = sumMinor(entries.filter((e) => e.type === 'CHARGE').map((e) => e.amount));
  const refunded = sumMinor(entries.filter((e) => e.type === 'REFUND').map((e) => e.amount));
  return { paid, refunded, balanceDue: Math.max(0, orderTotal - (paid - refunded)) };
}

/**
 * Order payment status derived from its payment rows (ADR 0005). Refund states win once money
 * has been returned, so a fully refunded order never looks "unpaid".
 */
export function derivePaymentStatus(
  orderTotal: number,
  entries: readonly PaymentEntry[],
): PaymentStatus {
  const { paid, refunded } = paymentTotals(orderTotal, entries);
  if (refunded > 0) return refunded >= paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  if (paid === 0) return 'UNPAID';
  return paid >= orderTotal ? 'PAID' : 'PARTIALLY_PAID';
}

/**
 * Rounds a cash amount to the location's smallest usable coin (e.g. 5 = nearest 0.05),
 * half up. `null` or 1 means no rounding (the default).
 */
export function roundCash(amount: number, increment: number | null): number {
  assertMinorUnits(amount);
  if (increment === null || increment <= 1) return amount;
  return divideRoundHalfUp(amount, increment) * increment;
}

const PAYABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PLACED',
  'CONFIRMED',
  'PREPARING',
  'READY',
]);

export interface ChargeRequest {
  orderStatus: OrderStatus;
  method: PaymentMethodType;
  balanceDue: number;
  /** Amount to apply to the order. */
  amount: number;
  /** Cash handed over by the customer (cash only); defaults to the amount. */
  tendered?: number | null;
  /** Location cash rounding increment in minor units (null = off). */
  cashRoundingIncrement?: number | null;
}

export interface ChargeResult {
  /** Applied to the order balance. */
  amount: number;
  /** Cash received (cash only), else null. */
  tendered: number | null;
  /** Cash returned to the customer (cash only), else 0. */
  change: number;
  /**
   * Difference between the rounded cash amount and the exact amount when this payment settles
   * the balance; it goes into the drawer and is reported, but never alters the order total.
   */
  roundingAdjustment: number;
}

/**
 * Validates a payment against the order and computes change. Non-cash payments may not exceed
 * the balance due; cash may be over-tendered, and the excess is returned as change.
 */
export function prepareCharge(request: ChargeRequest): ChargeResult {
  const { orderStatus, method, balanceDue, amount } = request;
  assertMinorUnits(amount);
  if (!PAYABLE.has(orderStatus)) {
    throw new DomainError('INVALID_ORDER_STATE', 'Order cannot take payments in this status', {
      status: orderStatus,
      reason: 'NOT_PAYABLE',
    });
  }
  if (balanceDue <= 0) {
    throw new DomainError('PAYMENT_FAILED', 'Order is already paid', { reason: 'ALREADY_PAID' });
  }
  if (amount <= 0 || amount > balanceDue) {
    throw new DomainError('PAYMENT_FAILED', 'Amount must be between 0 and the balance due', {
      reason: 'INVALID_AMOUNT',
      balanceDue,
      amount,
    });
  }
  if (method !== 'CASH') {
    if (request.tendered !== undefined && request.tendered !== null) {
      throw new DomainError('PAYMENT_FAILED', 'Only cash can be tendered', {
        reason: 'TENDERED_NOT_CASH',
      });
    }
    return { amount, tendered: null, change: 0, roundingAdjustment: 0 };
  }

  // Rounding applies only to the payment that settles the balance in cash.
  const settles = amount === balanceDue;
  const cashDue = settles ? roundCash(amount, request.cashRoundingIncrement ?? null) : amount;
  const tendered = request.tendered ?? cashDue;
  assertMinorUnits(tendered, 'tendered');
  if (tendered < cashDue) {
    throw new DomainError('PAYMENT_FAILED', 'Cash tendered is less than the amount', {
      reason: 'INSUFFICIENT_TENDERED',
      cashDue,
      tendered,
    });
  }
  return { amount, tendered, change: tendered - cashDue, roundingAdjustment: cashDue - amount };
}

/** How much of a charge can still be refunded. */
export function refundableAmount(charge: PaymentEntry, entries: readonly PaymentEntry[]): number {
  const refunded = sumMinor(
    entries.filter((e) => e.type === 'REFUND' && e.refundOfId === charge.id).map((e) => e.amount),
  );
  return charge.amount - refunded;
}

/** Refunds return money against one specific charge and never exceed what is left of it. */
export function assertRefund(
  charge: PaymentEntry | undefined,
  entries: readonly PaymentEntry[],
  amount: number,
  reason: string | null,
): void {
  if (!charge || charge.type !== 'CHARGE') {
    throw new DomainError('PAYMENT_NOT_FOUND', 'Charge not found');
  }
  assertMinorUnits(amount);
  if (!reason?.trim()) {
    throw new DomainError('REFUND_NOT_ALLOWED', 'A reason is required', {
      reason: 'REASON_REQUIRED',
    });
  }
  const remaining = refundableAmount(charge, entries);
  if (amount <= 0 || amount > remaining) {
    throw new DomainError('REFUND_NOT_ALLOWED', 'Refund exceeds what is left of the payment', {
      reason: 'EXCEEDS_REFUNDABLE',
      refundable: remaining,
    });
  }
}

/** Drawer movements of one shift. Amounts are positive; the type gives the direction. */
export interface CashMovement {
  type: 'SALE' | 'REFUND' | 'PAY_IN' | 'PAY_OUT';
  amount: number;
}

export interface ShiftCashSummary {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  payIns: number;
  payOuts: number;
  /** What the drawer should contain. */
  expectedCash: number;
}

export function shiftCashSummary(
  openingFloat: number,
  movements: readonly CashMovement[],
): ShiftCashSummary {
  const total = (type: CashMovement['type']) =>
    sumMinor(movements.filter((m) => m.type === type).map((m) => m.amount));
  const cashSales = total('SALE');
  const cashRefunds = total('REFUND');
  const payIns = total('PAY_IN');
  const payOuts = total('PAY_OUT');
  return {
    openingFloat,
    cashSales,
    cashRefunds,
    payIns,
    payOuts,
    expectedCash: openingFloat + cashSales - cashRefunds + payIns - payOuts,
  };
}

/**
 * Card references are approval codes or terminal receipt numbers. Anything that looks like a
 * full card number (13–19 digits) is rejected so primary account numbers are never stored.
 */
export function assertSafeCardReference(reference: string): void {
  const digits = reference.replace(/[\s-]/g, '');
  if (/^\d{13,19}$/.test(digits)) {
    throw new DomainError('VALIDATION_FAILED', 'Card numbers must never be entered', {
      reason: 'LOOKS_LIKE_CARD_NUMBER',
    });
  }
}
