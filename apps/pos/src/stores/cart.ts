import { safeLocalStorage } from '@pos/app-kit';
import { newId } from '@pos/domain';
import type { Order } from '@pos/validation';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type StaffChannel = 'DINE_IN' | 'TAKEAWAY' | 'PHONE' | 'DELIVERY';
export const STAFF_CHANNELS: readonly StaffChannel[] = ['DINE_IN', 'TAKEAWAY', 'PHONE', 'DELIVERY'];

export interface CartLine {
  /** UUIDv7, becomes the order item id; stable while editing. */
  id: string;
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
  notes: string | null;
  /** The code scanned for this line (ADR 0021); kept on the order line. */
  barcode?: string | null;
}

export interface EditingOrder {
  orderId: string;
  version: number;
  orderNumber: string;
}

interface CartData {
  /**
   * Id of the order being built. Generated once per cart and reused on every retry, so a
   * repeated submit can never create a second order (the server treats it as idempotent).
   */
  draftId: string;
  locationId: string | null;
  editing: EditingOrder | null;
  channel: StaffChannel;
  tableId: string | null;
  customerName: string;
  customerPhone: string;
  guestCount: number | null;
  notes: string;
  discountIds: string[];
  lines: CartLine[];
}

interface CartActions {
  ensureLocation: (locationId: string) => void;
  addLine: (line: Omit<CartLine, 'id' | 'quantity' | 'notes'> & { quantity?: number }) => string;
  updateLine: (id: string, patch: Partial<Omit<CartLine, 'id'>>) => void;
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  setChannel: (channel: StaffChannel) => void;
  setTable: (tableId: string | null) => void;
  setDetails: (
    patch: Partial<Pick<CartData, 'customerName' | 'customerPhone' | 'guestCount' | 'notes'>>,
  ) => void;
  toggleDiscount: (discountId: string) => void;
  loadOrder: (order: Order) => void;
  clear: () => void;
}

function emptyCart(locationId: string | null): CartData {
  return {
    draftId: newId(),
    locationId,
    editing: null,
    channel: 'TAKEAWAY',
    tableId: null,
    customerName: '',
    customerPhone: '',
    guestCount: null,
    notes: '',
    discountIds: [],
    lines: [],
  };
}

const sameConfig = (a: Pick<CartLine, 'productId' | 'variantId' | 'modifierIds'>, b: typeof a) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  a.modifierIds.length === b.modifierIds.length &&
  [...a.modifierIds].sort().every((m, i) => m === [...b.modifierIds].sort()[i]);

/**
 * The order being entered on this terminal. Persisted locally so a reload or crash does not lose
 * an order in progress; it is only a draft until the server (later the location hub) accepts it.
 */
export const useCart = create<CartData & CartActions>()(
  persist(
    (set) => ({
      ...emptyCart(null),
      ensureLocation: (locationId) => {
        set((s) => (s.locationId === locationId ? s : emptyCart(locationId)));
      },
      addLine: ({ quantity = 1, ...line }) => {
        // Scanning the same item again adds one to its line, like tapping it.
        let lineId = newId();
        set((s) => {
          const same = s.lines.find((l) => l.notes === null && sameConfig(l, line));
          if (same) {
            lineId = same.id;
            return {
              lines: s.lines.map((l) =>
                l === same ? { ...l, quantity: Math.min(999, l.quantity + quantity) } : l,
              ),
            };
          }
          return { lines: [...s.lines, { ...line, id: lineId, quantity, notes: null }] };
        });
        return lineId;
      },
      updateLine: (id, patch) => {
        set((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
      },
      setQuantity: (id, quantity) => {
        set((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((l) => l.id !== id)
              : s.lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(999, quantity) } : l)),
        }));
      },
      removeLine: (id) => {
        set((s) => ({ lines: s.lines.filter((l) => l.id !== id) }));
      },
      setChannel: (channel) => {
        set((s) => ({ channel, tableId: channel === 'DINE_IN' ? s.tableId : null }));
      },
      setTable: (tableId) => {
        set(tableId ? { tableId, channel: 'DINE_IN' } : { tableId: null });
      },
      setDetails: (patch) => {
        set(patch);
      },
      toggleDiscount: (discountId) => {
        set((s) => ({
          discountIds: s.discountIds.includes(discountId)
            ? s.discountIds.filter((d) => d !== discountId)
            : [...s.discountIds, discountId],
        }));
      },
      loadOrder: (order) => {
        set({
          ...emptyCart(order.locationId),
          editing: { orderId: order.id, version: order.version, orderNumber: order.orderNumber },
          // Website and kiosk orders are edited as takeaway: staff create neither (ADR 0022).
          channel:
            order.channel === 'WEBSITE' || order.channel === 'KIOSK' ? 'TAKEAWAY' : order.channel,
          tableId: order.tableId,
          customerName: order.customerName ?? '',
          customerPhone: order.customerPhone ?? '',
          guestCount: order.guestCount,
          notes: order.notes ?? '',
          discountIds: order.discounts.map((d) => d.discountId),
          lines: order.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            variantId: item.variantId,
            modifierIds: item.modifiers.map((m) => m.modifierId),
            quantity: item.quantity,
            notes: item.notes,
          })),
        });
      },
      clear: () => {
        set((s) => emptyCart(s.locationId));
      },
    }),
    { name: 'pos-cart', storage: createJSONStorage(() => safeLocalStorage), version: 1 },
  ),
);

/** The cart as an API request body (create or update). Totals are never sent. */
export function cartToRequest(cart: CartData) {
  return {
    channel: cart.channel,
    tableId: cart.channel === 'DINE_IN' ? cart.tableId : null,
    customerName: cart.customerName.trim() || null,
    customerPhone: cart.customerPhone.trim() || null,
    guestCount: cart.channel === 'DINE_IN' ? cart.guestCount : null,
    notes: cart.notes.trim() || null,
    discountIds: cart.discountIds,
    items: cart.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      variantId: l.variantId,
      modifierIds: l.modifierIds,
      quantity: l.quantity,
      notes: l.notes,
      barcode: l.barcode ?? null,
    })),
  };
}
