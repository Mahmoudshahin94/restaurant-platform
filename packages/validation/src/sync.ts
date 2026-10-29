import {
  ActionSource,
  ActorType,
  CashTransactionType,
  ChangeTopic,
  DeviceStatus,
  DeviceType,
  DiscountType,
  FulfillmentType,
  KitchenTicketStatus,
  OrderChannel,
  OrderStatus,
  PaymentMethodType,
  PaymentRecordStatus,
  PaymentStatus,
  PaymentTransactionType,
  ShiftStatus,
  SyncConnectionState,
  SyncEntityType,
  SyncOperationStatus,
  SyncOperationType,
  SyncResultStatus,
  TicketPriority,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/*
 * Outbox payloads: database rows of one aggregate as the hub stored them (dates as ISO strings),
 * the full state after the change (ADR 0012). Unknown keys are stripped, so a newer hub adding a
 * column does not break an older cloud; a test in apps/api keeps these shapes equal to the Prisma
 * models.
 */

const at = isoDateTimeSchema;
const text = z.string().max(10_000);
const int = z.int();

export const syncCashTransactionSchema = z.object({
  id: idSchema,
  shiftId: idSchema,
  type: z.enum(enumValues(CashTransactionType)),
  amount: int,
  paymentId: idSchema.nullable(),
  reason: text.nullable(),
  createdById: idSchema.nullable(),
  createdAt: at,
});

export const syncPaymentSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  orderId: idSchema,
  /** Null only for drawer-less payments: ONLINE, and CARD at a kiosk's terminal (ADR 0022). */
  shiftId: idSchema.nullable(),
  /** The terminal device that took it (a kiosk); absent in operations of an older hub. */
  deviceId: idSchema.nullable().default(null),
  /** The provider account that took it (ADR 0024); absent in operations of an older hub. */
  providerAccountId: idSchema.nullable().default(null),
  paymentMethodId: idSchema,
  methodType: z.enum(enumValues(PaymentMethodType)),
  methodNameEn: text,
  methodNameAr: text,
  type: z.enum(enumValues(PaymentTransactionType)),
  status: z.enum(enumValues(PaymentRecordStatus)),
  provider: text,
  providerRef: text.nullable(),
  amount: int,
  tendered: int.nullable(),
  change: int,
  roundingAdjustment: int,
  reference: text.nullable(),
  refundOfId: idSchema.nullable(),
  reason: text.nullable(),
  createdById: idSchema.nullable(),
  createdAt: at,
  updatedAt: at,
  /**
   * Cash movements this payment caused; they travel with the payment. Absent in operations queued
   * by a Phase 5 hub: those movements then arrive with the shift (see apply-operation.ts).
   */
  cash: z.array(syncCashTransactionSchema).default([]),
});

export const syncOrderItemModifierSchema = z.object({
  id: idSchema,
  orderItemId: idSchema,
  modifierId: idSchema,
  modifierGroupId: idSchema,
  nameEn: text,
  nameAr: text,
  priceDelta: int,
});

export const syncOrderItemSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  productId: idSchema,
  variantId: idSchema.nullable(),
  nameEn: text,
  nameAr: text,
  variantNameEn: text.nullable(),
  variantNameAr: text.nullable(),
  sku: text.nullable(),
  barcode: text.nullable(),
  quantity: int,
  basePrice: int,
  unitPrice: int,
  gross: int,
  discount: int,
  tax: int,
  total: int,
  notes: text.nullable(),
  stationIds: z.array(idSchema),
  sortOrder: int,
  createdAt: at,
  updatedAt: at,
  modifiers: z.array(syncOrderItemModifierSchema),
});

export const syncOrderTaxSchema = z.object({
  orderId: idSchema,
  taxId: idSchema,
  nameEn: text,
  nameAr: text,
  rateBps: int,
  taxableAmount: int,
  amount: int,
});

export const syncOrderDiscountSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  discountId: idSchema,
  nameEn: text,
  nameAr: text,
  type: z.enum(enumValues(DiscountType)),
  value: int,
  amount: int,
  appliedById: idSchema.nullable(),
  createdAt: at,
});

export const syncOrderStatusHistorySchema = z.object({
  id: idSchema,
  orderId: idSchema,
  fromStatus: z.enum(enumValues(OrderStatus)).nullable(),
  toStatus: z.enum(enumValues(OrderStatus)),
  actorType: z.enum(enumValues(ActorType)),
  actorId: idSchema.nullable(),
  source: z.enum(enumValues(ActionSource)),
  reason: text.nullable(),
  createdAt: at,
});

