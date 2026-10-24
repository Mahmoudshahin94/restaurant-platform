import { KioskPaymentOption, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import { pinLoginRequestSchema } from './auth';
import { idSchema } from './common';
import { tenantContextSchema } from './features';
import { terminalSchema } from './hub';
import { orderItemInputSchema, orderSchema } from './orders';
import { orderPaymentSchema } from './payments';

/*
 * The self-service kiosk (ADR 0022). A kiosk is a terminal device paired with its location hub;
 * it reads the menu, places its own orders and pays at its card terminal, nothing else. Prices,
 * taxes and totals are always recomputed by the server, exactly as for the POS.
 */

export const kioskPaymentOptionSchema = z.enum(enumValues(KioskPaymentOption));

/** Everything the kiosk renders: who it is, where, and the tenant's context for the kiosk surface. */
export const kioskContextSchema = z.object({
  device: terminalSchema,
  location: z.object({
    id: idSchema,
    code: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    timezone: z.string(),
  }),
  /** Branding of the `kiosk` surface; modules resolved for the location and this device. */
  context: tenantContextSchema,
});
export type KioskContext = z.infer<typeof kioskContextSchema>;

const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const createKioskOrderSchema = z.object({
  /** Client-generated UUIDv7, the idempotency key: a resend returns the same order. */
  id: idSchema,
  items: z
    .array(orderItemInputSchema)
    .min(1)
    .max(100)
    .refine((items) => unique(items.map((i) => i.id)), { message: 'Duplicate line id' }),
  /** TERMINAL: pay here next (`/payments`); COUNTER: the order waits for a cashier. */
  payment: kioskPaymentOptionSchema,
  /** A first name to call when the order is ready (optional). */
  customerName: z.string().trim().min(1).max(60).nullable().default(null),
});
export type CreateKioskOrderRequest = z.input<typeof createKioskOrderSchema>;

/**
 * Pays what is left of a kiosk order at the kiosk's own card terminal. The id is the payment's
 * idempotency key: a retry after a lost answer never charges twice.
 */
export const kioskPaymentSchema = z.object({ id: idSchema });
export type KioskPaymentRequest = z.input<typeof kioskPaymentSchema>;

export const kioskPaymentOutcomeSchema = z.object({
  payment: orderPaymentSchema,
  order: orderSchema,
});
export type KioskPaymentOutcome = z.infer<typeof kioskPaymentOutcomeSchema>;

/** A staff member leaving the customer screens (employee code and PIN, as at the POS). */
export const kioskAttendantRequestSchema = pinLoginRequestSchema.pick({
  employeeCode: true,
  pin: true,
});
export type KioskAttendantRequest = z.input<typeof kioskAttendantRequestSchema>;

export const kioskAttendantSchema = z.object({
  employeeId: idSchema,
  displayName: z.string(),
});
export type KioskAttendant = z.infer<typeof kioskAttendantSchema>;
