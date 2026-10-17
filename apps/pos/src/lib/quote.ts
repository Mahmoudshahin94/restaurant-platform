import {
  type DiscountDefinition,
  type DomainError,
  type OrderQuote,
  isDomainError,
  quoteOrder,
} from '@pos/domain';
import type { Discount, PublishedMenu } from '@pos/validation';
import { useMemo } from 'react';
import type { CartLine } from '../stores/cart';

export interface CartQuote {
  quote: OrderQuote | null;
  /** First problem found (e.g. an item that is no longer available), with its line id. */
  error: DomainError | null;
}

/**
 * Preview of the order total, computed with the same domain engine the server uses. The server
 * re-prices on submit and its numbers are the ones stored.
 */
export function useCartQuote(
  menu: PublishedMenu | undefined,
  lines: readonly CartLine[],
  discountIds: readonly string[],
  discounts: readonly Discount[] | undefined,
): CartQuote {
  return useMemo(() => {
    if (!menu || lines.length === 0) return { quote: null, error: null };
    const definitions: DiscountDefinition[] = discountIds.flatMap((id) => {
      const d = discounts?.find((x) => x.id === id);
      return d ? [{ id: d.id, type: d.type, value: d.value }] : [];
    });
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
        discounts: definitions,
      });
      return { quote, error: null };
    } catch (error) {
      if (isDomainError(error)) return { quote: null, error };
      throw error;
    }
  }, [menu, lines, discountIds, discounts]);
}
