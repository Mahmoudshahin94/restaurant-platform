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

/** Kinds of tender. Tenants configure named methods (e.g. "Mada", "Visa") of these types. */
export const PaymentMethodType = {
  CASH: 'CASH',
  /** Card approved on an external terminal; the POS records the approval reference. */
  CARD: 'CARD',
  /** Online payment through a payment gateway (customer website, Phase 7). */
  ONLINE: 'ONLINE',
} as const;
export type PaymentMethodType = ValueOf<typeof PaymentMethodType>;

/** A payment row is either money in (CHARGE) or money back (REFUND); rows are never edited away. */
export const PaymentTransactionType = {
  CHARGE: 'CHARGE',
  REFUND: 'REFUND',
} as const;
export type PaymentTransactionType = ValueOf<typeof PaymentTransactionType>;

export const PaymentRecordStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentRecordStatus = ValueOf<typeof PaymentRecordStatus>;

export const ShiftStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type ShiftStatus = ValueOf<typeof ShiftStatus>;

/** Movements of cash in a drawer during a shift. */
export const CashTransactionType = {
  SALE: 'SALE',
  REFUND: 'REFUND',
  PAY_IN: 'PAY_IN',
  PAY_OUT: 'PAY_OUT',
} as const;
export type CashTransactionType = ValueOf<typeof CashTransactionType>;

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

/** Who performed an action (recorded on status history and audit entries). */
export const ActorType = {
  USER: 'USER',
  EMPLOYEE: 'EMPLOYEE',
  DEVICE: 'DEVICE',
  CUSTOMER: 'CUSTOMER',
  SYSTEM: 'SYSTEM',
} as const;
export type ActorType = ValueOf<typeof ActorType>;

export const KitchenTicketStatus = {
  NEW: 'NEW',
  PREPARING: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type KitchenTicketStatus = ValueOf<typeof KitchenTicketStatus>;

/** Tickets on the kitchen screen that still need attention (not bumped or cancelled). */
export const ACTIVE_TICKET_STATUSES = [
  'NEW',
  'PREPARING',
  'READY',
] as const satisfies readonly KitchenTicketStatus[];

export const TicketPriority = {
  NORMAL: 'NORMAL',
  /** Shown first on every station, with a "Rush" label. */
  RUSH: 'RUSH',
} as const;
export type TicketPriority = ValueOf<typeof TicketPriority>;

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
/** How a website order reaches the customer. */
export const FulfillmentType = {
  PICKUP: 'PICKUP',
  DELIVERY: 'DELIVERY',
} as const;
export type FulfillmentType = ValueOf<typeof FulfillmentType>;

/**
 * How a website customer pays. PAY_AT_PICKUP and CASH_ON_DELIVERY record nothing until the
 * tenant takes the money; ONLINE_CARD goes through the online payment provider at checkout.
 */
export const WebPaymentOption = {
  PAY_AT_PICKUP: 'PAY_AT_PICKUP',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
  ONLINE_CARD: 'ONLINE_CARD',
} as const;
export type WebPaymentOption = ValueOf<typeof WebPaymentOption>;

/** Why a tenant rejected a website order (stored as the cancel reason, shown to customers). */
export const WebRejectReason = {
  TOO_BUSY: 'TOO_BUSY',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  CLOSING_SOON: 'CLOSING_SOON',
  DELIVERY_AREA: 'DELIVERY_AREA',
  OTHER: 'OTHER',
} as const;
export type WebRejectReason = ValueOf<typeof WebRejectReason>;

/** Cancel reason of a website order the tenant did not accept in time. */
export const WEB_ACCEPTANCE_TIMEOUT_REASON = 'ACCEPTANCE_TIMEOUT';

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

/** What an outbox operation carries: the full state of one aggregate (ADR 0012). */
export const SyncOperationType = {
  ORDER_UPSERT: 'ORDER_UPSERT',
  SHIFT_UPSERT: 'SHIFT_UPSERT',
  KITCHEN_TICKET_UPSERT: 'KITCHEN_TICKET_UPSERT',
  /** An audit-trail entry recorded at the location; append-only (ADR 0016). */
  AUDIT_LOG_APPEND: 'AUDIT_LOG_APPEND',
} as const;
export type SyncOperationType = ValueOf<typeof SyncOperationType>;

export const SyncEntityType = {
  Order: 'Order',
  Shift: 'Shift',
  KitchenTicket: 'KitchenTicket',
  AuditLog: 'AuditLog',
} as const;
export type SyncEntityType = ValueOf<typeof SyncEntityType>;

/**
 * The cloud's answer for one pushed operation. APPLIED and DUPLICATE are success; CONFLICT and
 * REJECTED are permanent for that operation; RETRY is transient (try again later).
 */
export const SyncResultStatus = {
  APPLIED: 'APPLIED',
  DUPLICATE: 'DUPLICATE',
  CONFLICT: 'CONFLICT',
  REJECTED: 'REJECTED',
  RETRY: 'RETRY',
} as const;
export type SyncResultStatus = ValueOf<typeof SyncResultStatus>;

/** Kinds of entries in the cloud's change feed (`GET /sync/pull`). */
export const ChangeTopic = {
  /** Configuration, catalog, floor or staff changed: refresh the location snapshot. */
  CONFIG: 'CONFIG',
  /** A website order was created or changed in the cloud: fetch it (entityId = order id). */
  ORDER: 'ORDER',
  /**
   * An administrator resolved an operation the cloud had refused from this hub (entityId =
   * operation id): fetch the decision from `/sync/resolutions/:operationId` (ADR 0014).
   */
  RESOLUTION: 'RESOLUTION',
} as const;
export type ChangeTopic = ValueOf<typeof ChangeTopic>;

/** How an administrator settled an operation the cloud refused from a hub (ADR 0014). */
export const SyncIssueResolution = {
  /** The hub's version was applied; the cloud's previous copy is kept in the audit log. */
  APPLIED_HUB: 'APPLIED_HUB',
  /** The cloud's version was kept; the hub replaces its copy and its change is superseded. */
  KEPT_CLOUD: 'KEPT_CLOUD',
} as const;
export type SyncIssueResolution = ValueOf<typeof SyncIssueResolution>;

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
