import {
  type DomainError,
  type OrderQuote,
  isDomainError,
  quoteOrder,
  webOrderFees,
} from '@pos/domain';
import type { FulfillmentType } from '@pos/shared-types';
import type { PublishedMenu } from '@pos/validation';
import { useMemo } from 'react';
import type { CartLine } from '../stores/cart';

export interface CartQuote {
  quote: OrderQuote | null;
  /** The first problem found (e.g. an item no longer available), with its line id. */
  error: DomainError | null;
}

/**
 * A preview of the order's taxes, fees and total with the same domain engine the cloud uses. Only
 * a preview: the cloud prices the order again when it is placed, and its numbers are the ones kept.
 */
export function quoteCart(
  menu: PublishedMenu,
  lines: readonly CartLine[],
  fulfillment: FulfillmentType,
  deliveryFee: number,
): CartQuote {
  if (lines.length === 0) return { quote: null, error: null };
  try {
    const quote = quoteOrder({
      menu: { categories: menu.categories, taxes: menu.taxes },
      taxInclusive: menu.taxInclusive,
      items: lines.map((l) => ({
        lineId: l.id,
        productId: l.productId,
        variantId: l.variantId,
        modifierIds: l.modifierIds,
        quantity: l.quantity,
      })),
      fees: webOrderFees(fulfillment, deliveryFee),
    });
    return { quote, error: null };
  } catch (error) {
    if (isDomainError(error)) return { quote: null, error };
    throw error;
  }
}

export function useCartQuote(
  menu: PublishedMenu | undefined,
  lines: readonly CartLine[],
  fulfillment: FulfillmentType,
  deliveryFee: number,
): CartQuote {
  return useMemo(
    () => (menu ? quoteCart(menu, lines, fulfillment, deliveryFee) : { quote: null, error: null }),
    [menu, lines, fulfillment, deliveryFee],
  );
}
