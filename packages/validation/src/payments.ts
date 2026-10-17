import {
  CashTransactionType,
  OrderChannel,
  PaymentMethodType,
  PaymentRecordStatus,
  PaymentTransactionType,
  ShiftStatus,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema, minorUnitsSchema } from './common';

export const paymentMethodTypeSchema = z.enum(enumValues(PaymentMethodType));

export const paymentMethodSchema = z.object({
  id: idSchema,
  type: paymentMethodTypeSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  sortOrder: z.int(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const orderPaymentSchema = z.object({
  id: idSchema,
  type: z.enum(enumValues(PaymentTransactionType)),
  status: z.enum(enumValues(PaymentRecordStatus)),
  paymentMethodId: idSchema,
  methodType: paymentMethodTypeSchema,
  methodNameEn: z.string(),
  methodNameAr: z.string(),
  amount: z.int(),
  tendered: z.int().nullable(),
  change: z.int(),
  roundingAdjustment: z.int(),
  reference: z.string().nullable(),
  refundOfId: idSchema.nullable(),
  reason: z.string().nullable(),
  /** Null for online payments (they touch no drawer). */
  shiftId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type OrderPayment = z.infer<typeof orderPaymentSchema>;

const referenceSchema = z.string().trim().min(1).max(64);

export const createPaymentSchema = z.object({
  /** Client-generated UUID — the idempotency key for this payment. */
  id: idSchema,
  shiftId: idSchema,
  paymentMethodId: idSchema,
  /** Amount applied to the order, minor units. */
  amount: minorUnitsSchema.min(1),
  /** Cash handed over (cash only). */
  tendered: minorUnitsSchema.nullable().default(null),
  /** Card approval code or terminal receipt number (card only). Never a card number. */
  reference: referenceSchema.nullable().default(null),
});
export type CreatePaymentRequest = z.input<typeof createPaymentSchema>;

export const refundPaymentSchema = z.object({
  id: idSchema,
  /** The open shift whose drawer pays out cash refunds. */
  shiftId: idSchema,
  amount: minorUnitsSchema.min(1),
  reason: z.string().trim().min(1).max(300),
});
export type RefundPaymentRequest = z.input<typeof refundPaymentSchema>;

// --- Shifts -----------------------------------------------------------------------------------

export const cashRegisterSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  /** The open shift on this drawer, if any. */
  openShiftId: idSchema.nullable(),
});
export type CashRegister = z.infer<typeof cashRegisterSchema>;

export const cashTransactionSchema = z.object({
  id: idSchema,
  type: z.enum(enumValues(CashTransactionType)),
  amount: z.int(),
  paymentId: idSchema.nullable(),
  reason: z.string().nullable(),
  createdById: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type CashTransaction = z.infer<typeof cashTransactionSchema>;

export const methodTotalsSchema = z.object({
  paymentMethodId: idSchema,
  type: paymentMethodTypeSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  count: z.int(),
  charges: z.int(),
  refunds: z.int(),
  net: z.int(),
});
export type MethodTotals = z.infer<typeof methodTotalsSchema>;

export const shiftSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  cashRegisterId: idSchema,
  cashRegisterNameEn: z.string(),
  cashRegisterNameAr: z.string(),
  status: z.enum(enumValues(ShiftStatus)),
  openingFloat: z.int(),
  openedById: idSchema,
  openedByName: z.string(),
  openedAt: isoDateTimeSchema,
  closedById: idSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  expectedCash: z.int().nullable(),
  countedCash: z.int().nullable(),
  cashDifference: z.int().nullable(),
  closingNotes: z.string().nullable(),
  summary: z.object({
    cash: z.object({
      openingFloat: z.int(),
      cashSales: z.int(),
      cashRefunds: z.int(),
      payIns: z.int(),
      payOuts: z.int(),
      expectedCash: z.int(),
    }),
    byMethod: z.array(methodTotalsSchema),
    /** Orders with at least one payment in this shift. */
    orderCount: z.int(),
  }),
  cashTransactions: z.array(cashTransactionSchema),
});
export type Shift = z.infer<typeof shiftSchema>;

export const openShiftSchema = z.object({
  id: idSchema,
  cashRegisterId: idSchema,
  openingFloat: minorUnitsSchema,
});
export type OpenShiftRequest = z.input<typeof openShiftSchema>;

export const cashMovementSchema = z.object({
  id: idSchema,
  type: z.enum(['PAY_IN', 'PAY_OUT']),
  amount: minorUnitsSchema.min(1),
  reason: z.string().trim().min(1).max(300),
});
export type CashMovementRequest = z.input<typeof cashMovementSchema>;

export const closeShiftSchema = z.object({
  countedCash: minorUnitsSchema,
  notes: z.string().trim().max(500).nullable().default(null),
});
export type CloseShiftRequest = z.input<typeof closeShiftSchema>;

export const listShiftsQuerySchema = z.object({
  status: z.enum(enumValues(ShiftStatus)).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// --- Daily summary ---------------------------------------------------------------------------

export const dailySummarySchema = z.object({
  businessDate: z.iso.date(),
  currencyCode: z.string(),
  orders: z.object({
    /** Placed (non-draft) orders that were not cancelled. */
    count: z.int(),
    completed: z.int(),
    open: z.int(),
    cancelled: z.int(),
  }),
  /** Totals of non-cancelled, non-draft orders. */
  sales: z.object({
    subtotal: z.int(),
    discounts: z.int(),
    tax: z.int(),
    total: z.int(),
  }),
  byChannel: z.array(
    z.object({ channel: z.enum(enumValues(OrderChannel)), count: z.int(), total: z.int() }),
  ),
  payments: z.array(methodTotalsSchema),
  /** Collected minus refunded, all methods. */
  netCollected: z.int(),
});
export type DailySummary = z.infer<typeof dailySummarySchema>;
