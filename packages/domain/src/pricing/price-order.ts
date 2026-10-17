import { DomainError } from '../errors';
import {
  allocateProportionally,
  applyBps,
  assertMinorUnits,
  inclusiveTaxPortion,
  multiplyMinor,
  sumMinor,
} from '../money/arithmetic';
import type {
  OrderPricing,
  PricedDiscount,
  PricedFee,
  PricedLine,
  PricingInput,
  TaxAmount,
  TaxBreakdown,
  TaxRate,
} from './types';

export const MAX_LINE_QUANTITY = 999;

function assertRates(taxes: readonly TaxRate[], context: Record<string, unknown>): void {
  const seen = new Set<string>();
  for (const t of taxes) {
    if (!Number.isInteger(t.rateBps) || t.rateBps < 0 || t.rateBps > 10_000) {
      throw new DomainError('INVALID_MONEY_AMOUNT', 'Tax rate must be 0..10000 bps', {
        ...context,
        taxId: t.taxId,
      });
    }
    if (seen.has(t.taxId)) {
      throw new DomainError('INVALID_MONEY_AMOUNT', 'Tax applied twice', {
        ...context,
        taxId: t.taxId,
      });
    }
    seen.add(t.taxId);
  }
}

/**
 * Tax on an amount. Exclusive: each rate applied to the amount, rounded per tax.
 * Inclusive: the combined portion `amount × R / (10000 + R)` is extracted once, then split
 * across taxes by rate, so the parts always sum to the extracted portion.
 */
function taxFor(amount: number, taxes: readonly TaxRate[], inclusive: boolean): TaxAmount[] {
  if (taxes.length === 0 || amount === 0) return taxes.map((t) => ({ taxId: t.taxId, amount: 0 }));
  if (!inclusive)
    return taxes.map((t) => ({ taxId: t.taxId, amount: applyBps(amount, t.rateBps) }));
  const combinedRate = sumMinor(taxes.map((t) => t.rateBps));
  const portion = inclusiveTaxPortion(amount, combinedRate);
  const parts = allocateProportionally(
    portion,
    taxes.map((t) => t.rateBps),
  );
  return taxes.map((t, i) => ({ taxId: t.taxId, amount: parts[i] ?? 0 }));
}

/**
 * The single pricing engine used by the POS (preview), the website (preview) and the
 * backend/hub (authoritative). Pure and deterministic; integer arithmetic only.
 *
 * Order of operations (see ADR 0002):
 *  1. line gross = unit price × quantity; subtotal = Σ gross
 *  2. order-level discounts are computed on the subtotal, applied in order, and capped so the
 *     discount never exceeds the subtotal
 *  3. the discount is allocated to lines proportionally to gross (largest remainder)
 *  4. tax is computed per line on the discounted (net) amount, rounded half-up
 *  5. fees are added (never discounted) and taxed with their own rates
 *  6. total = subtotal − discount + fees (+ tax when prices are tax-exclusive)
 */
export function priceOrder(input: PricingInput): OrderPricing {
  const { taxInclusive } = input;
  const discounts = input.discounts ?? [];
  const fees = input.fees ?? [];

  const gross = input.lines.map((line) => {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_LINE_QUANTITY
    ) {
      throw new DomainError('VALIDATION_FAILED', 'Quantity must be 1..999', {
        lineId: line.lineId,
        quantity: line.quantity,
      });
    }
    assertMinorUnits(line.unitPrice, 'unitPrice');
    if (line.unitPrice < 0) {
      throw new DomainError('INVALID_MONEY_AMOUNT', 'Unit price cannot be negative', {
        lineId: line.lineId,
      });
    }
    assertRates(line.taxes, { lineId: line.lineId });
    return multiplyMinor(line.unitPrice, line.quantity);
  });
  const subtotal = sumMinor(gross);

  // 2. Discounts on the subtotal, capped.
  let remaining = subtotal;
  const appliedDiscounts: PricedDiscount[] = discounts.map((d) => {
    assertMinorUnits(d.value, 'discount');
    if (d.value < 0 || (d.type === 'PERCENTAGE' && d.value > 10_000)) {
      throw new DomainError('INVALID_MONEY_AMOUNT', 'Invalid discount value', {
        discountId: d.discountId,
      });
    }
    const raw = d.type === 'PERCENTAGE' ? applyBps(subtotal, d.value) : d.value;
    const amount = Math.min(raw, remaining);
    remaining -= amount;
    return { discountId: d.discountId, amount };
  });
  const discount = sumMinor(appliedDiscounts.map((d) => d.amount));

  // 3–4. Allocate and tax per line.
  const lineDiscounts = allocateProportionally(discount, gross);
  const lines: PricedLine[] = input.lines.map((line, i) => {
    const lineGross = gross[i] ?? 0;
    const lineDiscount = lineDiscounts[i] ?? 0;
    const net = lineGross - lineDiscount;
    const taxes = taxFor(net, line.taxes, taxInclusive);
    const tax = sumMinor(taxes.map((t) => t.amount));
    return {
      lineId: line.lineId,
      gross: lineGross,
      discount: lineDiscount,
      net,
      tax,
      taxes,
      total: taxInclusive ? net : net + tax,
    };
  });

  // 5. Fees.
  const appliedFees: PricedFee[] = fees.map((fee) => {
    assertMinorUnits(fee.amount, 'fee');
    if (fee.amount < 0)
      throw new DomainError('INVALID_MONEY_AMOUNT', 'Fee cannot be negative', { feeId: fee.feeId });
    assertRates(fee.taxes, { feeId: fee.feeId });
    const taxes = taxFor(fee.amount, fee.taxes, taxInclusive);
    return {
      feeId: fee.feeId,
      amount: fee.amount,
      tax: sumMinor(taxes.map((t) => t.amount)),
      taxes,
    };
  });
  const feeTotal = sumMinor(appliedFees.map((f) => f.amount));

  const tax = sumMinor([...lines.map((l) => l.tax), ...appliedFees.map((f) => f.tax)]);

  // Per-tax breakdown for receipts and tax reports.
  const breakdown = new Map<string, TaxBreakdown>();
  const addTaxable = (base: number, taxes: readonly TaxRate[], amounts: readonly TaxAmount[]) => {
    taxes.forEach((t, i) => {
      const amount = amounts[i]?.amount ?? 0;
      const entry = breakdown.get(t.taxId) ?? {
        taxId: t.taxId,
        rateBps: t.rateBps,
        taxableAmount: 0,
        amount: 0,
      };
      // Inclusive bases contain the whole combined tax; exclusive bases contain none.
      const combined = sumMinor(amounts.map((a) => a.amount));
      entry.taxableAmount += taxInclusive ? base - combined : base;
      entry.amount += amount;
      breakdown.set(t.taxId, entry);
    });
  };
  input.lines.forEach((line, i) => {
    const priced = lines[i];
    if (priced) addTaxable(priced.net, line.taxes, priced.taxes);
  });
  fees.forEach((fee, i) => {
    const priced = appliedFees[i];
    if (priced) addTaxable(fee.amount, fee.taxes, priced.taxes);
  });

  const total = subtotal - discount + feeTotal + (taxInclusive ? 0 : tax);
  assertMinorUnits(total, 'total');

  return {
    subtotal,
    discount,
    tax,
    fees: feeTotal,
    total,
    lines,
    appliedDiscounts,
    appliedFees,
    taxBreakdown: [...breakdown.values()],
  };
}
