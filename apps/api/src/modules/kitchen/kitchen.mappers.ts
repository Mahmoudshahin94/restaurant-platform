import type { Prisma } from '@pos/database';
import type { EventType, KitchenTicketEventPayload } from '@pos/shared-types';
import type { KitchenTicket, OrderTicketSummary } from '@pos/validation';

export const ticketInclude = {
  items: { orderBy: { sortOrder: 'asc' } },
  station: { select: { code: true, nameEn: true, nameAr: true } },
  order: {
    select: {
      orderNumber: true,
      status: true,
      channel: true,
      customerName: true,
      guestCount: true,
      notes: true,
      table: { select: { label: true } },
    },
  },
} satisfies Prisma.KitchenTicketInclude;

export type TicketRow = Prisma.KitchenTicketGetPayload<{ include: typeof ticketInclude }>;

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

interface ModifierSnapshot {
  nameEn: string;
  nameAr: string;
}

export function modifiersOf(value: Prisma.JsonValue): ModifierSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((m) =>
    m && typeof m === 'object' && !Array.isArray(m) && typeof m.nameEn === 'string'
      ? [{ nameEn: m.nameEn, nameAr: typeof m.nameAr === 'string' ? m.nameAr : m.nameEn }]
      : [],
  );
}

export function toTicketDto(row: TicketRow): KitchenTicket {
  return {
    id: row.id,
    locationId: row.locationId,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    orderStatus: row.order.status,
    channel: row.order.channel,
    tableLabel: row.order.table?.label ?? null,
    customerName: row.order.customerName,
    guestCount: row.order.guestCount,
    orderNotes: row.order.notes,
    stationId: row.stationId,
    stationCode: row.station.code,
    stationNameEn: row.station.nameEn,
    stationNameAr: row.station.nameAr,
    status: row.status,
    priority: row.priority,
    version: row.version,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    startedAt: isoOrNull(row.startedAt),
    readyAt: isoOrNull(row.readyAt),
    completedAt: isoOrNull(row.completedAt),
    cancelledAt: isoOrNull(row.cancelledAt),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      variantNameEn: item.variantNameEn,
      variantNameAr: item.variantNameAr,
      quantity: item.quantity,
      notes: item.notes,
      modifiers: modifiersOf(item.modifiers),
      doneAt: isoOrNull(item.doneAt),
    })),
  };
}

export const orderTicketsInclude = {
  orderBy: { createdAt: 'asc' },
  include: { station: { select: { nameEn: true, nameAr: true } } },
} satisfies Prisma.Order$ticketsArgs;

export function toTicketSummary(
  row: Prisma.KitchenTicketGetPayload<{ include: typeof orderTicketsInclude.include }>,
): OrderTicketSummary {
  return {
    id: row.id,
    stationId: row.stationId,
    stationNameEn: row.station.nameEn,
    stationNameAr: row.station.nameAr,
    status: row.status,
    priority: row.priority,
  };
}

export type TicketEventType = Extract<EventType, `kitchen.${string}`>;

export function ticketEventPayload(
  ticket: {
    id: string;
    orderId: string;
    stationId: string;
    status: KitchenTicket['status'];
    version: number;
  },
  orderNumber: string,
): KitchenTicketEventPayload {
  return {
    ticketId: ticket.id,
    orderId: ticket.orderId,
    orderNumber,
    stationId: ticket.stationId,
    status: ticket.status,
    version: ticket.version,
  };
}
