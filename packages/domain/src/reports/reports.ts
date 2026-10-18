import { DomainError } from '../errors';
import {
  BPS_DENOMINATOR,
  allocateProportionally,
  assertMinorUnits,
  divideRoundHalfUp,
  sumMinor,
} from '../money';

/*
 * Reporting rules shared by the cloud's reports (Phase 9, ADR 0015). The SQL in the API selects
 * and sums rows; the arithmetic that needs rounding lives here.
 */

/** The money of a sale as the pricing engine stored it on the order. */
export interface SaleAmounts {
  /** What the customer pays (`orders.total`). */
  total: number;
  /** The order's per-tax amounts (`order_taxes.amount`); they sum to `orders.tax_total`. */
  taxes: readonly number[];
  /** `orders.fee_total`. */
  fees: number;
}

/** The parts of a refund: per tax (same order as `SaleAmounts.taxes`), fees and net sales. */
export interface RefundSplit {
  taxes: number[];
  fees: number;
  netSales: number;
}

/**
 * Splits a refund over the order it pays back, in proportion to the order: each tax, the fees,
 * and the rest (net sales). Refunds are money only (they name no lines), so this is how a refund
 * reduces tax and net sales in reports. Largest remainder, so the parts always sum to the refund
 * exactly, and refunding the whole order gives back exactly its tax, fees and net sales.
 */
export function splitRefund(amount: number, sale: SaleAmounts): RefundSplit {
  assertMinorUnits(amount, 'amount');
  assertMinorUnits(sale.total, 'total');
  if (amount < 0) throw new DomainError('INVALID_MONEY_AMOUNT', 'Refund cannot be negative');
  if (amount === 0) return { taxes: sale.taxes.map(() => 0), fees: 0, netSales: 0 };
  const tax = sumMinor(sale.taxes);
  const netSales = sale.total - tax - sale.fees;
  if (sale.total <= 0 || netSales < 0) {
    throw new DomainError('INVALID_MONEY_AMOUNT', 'Sale amounts are inconsistent', {
      total: sale.total,
      tax,
      fees: sale.fees,
    });
  }
  const parts = allocateProportionally(amount, [...sale.taxes, sale.fees, netSales]);
  const k = sale.taxes.length;
  return {
    taxes: parts.slice(0, k),
    fees: parts[k] ?? 0,
    netSales: parts[k + 1] ?? 0,
  };
}

/** Average per item, rounded half away from zero; 0 when there are none. */
export function averageMinor(total: number, count: number): number {
  return count === 0 ? 0 : divideRoundHalfUp(total, count);
}

/** `part` as basis points of `whole` (2500 = 25%), rounded; 0 when the whole is 0. */
export function shareBps(part: number, whole: number): number {
  return whole === 0 ? 0 : divideRoundHalfUp(part * BPS_DENOMINATOR, whole);
}

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Calendar days from `from` to `to` inclusive (business dates, YYYY-MM-DD). */
export function businessDaysInRange(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Every business date from `from` to `to` inclusive, in order. */
export function businessDatesInRange(from: string, to: string): string[] {
  const days = businessDaysInRange(from, to);
  const start = toUtc(from);
  return Array.from({ length: Math.max(days, 0) }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}
