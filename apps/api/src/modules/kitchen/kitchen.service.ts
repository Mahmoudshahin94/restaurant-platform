import { Injectable } from '@nestjs/common';
import {
  DomainError,
  assertTicketTransition,
  assertTransition,
  deriveOrderStatus,
} from '@pos/domain';
import { ACTIVE_TICKET_STATUSES, type RealtimeEvent } from '@pos/shared-types';
import type {
  KitchenSettings,
  KitchenTicket,
  dismissTicketSchema,
  listTicketsQuerySchema,
  orderKitchenPrioritySchema,
  ticketItemDoneSchema,
  ticketPriorityRequestSchema,
  transitionTicketSchema,
} from '@pos/validation';
import type { z } from 'zod';
import type { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { lockOrderRow } from '../orders/order-lock';
import { orderEventPayload } from '../orders/orders.mappers';
import { RealtimeBus } from '../realtime/realtime.bus';
import {
  type TicketEventType,
  type TicketRow,
  ticketEventPayload,
  ticketInclude,
  toTicketDto,
} from './kitchen.mappers';

type ListQuery = z.output<typeof listTicketsQuerySchema>;
type TransitionInput = z.output<typeof transitionTicketSchema>;
type PriorityInput = z.output<typeof ticketPriorityRequestSchema>;

/** Cancelled tickets and recently bumped ones stay retrievable for this long. */
const SCREEN_HISTORY_MS = 12 * 60 * 60 * 1000;

const EVENT_FOR: Record<'PREPARING' | 'READY' | 'COMPLETED', TicketEventType> = {
  PREPARING: 'kitchen.ticket_started',
  READY: 'kitchen.ticket_ready',
  COMPLETED: 'kitchen.ticket_completed',
};

/**
 * Kitchen screen operations. Every ticket change locks the order row first, so two stations
 * finishing at the same moment still move the order to READY exactly once.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: RealtimeBus,
  ) {}

  async settings(locationId: string): Promise<KitchenSettings> {
    const location = await this.prisma.location.findUniqueOrThrow({ where: { id: locationId } });
    const stations = await this.prisma.kitchenStation.findMany({
      where: { restaurantId: location.restaurantId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return {
      locationId,
      warnMinutes: location.kdsWarnMinutes,
      lateMinutes: location.kdsLateMinutes,
      stations: stations.map((s) => ({
        id: s.id,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        sortOrder: s.sortOrder,
      })),
    };
  }

  async list(locationId: string, query: ListQuery): Promise<KitchenTicket[]> {
    const since = new Date(Date.now() - SCREEN_HISTORY_MS);
    const stationFilter = query.stationIds ? { stationId: { in: query.stationIds } } : {};
    const rows =
      query.view === 'active'
        ? await this.prisma.kitchenTicket.findMany({
            where: {
              locationId,
              ...stationFilter,
              OR: [
                { status: { in: [...ACTIVE_TICKET_STATUSES] } },
                // Cancellations stay on screen until the kitchen acknowledges them.
                { status: 'CANCELLED', dismissedAt: null, cancelledAt: { gte: since } },
              ],
            },
            include: ticketInclude,
            // Postgres orders enums by declaration: RUSH sorts after NORMAL.
            orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
            take: query.limit,
          })
        : await this.prisma.kitchenTicket.findMany({
            where: {
              locationId,
              ...stationFilter,
              status: 'COMPLETED',
              completedAt: { gte: since },
            },
            include: ticketInclude,
            orderBy: { completedAt: 'desc' },
            take: query.limit,
          });
    return rows.map(toTicketDto);
  }

  async get(locationId: string, ticketId: string): Promise<KitchenTicket> {
    return toTicketDto(await this.load(this.prisma, locationId, ticketId));
  }

  /** Start, ready, bump, undo-ready and recall. The order status follows its tickets. */
  async transition(
    principal: Principal,
    locationId: string,
    ticketId: string,
    input: TransitionInput,
  ): Promise<KitchenTicket> {
    const { ticket, events } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, locationId, ticketId, input.version);
      assertTicketTransition({
        from: current.status,
        to: input.to,
        trigger: 'STAFF',
        orderStatus: current.order.status,
      });
      const now = new Date();
      const recall = current.status === 'COMPLETED' && input.to === 'READY';
      const unready = current.status === 'READY' && input.to === 'PREPARING';
      await tx.kitchenTicket.update({
        where: { id: ticketId },
        data: {
          status: input.to,
          version: { increment: 1 },
          ...(input.to === 'PREPARING' && !unready ? { startedAt: now } : {}),
          ...(input.to === 'READY' && !recall
            ? { readyAt: now, startedAt: current.startedAt ?? now }
            : {}),
          ...(unready ? { readyAt: null } : {}),
          ...(input.to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(recall ? { completedAt: null } : {}),
        },
      });
      const derived = await this.followTickets(tx, principal, current);
      if (recall) {
        await this.audit.record(
          {
            action: 'kitchen.ticket_recalled',
            entityType: 'KitchenTicket',
            entityId: ticketId,
            locationId,
            metadata: { orderId: current.orderId, stationId: current.stationId },
          },
          tx,
        );
      }
      const updated = await this.load(tx, locationId, ticketId);
      const type = recall || unready ? 'kitchen.ticket_updated' : EVENT_FOR[input.to];
      return {
        ticket: updated,
        events: [this.ticketEvent(type, updated), ...derived],
      };
    });
    this.bus.publish(events);
    return toTicketDto(ticket);
  }

  async setPriority(
    locationId: string,
    ticketId: string,
    input: PriorityInput,
  ): Promise<KitchenTicket> {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, locationId, ticketId, input.version);
      this.assertLive(current);
      if (current.priority === input.priority) return current;
      await tx.kitchenTicket.update({
        where: { id: ticketId },
        data: { priority: input.priority, version: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: 'kitchen.priority_changed',
          entityType: 'KitchenTicket',
          entityId: ticketId,
          locationId,
          metadata: { orderId: current.orderId, from: current.priority, to: input.priority },
        },
        tx,
      );
      return this.load(tx, locationId, ticketId);
    });
    this.bus.publish([this.ticketEvent('kitchen.ticket_updated', ticket)]);
    return toTicketDto(ticket);
  }

  /** Strike (or un-strike) one line on a ticket. Last write wins; no version needed. */
  async setItemDone(
    locationId: string,
    ticketId: string,
    itemId: string,
    input: z.output<typeof ticketItemDoneSchema>,
  ): Promise<KitchenTicket> {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, locationId, ticketId);
      this.assertLive(current);
      const changed = await tx.kitchenTicketItem.updateMany({
        where: { id: itemId, ticketId },
        data: { doneAt: input.done ? new Date() : null },
      });
      if (changed.count !== 1) {
        throw new DomainError('KITCHEN_TICKET_NOT_FOUND', 'Ticket item not found', { itemId });
      }
      await tx.kitchenTicket.update({
        where: { id: ticketId },
        data: { version: { increment: 1 } },
      });
      return this.load(tx, locationId, ticketId);
    });
    this.bus.publish([this.ticketEvent('kitchen.ticket_updated', ticket)]);
    return toTicketDto(ticket);
  }

  /** The kitchen saw the cancellation; the ticket leaves the screen. */
  async dismiss(
    locationId: string,
    ticketId: string,
    input: z.output<typeof dismissTicketSchema>,
  ): Promise<KitchenTicket> {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, locationId, ticketId, input.version);
      if (current.status !== 'CANCELLED') {
        throw new DomainError('INVALID_TICKET_STATE', 'Only cancelled tickets are dismissed', {
          reason: 'NOT_CANCELLED',
          status: current.status,
        });
      }
      if (current.dismissedAt) return current;
      await tx.kitchenTicket.update({
        where: { id: ticketId },
        data: { dismissedAt: new Date(), version: { increment: 1 } },
      });
      return this.load(tx, locationId, ticketId);
    });
    this.bus.publish([this.ticketEvent('kitchen.ticket_updated', ticket)]);
    return toTicketDto(ticket);
  }

  /** POS: rush (or un-rush) every live ticket of an order. */
  async setOrderPriority(
    locationId: string,
    orderId: string,
    input: z.output<typeof orderKitchenPrioritySchema>,
  ): Promise<KitchenTicket[]> {
    const tickets = await this.prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, locationId, orderId);
      const changed = await tx.kitchenTicket.updateMany({
        where: {
          orderId,
          status: { in: [...ACTIVE_TICKET_STATUSES] },
          priority: { not: input.priority },
        },
        data: { priority: input.priority, version: { increment: 1 } },
      });
      if (changed.count > 0) {
        await this.audit.record(
          {
            action: 'kitchen.priority_changed',
            entityType: 'Order',
            entityId: orderId,
            locationId,
            metadata: { to: input.priority, tickets: changed.count },
          },
          tx,
        );
      }
      return tx.kitchenTicket.findMany({
        where: { orderId },
        include: ticketInclude,
        orderBy: { createdAt: 'asc' },
      });
    });
    this.bus.publish(
      tickets
        .filter((t) => (ACTIVE_TICKET_STATUSES as readonly string[]).includes(t.status))
        .map((t) => this.ticketEvent('kitchen.ticket_updated', t)),
    );
    return tickets.map(toTicketDto);
  }

  // --- helpers -------------------------------------------------------------------------------

  /**
   * Applies the order transitions implied by the order's tickets (CONFIRMED → PREPARING → READY,
   * or READY → PREPARING) as system transitions, with history and audit.
   */
  private async followTickets(
    tx: PrismaTx,
    principal: Principal,
    ticket: TicketRow,
  ): Promise<RealtimeEvent[]> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: ticket.orderId } });
    const statuses = await tx.kitchenTicket.findMany({
      where: { orderId: order.id },
      select: { status: true },
    });
    const path = deriveOrderStatus(
      order.status,
      statuses.map((s) => s.status),
    );
    if (path.length === 0) return [];

    const source = RequestContext.get()?.source ?? 'KDS';
    let from = order.status;
    for (const to of path) {
      assertTransition({ from, to, trigger: 'SYSTEM', paymentStatus: order.paymentStatus });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: from,
          toStatus: to,
          actorType: 'USER',
          actorId: principal.userId,
          source,
        },
      });
      from = to;
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: from, version: { increment: 1 } },
    });
    await this.audit.record(
      {
        action: 'order.status_changed',
        entityType: 'Order',
        entityId: order.id,
        locationId: order.locationId,
        metadata: { from: order.status, to: from, trigger: 'KITCHEN' },
      },
      tx,
    );
    return [this.bus.event('order.updated', updated, orderEventPayload(updated))];
  }

  private async lockAndLoad(
    tx: PrismaTx,
    locationId: string,
    ticketId: string,
    version: number,
  ): Promise<TicketRow> {
    const found = await tx.kitchenTicket.findFirst({
      where: { id: ticketId, locationId },
      select: { orderId: true },
    });
    if (!found) throw this.notFound(ticketId);
    await lockOrderRow(tx, locationId, found.orderId);
    const current = await this.load(tx, locationId, ticketId);
    if (current.version !== version) {
      throw new DomainError('CONFLICT', 'Ticket was changed on another screen', {
        reason: 'STALE_VERSION',
        currentVersion: current.version,
      });
    }
    return current;
  }

  private async load(tx: PrismaTx, locationId: string, ticketId: string): Promise<TicketRow> {
    const row = await tx.kitchenTicket.findFirst({
      where: { id: ticketId, locationId },
      include: ticketInclude,
    });
    if (!row) throw this.notFound(ticketId);
    return row;
  }

  private assertLive(ticket: TicketRow): void {
    if (!(ACTIVE_TICKET_STATUSES as readonly string[]).includes(ticket.status)) {
      throw new DomainError('INVALID_TICKET_STATE', 'Ticket is no longer on the screen', {
        reason: 'NOT_ACTIVE',
        status: ticket.status,
      });
    }
  }

  private notFound(ticketId: string): DomainError {
    return new DomainError('KITCHEN_TICKET_NOT_FOUND', 'Kitchen ticket not found', { ticketId });
  }

  private ticketEvent(type: TicketEventType, ticket: TicketRow): RealtimeEvent {
    return this.bus.event(type, ticket, ticketEventPayload(ticket, ticket.order.orderNumber));
  }
}
