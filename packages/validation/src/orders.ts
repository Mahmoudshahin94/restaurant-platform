import {
  ActionSource,
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { orderPaymentSchema } from './payments';
import { discountTypeSchema } from './pricing-config';

export const orderChannelSchema = z.enum(enumValues(OrderChannel));
export const orderStatusSchema = z.enum(enumValues(OrderStatus));
export const paymentStatusSchema = z.enum(enumValues(PaymentStatus));

const notesSchema = z.string().trim().max(500).nullable();
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{5,20}$/);

export const orderItemInputSchema = z.object({
  /** Client-generated line id (UUID), stable across edits. */
  id: idSchema,
  productId: idSchema,
  variantId: idSchema.nullable().default(null),
  modifierIds: z.array(idSchema).max(50).default([]),
  quantity: z.int().min(1).max(999),
  notes: notesSchema.default(null),
});
export type OrderItemInput = z.input<typeof orderItemInputSchema>;

const unique = (values: readonly string[]) => new Set(values).size === values.length;

const orderContentFields = {
  items: z
    .array(orderItemInputSchema)
    .min(1)
    .max(200)
    .refine((items) => unique(items.map((i) => i.id)), { message: 'Duplicate line id' }),
  discountIds: z
    .array(idSchema)
    .max(5)
    .refine(unique, { message: 'Duplicate discount' })
    .default([]),
  tableId: idSchema.nullable().default(null),
  customerName: z.string().trim().min(1).max(120).nullable().default(null),
  customerPhone: phoneSchema.nullable().default(null),
  guestCount: z.int().min(1).max(500).nullable().default(null),
  notes: notesSchema.default(null),
};

/** Channels staff can create at the POS. WEBSITE orders come only from the customer API. */
export const staffOrderChannelSchema = orderChannelSchema.exclude(['WEBSITE']);

function channelRules(
  order: {
    channel: string;
    tableId: string | null;
    customerName: string | null;
    customerPhone: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (order.channel === 'DINE_IN' && !order.tableId) {
    ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Dine-in orders need a table' });
  }
  if (order.channel !== 'DINE_IN' && order.tableId) {
    ctx.addIssue({
      code: 'custom',
      path: ['tableId'],
      message: 'Only dine-in orders have a table',
    });
  }
  if (
    (order.channel === 'PHONE' || order.channel === 'DELIVERY') &&
    !order.customerName &&
    !order.customerPhone
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['customerPhone'],
      message: 'Phone and delivery orders need a customer',
    });
  }
}

export const createOrderSchema = z
  .object({
    /** Client-generated UUIDv7 — the idempotency key: resending the same id never duplicates. */
    id: idSchema,
    channel: staffOrderChannelSchema,
    /** DRAFT keeps the order open for editing without sending it on. */
    status: z.enum(['DRAFT', 'PLACED']).default('PLACED'),
    ...orderContentFields,
  })
  .superRefine(channelRules);
export type CreateOrderRequest = z.input<typeof createOrderSchema>;

/** Replaces the order's items, discounts and details. Allowed before the kitchen starts. */
export const updateOrderSchema = z
  .object({
    version: z.int().min(1),
    channel: staffOrderChannelSchema,
    ...orderContentFields,
  })
  .superRefine(channelRules);
export type UpdateOrderRequest = z.input<typeof updateOrderSchema>;

export const transitionOrderSchema = z.object({
  to: orderStatusSchema,
  reason: z.string().trim().max(300).nullable().default(null),
  /** When given, the change only applies if the order is still at this version. */
  version: z.int().min(1).optional(),
});
export type TransitionOrderRequest = z.input<typeof transitionOrderSchema>;

export const listOrdersQuerySchema = z.object({
  /** Comma-separated statuses, e.g. "PLACED,CONFIRMED". */
  status: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const parts = v.split(',').map((s) => s.trim());
      const parsed = z.array(orderStatusSchema).safeParse(parts);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'Unknown status' });
        return z.NEVER;
      }
      return parsed.data;
    }),
  /** Only orders that are not completed, cancelled or refunded. */
  open: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  businessDate: z.iso.date().optional(),
  tableId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListOrdersQuery = z.input<typeof listOrdersQuerySchema>;

export const orderItemSchema = z.object({
  id: idSchema,
  productId: idSchema,
  variantId: idSchema.nullable(),
  nameEn: z.string(),
  nameAr: z.string(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  quantity: z.int(),
  basePrice: z.int(),
  unitPrice: z.int(),
  gross: z.int(),
  discount: z.int(),
  tax: z.int(),
  total: z.int(),
  notes: z.string().nullable(),
  stationIds: z.array(idSchema),
  modifiers: z.array(
    z.object({
      modifierId: idSchema,
      modifierGroupId: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      priceDelta: z.int(),
    }),
  ),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: idSchema,
  restaurantId: idSchema,
  locationId: idSchema,
  orderNumber: z.string(),
  businessDate: z.iso.date(),
  channel: orderChannelSchema,
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  source: z.enum(enumValues(ActionSource)),
  tableId: idSchema.nullable(),
  tableLabel: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  guestCount: z.int().nullable(),
  notes: z.string().nullable(),
  currencyCode: z.string(),
  taxInclusive: z.boolean(),
  subtotal: z.int(),
  discountTotal: z.int(),
  taxTotal: z.int(),
  feeTotal: z.int(),
  total: z.int(),
  version: z.int(),
  createdById: idSchema.nullable(),
  placedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  items: z.array(orderItemSchema),
  taxes: z.array(
    z.object({
      taxId: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      rateBps: z.int(),
      taxableAmount: z.int(),
      amount: z.int(),
    }),
  ),
  discounts: z.array(
    z.object({
      discountId: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      type: discountTypeSchema,
      value: z.int(),
      amount: z.int(),
    }),
  ),
  payments: z.array(orderPaymentSchema),
  /** Charges minus refunds are reconciled against the total by the server. */
  paidTotal: z.int(),
  refundedTotal: z.int(),
  balanceDue: z.int(),
  statusHistory: z.array(
    z.object({
      fromStatus: orderStatusSchema.nullable(),
      toStatus: orderStatusSchema,
      source: z.enum(enumValues(ActionSource)),
      actorId: idSchema.nullable(),
      reason: z.string().nullable(),
      createdAt: isoDateTimeSchema,
    }),
  ),
});
export type Order = z.infer<typeof orderSchema>;
