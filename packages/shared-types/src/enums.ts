/**
 * Domain enumerations shared by the cloud API, the location hub and every frontend.
 *
 * Each enum is a `const` object plus a same-named union type so values are usable at runtime
 * (validation, iteration) and as types. The Prisma schema mirrors these values; a contract test
 * in @pos/database keeps them in sync.
 */

type ValueOf<T> = T[keyof T];

/**
 * How the customer ordered. Third-party marketplaces (UBER_EATS, DOORDASH, TALABAT, CAREEM, ...)
 * are added here as new values plus a Postgres enum migration; there is never a separate order
 * table per channel.
 */
export const OrderChannel = {
  DINE_IN: 'DINE_IN',
  TAKEAWAY: 'TAKEAWAY',
  PHONE: 'PHONE',
  WEBSITE: 'WEBSITE',
  DELIVERY: 'DELIVERY',
} as const;
export type OrderChannel = ValueOf<typeof OrderChannel>;

export const OrderStatus = {
  DRAFT: 'DRAFT',
  PLACED: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = ValueOf<typeof OrderStatus>;

/** Order statuses that still need staff attention (not finished or voided). */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

export const DiscountType = {
  /** `value` is basis points of the order subtotal. */
  PERCENTAGE: 'PERCENTAGE',
  /** `value` is an amount in minor units. */
  FIXED: 'FIXED',
} as const;
export type DiscountType = ValueOf<typeof DiscountType>;

/** Tracked separately from OrderStatus so partial payments and partial refunds are representable. */
export const PaymentStatus = {
  UNPAID: 'UNPAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = ValueOf<typeof PaymentStatus>;

/** Which system performed an action (recorded on status history and audit entries). */
export const ActionSource = {
  POS: 'POS',
  KDS: 'KDS',
  WEBSITE: 'WEBSITE',
  ADMIN: 'ADMIN',
  HUB: 'HUB',
  SYSTEM: 'SYSTEM',
} as const;
export type ActionSource = ValueOf<typeof ActionSource>;

export const KitchenTicketStatus = {
  NEW: 'NEW',
  PREPARING: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type KitchenTicketStatus = ValueOf<typeof KitchenTicketStatus>;

export const DeviceType = {
  POS: 'POS',
  KDS: 'KDS',
  PRINTER: 'PRINTER',
  KITCHEN_DISPLAY: 'KITCHEN_DISPLAY',
  CUSTOMER_DISPLAY: 'CUSTOMER_DISPLAY',
  /** The location hub (apps/gateway) registers itself as a device too. */
  GATEWAY: 'GATEWAY',
} as const;
export type DeviceType = ValueOf<typeof DeviceType>;

export const DeviceStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type DeviceStatus = ValueOf<typeof DeviceStatus>;

/** Whether a location currently accepts website orders. Decided by the cloud, never by the browser. */
export const OnlineOrderingState = {
  OPEN: 'OPEN',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  OFFLINE: 'OFFLINE',
} as const;
export type OnlineOrderingState = ValueOf<typeof OnlineOrderingState>;

/** Lifecycle of one row in the hub's sync outbox. */
export const SyncOperationStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  FAILED: 'FAILED',
  COMPLETED: 'COMPLETED',
} as const;
export type SyncOperationStatus = ValueOf<typeof SyncOperationStatus>;

/** Connectivity indicator shown on the POS. */
export const SyncConnectionState = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  SYNCING: 'SYNCING',
  SYNC_ERROR: 'SYNC_ERROR',
} as const;
export type SyncConnectionState = ValueOf<typeof SyncConnectionState>;

export const Locale = {
  EN: 'en',
  AR: 'ar',
} as const;
export type Locale = ValueOf<typeof Locale>;
export const LOCALES: readonly Locale[] = [Locale.EN, Locale.AR];

export type TextDirection = 'ltr' | 'rtl';

/** Values of a const enum object as a non-empty tuple, convenient for z.enum(). */
export function enumValues<T extends Record<string, string>>(e: T): [ValueOf<T>, ...ValueOf<T>[]] {
  return Object.values(e) as [ValueOf<T>, ...ValueOf<T>[]];
}
