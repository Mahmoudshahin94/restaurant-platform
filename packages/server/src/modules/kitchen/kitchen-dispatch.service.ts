import { Injectable } from '@nestjs/common';
import type { KitchenTicket as TicketRecord, Prisma } from '@pos/database';
import { DomainError, assertTicketTransition, planTickets, routeItems } from '@pos/domain';
import { ACTIVE_TICKET_STATUSES, Feature, type RealtimeEvent } from '@pos/shared-types';
import type { PrismaTx } from '../../prisma/prisma.service';
import { FeatureService } from '../features/feature.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import { jsonStringArray } from '../../prisma/json';
import { type TicketEventType, modifiersOf, ticketEventPayload } from './kitchen.mappers';

/** The order fields kitchen dispatch needs (an order row satisfies it). */
export interface DispatchOrder {
  id: string;
  tenantId: string;
  locationId: string;
  orderNumber: string;
  status: Prisma.OrderGetPayload<object>['status'];
}

type OrderItemWithModifiers = Prisma.OrderItemGetPayload<{ include: { modifiers: true } }>;

function snapshot(item: OrderItemWithModifiers, sortOrder: number) {
  return {
    orderItemId: item.id,
    nameEn: item.nameEn,
    nameAr: item.nameAr,
    variantNameEn: item.variantNameEn,
    variantNameAr: item.variantNameAr,
    quantity: item.quantity,
    notes: item.notes,
    modifiers: item.modifiers.map((m) => ({ nameEn: m.nameEn, nameAr: m.nameAr })),
    sortOrder,
  };
}

/**
 * What the cook sees, so unrelated edits (prices, discounts) do not flag a ticket as changed.
 * Modifiers go through the same normalization as the API output (jsonb reorders object keys).
 */
function signature(
  items: readonly {
    orderItemId: string;
    nameEn: string;
    variantNameEn: string | null;
    quantity: number;
    notes: string | null;
    modifiers: Prisma.JsonValue;
  }[],
) {
  return JSON.stringify(
    items.map((i) => [
      i.orderItemId,
      i.nameEn,
      i.variantNameEn,
      i.quantity,
      i.notes,
      modifiersOf(i.modifiers).map((m) => [m.nameEn, m.nameAr]),
    ]),
  );
}

/**
 * Sends orders to the kitchen: one ticket per station, created when the order is confirmed and
 * kept in step with the order afterwards. Every method runs inside the caller's transaction and
 * returns the realtime events to publish once it commits.
 *
 * Only where the KDS module is on (ADR 0018). Without it nothing new reaches a kitchen: no ticket
 * is created or reopened, and a confirmed order can be completed directly. Tickets made before
 * the module was switched off still follow their order (edits, cancellation, hand-over).
 */
@Injectable()
export class KitchenDispatchService {
  constructor(
    private readonly bus: RealtimeBus,
    private readonly features: FeatureService,
  ) {}

  /** Whether the order's location has a kitchen display (the KDS module). */
  async kitchenOn(
    tx: PrismaTx,
    order: Pick<DispatchOrder, 'tenantId' | 'locationId'>,
  ): Promise<boolean> {
    return this.features.isEnabled(
      Feature.KDS,
      { tenantId: order.tenantId, locationId: order.locationId },
      { db: tx },
    );
  }

