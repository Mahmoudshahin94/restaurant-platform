import {
  KitchenTicketStatus,
  OrderChannel,
  OrderStatus,
  TicketPriority,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

export const kitchenTicketStatusSchema = z.enum(enumValues(KitchenTicketStatus));
export const ticketPrioritySchema = z.enum(enumValues(TicketPriority));

export const kitchenTicketItemSchema = z.object({
  id: idSchema,
  orderItemId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  quantity: z.int(),
  notes: z.string().nullable(),
  modifiers: z.array(z.object({ nameEn: z.string(), nameAr: z.string() })),
  /** Struck through by the cook. */
  doneAt: isoDateTimeSchema.nullable(),
});
export type KitchenTicketItem = z.infer<typeof kitchenTicketItemSchema>;

/** A ticket as the kitchen screen shows it: the station's items plus the order context. */
export const kitchenTicketSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  orderId: idSchema,
  orderNumber: z.string(),
  orderStatus: z.enum(enumValues(OrderStatus)),
  channel: z.enum(enumValues(OrderChannel)),
  tableLabel: z.string().nullable(),
  customerName: z.string().nullable(),
  guestCount: z.int().nullable(),
  orderNotes: z.string().nullable(),
  stationId: idSchema,
  stationCode: z.string(),
  stationNameEn: z.string(),
  stationNameAr: z.string(),
  status: kitchenTicketStatusSchema,
  priority: ticketPrioritySchema,
  version: z.int(),
  /** Greater than 1 when the order was edited after the ticket was sent. */
  revision: z.int(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  readyAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
  items: z.array(kitchenTicketItemSchema),
});
export type KitchenTicket = z.infer<typeof kitchenTicketSchema>;

/** Kitchen progress shown on the order (POS). */
export const orderTicketSummarySchema = z.object({
  id: idSchema,
  stationId: idSchema,
  stationNameEn: z.string(),
  stationNameAr: z.string(),
  status: kitchenTicketStatusSchema,
  priority: ticketPrioritySchema,
});
export type OrderTicketSummary = z.infer<typeof orderTicketSummarySchema>;

export const kitchenSettingsSchema = z.object({
  locationId: idSchema,
  warnMinutes: z.int(),
  lateMinutes: z.int(),
  stations: z.array(
    z.object({
      id: idSchema,
      code: z.string(),
      nameEn: z.string(),
      nameAr: z.string(),
      sortOrder: z.int(),
    }),
  ),
});
export type KitchenSettings = z.infer<typeof kitchenSettingsSchema>;

const stationIdsParam = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const ids = value.split(',').filter(Boolean);
    if (ids.length > 20 || ids.some((id) => !idSchema.safeParse(id).success)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid station ids' });
      return z.NEVER;
    }
    return ids;
  });

export const listTicketsQuerySchema = z.object({
  /** Comma-separated station ids; omitted = all stations (expo view). */
  stationIds: stationIdsParam,
  /** `active`: on the screen (incl. unacknowledged cancellations); `completed`: recently bumped. */
  view: z.enum(['active', 'completed']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTicketsQuery = z.input<typeof listTicketsQuerySchema>;

export const transitionTicketSchema = z.object({
  to: z.enum(['PREPARING', 'READY', 'COMPLETED']),
  version: z.int().min(1),
});
export type TransitionTicketRequest = z.input<typeof transitionTicketSchema>;

export const ticketPriorityRequestSchema = z.object({
  priority: ticketPrioritySchema,
  version: z.int().min(1),
});
export type TicketPriorityRequest = z.input<typeof ticketPriorityRequestSchema>;

export const ticketItemDoneSchema = z.object({ done: z.boolean() });
export type TicketItemDoneRequest = z.input<typeof ticketItemDoneSchema>;

export const dismissTicketSchema = z.object({ version: z.int().min(1) });
export type DismissTicketRequest = z.input<typeof dismissTicketSchema>;

/** POS: mark every live ticket of an order as rush (or back to normal). */
export const orderKitchenPrioritySchema = z.object({ priority: ticketPrioritySchema });
export type OrderKitchenPriorityRequest = z.input<typeof orderKitchenPrioritySchema>;
