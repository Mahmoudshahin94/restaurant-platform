import { safeLocalStorage } from '@pos/app-kit';
import { newId } from '@pos/domain';
import type { FulfillmentType } from '@pos/shared-types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartLine {
  /** UUIDv7; becomes the order line id. */
  id: string;
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
  notes: string | null;
}

export type NewLine = Omit<CartLine, 'id'>;

interface CartData {
  /** The branch this cart orders from; another branch starts a new cart. */
  locationId: string | null;
  /**
   * The order id, generated on the browser: a resend after a lost response returns the same
   * order instead of a second one. It changes whenever the cart's content changes.
   */
  orderId: string;
  lines: CartLine[];
  fulfillment: FulfillmentType;
}

interface CartActions {
  ensureLocation: (locationId: string) => void;
  addLine: (line: NewLine) => void;
  updateLine: (id: string, patch: Partial<NewLine>) => void;
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  setFulfillment: (fulfillment: FulfillmentType) => void;
  clear: () => void;
}

const MAX_QUANTITY = 99;

const sameChoice = (a: NewLine, b: NewLine) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  a.notes === b.notes &&
  a.modifierIds.length === b.modifierIds.length &&
  [...a.modifierIds].sort().every((m, i) => m === [...b.modifierIds].sort()[i]);

function emptyCart(locationId: string | null): CartData {
  return { locationId, orderId: newId(), lines: [], fulfillment: 'PICKUP' };
}

/** The visitor's cart, kept in this browser so a reload does not lose it. */
export const useCart = create<CartData & CartActions>()(
  persist(
    (set) => ({
      ...emptyCart(null),
      ensureLocation: (locationId) => {
        set((s) => (s.locationId === locationId ? s : emptyCart(locationId)));
      },
      addLine: (line) => {
        set((s) => {
          const same = s.lines.find((l) => sameChoice(l, line));
          const lines = same
            ? s.lines.map((l) =>
                l === same
                  ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + line.quantity) }
                  : l,
              )
            : [...s.lines, { ...line, id: newId() }];
          return { lines, orderId: newId() };
        });
      },
      updateLine: (id, patch) => {
        set((s) => ({
          lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
          orderId: newId(),
        }));
      },
      setQuantity: (id, quantity) => {
        set((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((l) => l.id !== id)
              : s.lines.map((l) =>
                  l.id === id ? { ...l, quantity: Math.min(MAX_QUANTITY, quantity) } : l,
                ),
          orderId: newId(),
        }));
      },
      removeLine: (id) => {
        set((s) => ({ lines: s.lines.filter((l) => l.id !== id), orderId: newId() }));
      },
      setFulfillment: (fulfillment) => {
        set({ fulfillment, orderId: newId() });
      },
      clear: () => {
        set((s) => emptyCart(s.locationId));
      },
    }),
    { name: 'web-cart', storage: createJSONStorage(() => safeLocalStorage), version: 1 },
  ),
);

export const cartCount = (lines: readonly CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);
