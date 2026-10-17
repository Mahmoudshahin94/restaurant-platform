import type { Prisma } from '@pos/database';
import {
  DomainError,
  type LocationMenu,
  type OrderQuote,
  type QuotedLine,
  findMenuProduct,
} from '@pos/domain';
import type { Discount as DiscountRow } from '@pos/database';

export interface LineInput {
  id: string;
  notes: string | null;
}

/**
 * Builds the persisted snapshot of a priced line: names and prices as they were at the moment
 * of ordering, so later menu edits never alter the order.
 */
export function itemSnapshot(
  menu: LocationMenu,
  line: QuotedLine,
  input: LineInput,
  sortOrder: number,
) {
  const product = findMenuProduct(menu, line.productId);
  if (!product)
    throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found', { productId: line.productId });
  const variant = product.variants.find((v) => v.id === line.variantId);
  const modifierNames = new Map(
    product.modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)),
  );
  return {
    item: {
      id: input.id,
      productId: line.productId,
      variantId: line.variantId,
      nameEn: product.nameEn,
      nameAr: product.nameAr,
      variantNameEn: variant?.nameEn ?? null,
      variantNameAr: variant?.nameAr ?? null,
      quantity: line.quantity,
      basePrice: line.basePrice,
      unitPrice: line.unitPrice,
      gross: line.gross,
      discount: line.discount,
      tax: line.tax,
      total: line.total,
      notes: input.notes,
      stationIds: line.stationIds,
      sortOrder,
    },
    modifiers: line.modifiers.map((m) => {
      const named = modifierNames.get(m.modifierId);
      return {
        modifierId: m.modifierId,
        modifierGroupId: m.modifierGroupId,
        nameEn: named?.nameEn ?? '',
        nameAr: named?.nameAr ?? '',
        priceDelta: m.priceDelta,
      };
    }),
  };
}

export function totalsOf(quote: OrderQuote) {
  const p = quote.pricing;
  return {
    subtotal: p.subtotal,
    discountTotal: p.discount,
    taxTotal: p.tax,
    feeTotal: p.fees,
    total: p.total,
  };
}

export function taxRows(
  orderId: string,
  menu: LocationMenu,
  quote: OrderQuote,
): Prisma.OrderTaxCreateManyInput[] {
  const names = new Map(menu.taxes.map((t) => [t.id, t]));
  return quote.pricing.taxBreakdown.map((t) => ({
    orderId,
    taxId: t.taxId,
    nameEn: names.get(t.taxId)?.nameEn ?? '',
    nameAr: names.get(t.taxId)?.nameAr ?? '',
    rateBps: t.rateBps,
    taxableAmount: t.taxableAmount,
    amount: t.amount,
  }));
}

export function discountRows(
  orderId: string,
  discounts: readonly DiscountRow[],
  quote: OrderQuote,
  appliedById: string,
): Prisma.OrderDiscountCreateManyInput[] {
  return discounts.map((d) => ({
    orderId,
    discountId: d.id,
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    type: d.type,
    value: d.value,
    amount: quote.pricing.appliedDiscounts.find((a) => a.discountId === d.id)?.amount ?? 0,
    appliedById,
  }));
}
