import { multiplyMinor, sumMinor } from '../money/arithmetic';

export interface StoredOrderTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  feeTotal: number;
  total: number;
}

export interface StoredOrderLines {
  taxInclusive: boolean;
  /** Each line's snapshot: unit price (modifiers included) and quantity. */
  lines: readonly { unitPrice: number; quantity: number }[];
  /** The order's discount rows (`order_discounts.amount`). */
  discounts: readonly number[];
  /** The order's tax rows (`order_taxes.amount`), lines and fees together. */
  taxes: readonly number[];
  feeTotal: number;
}

/**
 * An order's header totals recomputed from what it stores about its lines (ADR 0025, the
 * support tools): the line snapshots, discount and tax rows and fees, with the pricing engine's
 * formula (ADR 0002: total = subtotal − discount + fees, plus tax when prices exclude it). The
 * menu is not read again: a recalculation corrects a header that disagrees with its own lines,
 * it never reprices.
 */
export function totalsFromStoredLines(order: StoredOrderLines): StoredOrderTotals {
  const subtotal = sumMinor(order.lines.map((l) => multiplyMinor(l.unitPrice, l.quantity)));
  const discountTotal = Math.min(sumMinor(order.discounts), subtotal);
  const taxTotal = sumMinor(order.taxes);
  const total = subtotal - discountTotal + order.feeTotal + (order.taxInclusive ? 0 : taxTotal);
  return { subtotal, discountTotal, taxTotal, feeTotal: order.feeTotal, total };
}