export const syncOrderSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  orderNumber: z.string().min(1).max(40),
  businessDate: at,
  channel: z.enum(enumValues(OrderChannel)),
  status: z.enum(enumValues(OrderStatus)),
  paymentStatus: z.enum(enumValues(PaymentStatus)),
  source: z.enum(enumValues(ActionSource)),
  tableId: idSchema.nullable(),
  customerName: text.nullable(),
  customerPhone: text.nullable(),
  guestCount: int.nullable(),
  /** Website orders (Phase 7); absent in operations queued by an older hub. */
  customerEmail: text.nullable().default(null),
  fulfillmentType: z.enum(enumValues(FulfillmentType)).nullable().default(null),
  deliveryAddress: z.record(z.string(), z.unknown()).nullable().default(null),
  notes: text.nullable(),
  currencyCode: z.string().length(3),
  taxInclusive: z.boolean(),
  subtotal: int,
  discountTotal: int,
  taxTotal: int,
  feeTotal: int,
  total: int,
  version: int.min(1),
  createdById: idSchema.nullable(),
  placedAt: at.nullable(),
  acceptBy: at.nullable().default(null),
  completedAt: at.nullable(),
  cancelledAt: at.nullable(),
  cancelReason: text.nullable(),
  createdAt: at,
  updatedAt: at,
  items: z.array(syncOrderItemSchema).max(500),
  taxes: z.array(syncOrderTaxSchema).max(50),
  discounts: z.array(syncOrderDiscountSchema).max(50),
  statusHistory: z.array(syncOrderStatusHistorySchema).max(200),
  payments: z.array(syncPaymentSchema).max(100),
});
export type SyncOrder = z.infer<typeof syncOrderSchema>;

export const syncShiftSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  cashRegisterId: idSchema,
  status: z.enum(enumValues(ShiftStatus)),
  openRegisterId: idSchema.nullable(),
  openingFloat: int,
  openedById: idSchema,
  openedAt: at,
  closedById: idSchema.nullable(),
  closedAt: at.nullable(),
  expectedCash: int.nullable(),
  countedCash: int.nullable(),
  cashDifference: int.nullable(),
  closingNotes: text.nullable(),
  createdAt: at,
  updatedAt: at,
  cash: z.array(syncCashTransactionSchema).max(2000),
});
export type SyncShift = z.infer<typeof syncShiftSchema>;

export const syncTicketItemSchema = z.object({
  id: idSchema,
  ticketId: idSchema,
  orderItemId: idSchema,
  nameEn: text,
  nameAr: text,
  variantNameEn: text.nullable(),
  variantNameAr: text.nullable(),
  quantity: int,
  notes: text.nullable(),
  modifiers: z.array(z.object({ nameEn: text, nameAr: text })),
  sortOrder: int,
  doneAt: at.nullable(),
});

export const syncKitchenTicketSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  orderId: idSchema,
  stationId: idSchema,
  status: z.enum(enumValues(KitchenTicketStatus)),
  priority: z.enum(enumValues(TicketPriority)),
  version: int.min(1),
  revision: int.min(1),
  startedAt: at.nullable(),
  readyAt: at.nullable(),
  completedAt: at.nullable(),
  cancelledAt: at.nullable(),
  dismissedAt: at.nullable(),
  createdAt: at,
  updatedAt: at,
  items: z.array(syncTicketItemSchema).max(500),
});
export type SyncKitchenTicket = z.infer<typeof syncKitchenTicketSchema>;

/**
 * An audit-trail entry written on the hub (PIN sign-ins, shifts, refunds at the till...). The
 * cloud stores it under the hub's tenant and location; entries are never changed (ADR 0016).
 */
export const syncAuditLogSchema = z.object({
  id: idSchema,
  tenantId: idSchema.nullable(),
  locationId: idSchema.nullable(),
  actorType: z.enum(enumValues(ActorType)),
  actorId: idSchema.nullable(),
  source: z.enum(enumValues(ActionSource)).nullable(),
  action: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().max(100).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  requestId: z.string().max(128).nullable(),
  createdAt: at,
});
export type SyncAuditLog = z.infer<typeof syncAuditLogSchema>;

/**
 * A terminal as its hub knows it (ADR 0022): paired there, and what it last reported. Never its
 * credential or pairing code. The cloud takes the pairing (PENDING → ACTIVE), the last contact and
 * the app version; it never brings back a device it disabled.
 */
export const syncDeviceSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  type: z.enum(enumValues(DeviceType)),
  status: z.enum(enumValues(DeviceStatus)),
  pairedAt: at.nullable(),
  lastSeenAt: at.nullable(),
  appVersion: z.string().min(1).max(40).nullable(),
  /** When the terminal first reported that version (ADR 0026); absent from older outbox rows. */
  lastVersionAt: at.nullable().optional(),
});
export type SyncDevice = z.infer<typeof syncDeviceSchema>;

// --- Push (hub → cloud) -------------------------------------------------------------------------

const operationBase = {
  operationId: idSchema,
  entityId: idSchema,
  entityVersion: z.int().min(1),
  /**
   * For a website order received from the cloud: the cloud version the hub's change was based on.
   * The cloud hands the order over only if its copy is still exactly that version (ADR 0013).
   */
  baseVersion: z.int().min(1).optional(),
};

