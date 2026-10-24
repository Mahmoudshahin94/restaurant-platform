import { newId } from '@pos/domain';
import type { KioskPaymentOption, Locale } from '@pos/shared-types';
import type { Order } from '@pos/validation';
import { create } from 'zustand';

/** Where the customer is: the welcome screen, the menu, checking out, paying, or done. */
export type Stage = 'welcome' | 'menu' | 'checkout' | 'paying' | 'done';

export interface CartLine {
  /** UUIDv7, the order line's id. */
  id: string;
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
  /** The code scanned for this line (ADR 0021), kept on the order line. */
  barcode: string | null;
}

/**
 * One customer's visit, in memory only: it is wiped by "start over", by the idle reset and when
 * the order is done, so the next customer never sees the last one's order, language or name.
 */
interface SessionState {
  stage: Stage;
  lines: CartLine[];
  /** The customer's language choice for this visit; null: the tenant's default. */
  locale: Locale | null;
  largeText: boolean;
  customerName: string;
  payment: KioskPaymentOption;
  /** The order's id, generated once per visit: a resend never places a second order. */
  orderId: string;
  /** The payment's id: kept across a retry after a lost answer, renewed after a decline. */
  paymentId: string;
  order: Order | null;
  declined: boolean;
  start: () => void;
  setStage: (stage: Stage) => void;
  addLine: (line: Omit<CartLine, 'id' | 'quantity'> & { quantity?: number }) => string;
  setQuantity: (id: string, quantity: number) => void;
  removeLine: (id: string) => void;
  setLocale: (locale: Locale) => void;
  toggleLargeText: () => void;
  setCustomerName: (name: string) => void;
  setPayment: (payment: KioskPaymentOption) => void;
  placed: (order: Order) => void;
  paid: (order: Order) => void;
  decline: (order: Order) => void;
  reset: () => void;
}

const same = (a: Omit<CartLine, 'id' | 'quantity'>, b: CartLine) =>
  a.productId === b.productId &&
  a.variantId === b.variantId &&
  a.barcode === b.barcode &&
  a.modifierIds.length === b.modifierIds.length &&
  [...a.modifierIds].sort().every((id, i) => id === [...b.modifierIds].sort()[i]);

const fresh = () => ({
  stage: 'welcome' as Stage,
  lines: [] as CartLine[],
  locale: null,
  largeText: false,
  customerName: '',
  payment: 'TERMINAL' as KioskPaymentOption,
  orderId: newId(),
  paymentId: newId(),
  order: null,
  declined: false,
});

export const useSession = create<SessionState>()((set) => ({
  ...fresh(),
  start: () => {
    set({ stage: 'menu' });
  },
  setStage: (stage) => {
    set({ stage });
  },
  addLine: ({ quantity = 1, ...line }) => {
    let id = newId();
    set((s) => {
      // The same item again adds to its line, as at the POS.
      const existing = s.lines.find((l) => same(line, l));
      if (existing) {
        id = existing.id;
        return {
          lines: s.lines.map((l) =>
            l.id === existing.id ? { ...l, quantity: Math.min(999, l.quantity + quantity) } : l,
          ),
        };
      }
      return { lines: [...s.lines, { ...line, id, quantity }] };
    });
    return id;
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
  setLocale: (locale) => {
    set({ locale });
  },
  toggleLargeText: () => {
    set((s) => ({ largeText: !s.largeText }));
  },
  setCustomerName: (customerName) => {
    set({ customerName });
  },
  setPayment: (payment) => {
    set({ payment });
  },
  placed: (order) => {
    set({ order });
  },
  paid: (order) => {
    set({ order, declined: false, stage: 'done' });
  },
  decline: (order) => {
    set({ order, declined: true, paymentId: newId() });
  },
  reset: () => {
    set(fresh());
  },
}));
