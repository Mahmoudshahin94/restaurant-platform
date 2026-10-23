import {
  FulfillmentType,
  OnlineOrderingState,
  OrderStatus,
  PaymentStatus,
  WebPaymentOption,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { resolvedBrandingSchema } from './branding';
import { idSchema, isoDateTimeSchema, localeSchema, minorUnitsSchema } from './common';
import { orderItemInputSchema } from './orders';

/*
 * Online ordering (Phase 7, ADR 0013): the public customer API and the tenant's settings.
 * Customer requests never carry prices: the cloud re-prices every order with the domain engine.
 */

export const fulfillmentTypeSchema = z.enum(enumValues(FulfillmentType));
export const webPaymentOptionSchema = z.enum(enumValues(WebPaymentOption));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const openingWindowSchema = z.object({
  /** 0 = Sunday … 6 = Saturday, in the location timezone. */
  day: z.int().min(0).max(6),
  open: time,
  /** At or before `open`: the window runs past midnight. */
  close: time,
});
export type OpeningWindowInput = z.infer<typeof openingWindowSchema>;

/** Why online ordering is not open; null when it is. */
export const onlineOrderingReasonSchema = z
  .enum(['LOCATION_INACTIVE', 'SETTING_CLOSED', 'SETTING_PAUSED', 'OUTSIDE_HOURS', 'HUB_OFFLINE'])
  .nullable();

export const onlineOrderingStatusSchema = z.object({
  state: z.enum(enumValues(OnlineOrderingState)),
  reason: onlineOrderingReasonSchema,
});
export type OnlineOrderingStatusDto = z.infer<typeof onlineOrderingStatusSchema>;

// --- Tenant settings (admin, cloud) -----------------------------------------------------------

export const onlineOrderingSettingsSchema = z.object({
  /** What the tenant chose; OFFLINE is never set by hand (it comes from the hub heartbeat). */
  state: z.enum(['OPEN', 'PAUSED', 'CLOSED']),
  openingHours: z.array(openingWindowSchema).max(28),
  acceptMinutes: z.int().min(1).max(240),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryFee: minorUnitsSchema,
});
export type OnlineOrderingSettings = z.infer<typeof onlineOrderingSettingsSchema>;

export const updateOnlineOrderingSchema = onlineOrderingSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateOnlineOrderingRequest = z.input<typeof updateOnlineOrderingSchema>;

/** Settings plus what customers see right now. */
export const onlineOrderingOverviewSchema = onlineOrderingSettingsSchema.extend({
  status: onlineOrderingStatusSchema,
  hubLastSeenAt: isoDateTimeSchema.nullable(),
});
export type OnlineOrderingOverview = z.infer<typeof onlineOrderingOverviewSchema>;

// --- Public storefront ----------------------------------------------------------------------------

export const publicLocationSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  addressLine: z.string().nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  currencyCode: z.string(),
  taxInclusive: z.boolean(),
  status: onlineOrderingStatusSchema,
  openingHours: z.array(openingWindowSchema),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryFee: z.int(),
  acceptMinutes: z.int(),
  /** Whether customers can pay online by card (an online gateway and method are configured). */
  onlineCardEnabled: z.boolean(),
});
export type PublicLocation = z.infer<typeof publicLocationSchema>;

export const publicTenantSchema = z.object({
  id: idSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  currencyCode: z.string(),
  defaultLocale: localeSchema,
  timezone: z.string(),
  locations: z.array(publicLocationSchema),
  /** The website's branding (surface `website`, ADR 0019); its files are public. */
  branding: resolvedBrandingSchema,
});
export type PublicTenant = z.infer<typeof publicTenantSchema>;

// --- Customer orders ------------------------------------------------------------------------------

export const deliveryAddressSchema = z.object({
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).nullable().default(null),
  city: z.string().trim().max(100).nullable().default(null),
  notes: z.string().trim().max(300).nullable().default(null),
});
export type DeliveryAddressInput = z.input<typeof deliveryAddressSchema>;