/** One outbox row as sent to the cloud; the operation type decides the payload shape. */
export const syncOperationSchema = z.discriminatedUnion('operationType', [
  z.object({
    ...operationBase,
    entityType: z.literal(SyncEntityType.Order),
    operationType: z.literal(SyncOperationType.ORDER_UPSERT),
    payload: syncOrderSchema,
  }),
  z.object({
    ...operationBase,
    entityType: z.literal(SyncEntityType.Shift),
    operationType: z.literal(SyncOperationType.SHIFT_UPSERT),
    payload: syncShiftSchema,
  }),
  z.object({
    ...operationBase,
    entityType: z.literal(SyncEntityType.KitchenTicket),
    operationType: z.literal(SyncOperationType.KITCHEN_TICKET_UPSERT),
    payload: syncKitchenTicketSchema,
  }),
  z.object({
    ...operationBase,
    entityType: z.literal(SyncEntityType.AuditLog),
    operationType: z.literal(SyncOperationType.AUDIT_LOG_APPEND),
    payload: syncAuditLogSchema,
  }),
  z.object({
    ...operationBase,
    entityType: z.literal(SyncEntityType.Device),
    operationType: z.literal(SyncOperationType.DEVICE_UPSERT),
    payload: syncDeviceSchema,
  }),
]);
export type SyncOperation = z.infer<typeof syncOperationSchema>;

export const SYNC_PUSH_MAX_OPERATIONS = 50;

/**
 * Operations are applied in the order given. The envelope is validated first; each payload is
 * then validated on its own, so one malformed operation is rejected without failing the batch.
 */
export const syncPushRequestSchema = z.object({
  operations: z
    .array(
      z.object({
        operationId: idSchema,
        entityType: z.string().max(40),
        entityId: idSchema,
        operationType: z.string().max(40),
        entityVersion: z.int().min(1),
        baseVersion: z.int().min(1).optional(),
        payload: z.unknown(),
      }),
    )
    .min(1)
    .max(SYNC_PUSH_MAX_OPERATIONS),
  /** The hub's outbox, reported for the admin portal (device metadata). */
  outbox: z.object({ pending: z.int().min(0), failed: z.int().min(0) }).optional(),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const syncOperationResultSchema = z.object({
  operationId: idSchema,
  status: z.enum(enumValues(SyncResultStatus)),
  /** Error code (`SYNC_CONFLICT`, `VALIDATION_FAILED`, …) for CONFLICT, REJECTED and RETRY. */
  code: z.string().nullable(),
  message: z.string().nullable(),
});
export type SyncOperationResult = z.infer<typeof syncOperationResultSchema>;

export const syncPushResponseSchema = z.object({ results: z.array(syncOperationResultSchema) });
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

// --- Pull (cloud → hub) -------------------------------------------------------------------------

/** Feed positions are 64-bit sequence numbers, sent as decimal strings. */
export const changeCursorSchema = z.string().regex(/^\d{1,19}$/);

export const syncPullQuerySchema = z.object({
  /** Last sequence the hub handled; omitted: answer with the head of the feed and no changes. */
  cursor: changeCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** Long poll: seconds to wait for a change when there is none yet. */
  wait: z.coerce.number().int().min(0).max(30).default(0),
});
export interface SyncPullQuery {
  cursor?: string;
  limit?: number;
  wait?: number;
}

export const changeEntrySchema = z.object({
  seq: changeCursorSchema,
  topic: z.enum(enumValues(ChangeTopic)),
  entityId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ChangeEntry = z.infer<typeof changeEntrySchema>;

export const syncPullResponseSchema = z.object({
  changes: z.array(changeEntrySchema),
  /** Where to continue from: the last returned change, or the request's cursor if none. */
  cursor: changeCursorSchema,
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

// --- Cloud: refused operations, for administrators ----------------------------------------------

export const syncIssueSchema = z.object({
  operationId: idSchema,
  deviceId: idSchema,
  entityType: z.string(),
  entityId: idSchema,
  operationType: z.string(),
  entityVersion: z.int(),
  status: z.enum(['CONFLICT', 'REJECTED']),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attempts: z.int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SyncIssue = z.infer<typeof syncIssueSchema>;

// --- Hub: outbox detail (hub → POS) -------------------------------------------------------------

export const hubSyncOperationSchema = z.object({
  id: idSchema,
  operationId: idSchema,
  entityType: z.string(),
  entityId: idSchema,
  operationType: z.string(),
  /** Human label of the entity, e.g. the order number; null when it has none. */
  label: z.string().nullable(),
  status: z.enum(enumValues(SyncOperationStatus)),
  retryCount: z.int(),
  nextRetryAt: isoDateTimeSchema.nullable(),
  /** Error code of the last failure; screens translate it (`errors:<code>`). */
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
});
export type HubSyncOperation = z.infer<typeof hubSyncOperationSchema>;

export const hubSyncOperationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'FAILED', 'COMPLETED']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export interface HubSyncOperationsQuery {
  status?: z.output<typeof hubSyncOperationsQuerySchema>['status'];
  limit?: number;
}

export const hubSyncOperationListSchema = z.object({ items: z.array(hubSyncOperationSchema) });

export const syncConnectionStateSchema = z.enum(enumValues(SyncConnectionState));
