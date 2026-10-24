import type { DiscountType } from '@pos/shared-types';
import { DomainError, isDomainError } from '../errors';
import { findMenuProduct } from '../menu/resolve-location-menu';
import type { LocationMenu, PricedSelection } from '../menu/types';
import { validateSelection } from '../menu/validate-selection';
import { priceOrder } from '../pricing/price-order';
import type { OrderPricing, PricedLine, PricingFeeInput } from '../pricing/types';

export interface OrderItemRequest {
  /** Client-generated id of the cart line (stable across edits). */
  lineId: string;
  productId: string;
  variantId: string | null;
  modifierIds: readonly string[];
  quantity: number;
  /** The code scanned for this line (ADR 0021); checked against the item's barcodes. */
  barcode?: string | null;
}

export interface DiscountDefinition {
  id: string;
  type: DiscountType;
  value: number;
}

export interface QuoteInput {
  menu: LocationMenu;
  taxInclusive: boolean;
  items: readonly OrderItemRequest[];
  discounts?: readonly DiscountDefinition[];
  fees?: readonly PricingFeeInput[];
}

export interface QuotedLine extends PricedSelection, PricedLine {
  quantity: number;
}

export interface OrderQuote {
  lines: QuotedLine[];
  pricing: OrderPricing;
}

/**
 * Validates every item against the location's menu and prices the whole order. This is what the
 * server runs to create or modify an order (never trusting client prices) and what the POS runs
 * to preview totals, so both always agree.
 */
export function quoteOrder({
  menu,
  taxInclusive,
  items,
  discounts = [],
  fees = [],
}: QuoteInput): OrderQuote {
  const taxRates = new Map(menu.taxes.map((t) => [t.id, t.rateBps]));
  const selections = items.map((item) => {
    try {
      return validateSelection(findMenuProduct(menu, item.productId), item);
    } catch (error) {
      if (isDomainError(error)) {
        throw new DomainError(error.code, error.message, { ...error.details, lineId: item.lineId });
      }
      throw error;
    }
  });

  const pricing = priceOrder({
    taxInclusive,
    lines: items.map((item, i) => {
      const product = findMenuProduct(menu, item.productId);
      return {
        lineId: item.lineId,
        unitPrice: selections[i]?.unitPrice ?? 0,
        quantity: item.quantity,
        taxes: (product?.taxIds ?? []).flatMap((taxId) => {
          const rateBps = taxRates.get(taxId);
          return rateBps === undefined ? [] : [{ taxId, rateBps }];
        }),
      };
    }),
    discounts: discounts.map((d) => ({ discountId: d.id, type: d.type, value: d.value })),
    fees,
  });

  return {
    lines: items.map((item, i) => {
      const selection = selections[i];
      const priced = pricing.lines[i];
      if (!selection || !priced) throw new DomainError('INTERNAL_ERROR', 'Line mismatch');
      return { ...selection, ...priced, quantity: item.quantity };
    }),
    pricing,
  };
}
