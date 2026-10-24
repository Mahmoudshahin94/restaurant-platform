import { type DomainError, type OrderQuote, isDomainError, quoteOrder } from '@pos/domain';
import type { PublishedMenu } from '@pos/validation';
import { useMemo } from 'react';
import type { CartLine } from '../stores/session';

export interface CartQuote {
  quote: OrderQuote | null;
  /** First problem found (an item no longer available), with its line id. */
  error: DomainError | null;
}

/**
 * The order's total as the customer builds it, computed with the same domain engine as the POS
 * and the server. The server prices the order again when it is placed; its numbers are stored.
 */
export function useCartQuote(
  menu: PublishedMenu | undefined,
  lines: readonly CartLine[],
): CartQuote {
  return useMemo(() => {
    if (!menu || lines.length === 0) return { quote: null, error: null };
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
          barcode: l.barcode,
        })),
      });
      return { quote, error: null };
    } catch (error) {
      if (isDomainError(error)) return { quote: null, error };
      throw error;
    }
  }, [menu, lines]);
}