  /** Creates, rewrites or cancels tickets so they match the order's current items. */
  async syncTickets(tx: PrismaTx, order: DispatchOrder): Promise<RealtimeEvent[]> {
    const kitchen = await this.kitchenOn(tx, order);
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      include: { modifiers: true },
      orderBy: { sortOrder: 'asc' },
    });
    const routed = routeItems(
      items.map((item) => ({ ...item, stationIds: jsonStringArray(item.stationIds) })),
    );
    const existing = await tx.kitchenTicket.findMany({
      where: { orderId: order.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    const plan = planTickets(existing, routed.keys());
    const itemsFor = (stationId: string) =>
      (routed.get(stationId) ?? []).map((item, index) => snapshot(item, index));
    const events: RealtimeEvent[] = [];

    for (const stationId of kitchen ? plan.create : []) {
      const ticket = await tx.kitchenTicket.create({
        data: {
          tenantId: order.tenantId,
          locationId: order.locationId,
          orderId: order.id,
          stationId,
          items: { create: itemsFor(stationId) },
        },
      });
      events.push(this.ticketEvent('kitchen.ticket_created', ticket, order));
    }

    for (const ticket of plan.refresh) {
      const current = existing.find((t) => t.id === ticket.id);
      if (!current) continue;
      const next = itemsFor(ticket.stationId);
      const reopen = current.status === 'CANCELLED';
      if (reopen && !kitchen) continue;
      const unchanged = signature(current.items) === signature(next);
      if (!reopen && unchanged) continue;
      if (reopen) {
        assertTicketTransition({
          from: 'CANCELLED',
          to: 'NEW',
          trigger: 'SYSTEM',
          orderStatus: order.status,
        });
      }
      await tx.kitchenTicketItem.deleteMany({ where: { ticketId: current.id } });
      const updated = await tx.kitchenTicket.update({
        where: { id: current.id },
        data: {
          ...(reopen ? { status: 'NEW', cancelledAt: null, dismissedAt: null } : {}),
          revision: { increment: 1 },
          version: { increment: 1 },
          items: { create: next },
        },
      });
      events.push(
        this.ticketEvent(
          reopen ? 'kitchen.ticket_created' : 'kitchen.ticket_updated',
          updated,
          order,
        ),
      );
    }

    for (const ticket of plan.cancel) {
      events.push(...(await this.cancel(tx, ticket.id, order)));
    }
    return events;
  }

  /** The order was cancelled: everything still on the screens is cancelled with it. */
  async cancelTickets(tx: PrismaTx, order: DispatchOrder): Promise<RealtimeEvent[]> {
    const live = await tx.kitchenTicket.findMany({
      where: { orderId: order.id, status: { in: [...ACTIVE_TICKET_STATUSES] } },
      select: { id: true },
    });
    const events: RealtimeEvent[] = [];
    for (const ticket of live) events.push(...(await this.cancel(tx, ticket.id, order)));
    return events;
  }

  /** The order was handed over: its ready tickets leave the screens. */
  async completeReadyTickets(tx: PrismaTx, order: DispatchOrder): Promise<RealtimeEvent[]> {
    const ready = await tx.kitchenTicket.findMany({
      where: { orderId: order.id, status: 'READY' },
    });
    const events: RealtimeEvent[] = [];
    for (const ticket of ready) {
      assertTicketTransition({
        from: 'READY',
        to: 'COMPLETED',
        trigger: 'SYSTEM',
        orderStatus: order.status,
      });
      const updated = await tx.kitchenTicket.update({
        where: { id: ticket.id },
        data: { status: 'COMPLETED', completedAt: new Date(), version: { increment: 1 } },
      });
      events.push(this.ticketEvent('kitchen.ticket_completed', updated, order));
    }
    return events;
  }

  /** An order that skips READY (CONFIRMED → COMPLETED) must have nothing left in the kitchen. */
  async assertNothingPending(tx: PrismaTx, orderId: string): Promise<void> {
    const pending = await tx.kitchenTicket.count({
      where: { orderId, status: { in: [...ACTIVE_TICKET_STATUSES] } },
    });
    if (pending > 0) {
      throw new DomainError('INVALID_ORDER_STATE', 'The kitchen has not finished this order', {
        reason: 'KITCHEN_PENDING',
        pendingTickets: pending,
      });
    }
  }

  private async cancel(
    tx: PrismaTx,
    ticketId: string,
    order: DispatchOrder,
  ): Promise<RealtimeEvent[]> {
    const ticket = await tx.kitchenTicket.findUniqueOrThrow({ where: { id: ticketId } });
    assertTicketTransition({
      from: ticket.status,
      to: 'CANCELLED',
      trigger: 'SYSTEM',
      orderStatus: order.status,
    });
    const updated = await tx.kitchenTicket.update({
      where: { id: ticketId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), version: { increment: 1 } },
    });
    return [this.ticketEvent('kitchen.ticket_cancelled', updated, order)];
  }

  private ticketEvent(
    type: TicketEventType,
    ticket: TicketRecord,
    order: DispatchOrder,
  ): RealtimeEvent {
    return this.bus.event(type, order, ticketEventPayload(ticket, order.orderNumber));
  }
}