/**
 * A test token of the documented mock card adapter (`tok_mock_…`), standing in for what a real
 * gateway's browser SDK returns. Card numbers never reach this API.
 */
export const cardTokenSchema = z.string().regex(/^tok_[A-Za-z0-9_]{3,60}$/);

export const createWebOrderSchema = z
  .object({
    /** Client-generated UUIDv7: the idempotency key (a resend never duplicates the order). */
    id: idSchema,
    locationId: idSchema,
    fulfillment: fulfillmentTypeSchema,
    deliveryAddress: deliveryAddressSchema.nullable().default(null),
    customer: z.object({
      name: z.string().trim().min(1).max(120),
      phone: z
        .string()
        .trim()
        .regex(/^\+?[0-9 ()-]{5,20}$/),
      email: z.email().max(200).nullable().default(null),
    }),
    items: z
      .array(orderItemInputSchema)
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((i) => i.id)).size === items.length, {
        message: 'Duplicate line id',
      }),
    notes: z.string().trim().max(500).nullable().default(null),
    payment: z.object({
      option: webPaymentOptionSchema,
      cardToken: cardTokenSchema.nullable().default(null),
    }),
  })
  .superRefine((order, ctx) => {
    if (order.fulfillment === 'DELIVERY' && !order.deliveryAddress) {
      ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Address required' });
    }
    if (order.fulfillment === 'PICKUP' && order.deliveryAddress) {
      ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Pickup has no address' });
    }
    if ((order.payment.option === 'ONLINE_CARD') !== (order.payment.cardToken !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['payment', 'cardToken'],
        message: 'A card token goes with online card payment only',
      });
    }
  });
export type CreateWebOrderRequest = z.input<typeof createWebOrderSchema>;

/** What the customer sees of an order (no staff, device or internal ids). */
export const publicOrderSchema = z.object({
  id: idSchema,
  orderNumber: z.string(),
  locationId: idSchema,
  location: z.object({
    nameEn: z.string(),
    nameAr: z.string(),
    phone: z.string().nullable(),
    addressLine: z.string().nullable(),
    timezone: z.string(),
  }),
  status: z.enum(enumValues(OrderStatus)),
  paymentStatus: z.enum(enumValues(PaymentStatus)),
  paymentOption: webPaymentOptionSchema,
  fulfillmentType: fulfillmentTypeSchema,
  deliveryAddress: z
    .object({
      line1: z.string(),
      line2: z.string().nullable(),
      city: z.string().nullable(),
      notes: z.string().nullable(),
    })
    .nullable(),
  customerName: z.string(),
  notes: z.string().nullable(),
  currencyCode: z.string(),
  taxInclusive: z.boolean(),
  items: z.array(
    z.object({
      id: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      variantNameEn: z.string().nullable(),
      variantNameAr: z.string().nullable(),
      quantity: z.int(),
      unitPrice: z.int(),
      total: z.int(),
      notes: z.string().nullable(),
      modifiers: z.array(z.object({ nameEn: z.string(), nameAr: z.string(), priceDelta: z.int() })),
    }),
  ),
  subtotal: z.int(),
  discountTotal: z.int(),
  taxTotal: z.int(),
  feeTotal: z.int(),
  total: z.int(),
  placedAt: isoDateTimeSchema.nullable(),
  acceptBy: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  /** A reject reason code (`TOO_BUSY`, …, `ACCEPTANCE_TIMEOUT`), `OTHER` for free text. */
  cancelReason: z.string().nullable(),
  /** Status changes the customer can follow, oldest first. */
  timeline: z.array(z.object({ status: z.enum(enumValues(OrderStatus)), at: isoDateTimeSchema })),
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;

export const webOrderCreatedSchema = z.object({
  order: publicOrderSchema,
  /** Opens the order's status page; shown once to the customer (keep it like a password). */
  trackingToken: z.string(),
});
export type WebOrderCreated = z.infer<typeof webOrderCreatedSchema>;
