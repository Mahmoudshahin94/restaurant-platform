import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  assertEditableByStaff,
  assertPermissions,
  assertTransition,
  assertWebOrderDecision,
  businessDateFor,
  derivePaymentStatus,
  canModifyItems,
  isAwaitingAcceptance,
  isVoidedOnCancel,
  formatOrderNumber,
  paymentTotals,
  quoteOrder,
} from '@pos/domain';
import { OPEN_ORDER_STATUSES, type RealtimeEvent } from '@pos/shared-types';
import type {
  Order,
  createOrderSchema,
  listOrdersQuerySchema,
  transitionOrderSchema,
  updateOrderSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { SERVER_MODE, type ServerMode } from '../../common/auth/managed-in-cloud';
import type { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ChangeRecorder, ticketIdsOf } from '../../prisma/change-recorder';
import { SqlDialect } from '../../prisma/dialect';
import { isUniqueViolation } from '../../prisma/errors';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { KitchenDispatchService } from '../kitchen/kitchen-dispatch.service';
import { PublishedMenuService } from '../menu/published-menu.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import { discountRows, itemSnapshot, taxRows, totalsOf } from './order-snapshot';
import {
  type OrderRow,
  orderEventPayload,
  orderInclude,
  settledEntries,
  toOrderDto,
} from './orders.mappers';

type CreateInput = z.output<typeof createOrderSchema>;
type UpdateInput = z.output<typeof updateOrderSchema>;
type TransitionInput = z.output<typeof transitionOrderSchema>;
type ListQuery = z.output<typeof listOrdersQuerySchema>;

const toItemRequests = (items: CreateInput['items']) =>
  items.map((i) => ({
    lineId: i.id,
    productId: i.productId,
    variantId: i.variantId,
    modifierIds: i.modifierIds,
    quantity: i.quantity,
  }));

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * Order application service. The server is authoritative: prices, taxes and discounts are always
 * recomputed with the shared domain engine from the current menu; client totals are never used.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menus: PublishedMenuService,
    private readonly audit: AuditService,
    private readonly kitchen: KitchenDispatchService,
    private readonly bus: RealtimeBus,
    private readonly dialect: SqlDialect,
    private readonly changes: ChangeRecorder,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {}

  /**
   * Creates an order. The client-generated id is the idempotency key: resending the same request
   * (retry after a timeout, double tap) returns the existing order instead of a duplicate.
   */
  async create(
    principal: Principal,
    locationId: string,
    input: CreateInput,
  ): Promise<{ order: Order; created: boolean }> {
    const existing = await this.prisma.order.findUnique({
      where: { id: input.id },
      include: orderInclude,
    });
    if (existing) return { order: this.replay(existing, locationId), created: false };

    const { location, currencyCode, menu } = await this.menus.resolve(locationId);
    const discounts = await this.loadDiscounts(location.restaurantId, input.discountIds);
    if (discounts.length > 0)
      assertPermissions(principal.assignments, locationId, ['orders.discount']);
    if (input.tableId) await this.requireTable(this.prisma, locationId, input.tableId);

    const quote = quoteOrder({
      menu,
      taxInclusive: location.taxInclusive,
      items: toItemRequests(input.items),
      discounts: discounts.map((d) => ({ id: d.id, type: d.type, value: d.value })),
    });
    const now = new Date();
    const businessDate = businessDateFor(now, location.timezone);
    const source = RequestContext.get()?.source ?? 'POS';

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const sequence = await this.dialect.nextOrderNumber(tx, locationId, businessDate);
        await tx.order.create({
          data: {
            id: input.id,
            restaurantId: location.restaurantId,
            locationId,
            orderNumber: formatOrderNumber(location.code, sequence),
            businessDate: new Date(`${businessDate}T00:00:00Z`),
            channel: input.channel,
            status: input.status,
            source,
            tableId: input.tableId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            guestCount: input.guestCount,
            notes: input.notes,
            currencyCode,
            taxInclusive: location.taxInclusive,
            ...totalsOf(quote),
            createdById: principal.userId,
            placedAt: input.status === 'DRAFT' ? null : now,
          },
        });
        await this.writeLines(tx, input.id, menu, quote, input.items);
        await tx.orderTax.createMany({ data: taxRows(input.id, menu, quote) });
        await tx.orderDiscount.createMany({
          data: discountRows(input.id, discounts, quote, principal.userId),
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: input.id,
            fromStatus: null,
            toStatus: input.status,
            actorType: 'USER',
            actorId: principal.userId,
            source,
          },
        });
        await this.audit.record(
          {
            action: 'order.created',
            entityType: 'Order',
            entityId: input.id,
            locationId,
            metadata: {
              channel: input.channel,
              status: input.status,
              total: quote.pricing.total,
              items: input.items.length,
            },
          },
          tx,
        );
        for (const d of quote.pricing.appliedDiscounts) {
          await this.audit.record(
            {
              action: 'order.discount_applied',
              entityType: 'Order',
              entityId: input.id,
              locationId,
              metadata: { ...d },
            },
            tx,
          );
        }
        // Orders created as CONFIRMED (the POS) go straight to the kitchen.
        const ticketEvents =
          input.status === 'CONFIRMED'
            ? await this.kitchen.syncTickets(tx, {
                id: input.id,
                restaurantId: location.restaurantId,
                locationId,
                orderNumber: formatOrderNumber(location.code, sequence),
                status: input.status,
              })
            : [];
        await this.changes.record(tx, {
          orderIds: [input.id],
          ticketIds: ticketIdsOf(ticketEvents),
        });
        const created = await tx.order.findUniqueOrThrow({
          where: { id: input.id },
          include: orderInclude,
        });
        return { created, ticketEvents };
      });
      this.bus.publish([
        this.bus.event('order.created', row.created, orderEventPayload(row.created)),
        ...row.ticketEvents,
      ]);
      return { order: toOrderDto(row.created), created: true };
    } catch (error) {
      // Two identical requests raced: the loser returns what the winner created.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.order.findUnique({
          where: { id: input.id },
          include: orderInclude,
        });
        if (winner) return { order: this.replay(winner, locationId), created: false };
      }
      throw error;
    }
  }

  async list(locationId: string, query: ListQuery): Promise<Order[]> {
    const statuses = query.open ? [...OPEN_ORDER_STATUSES] : query.status;
    const rows = await this.prisma.order.findMany({
      where: {
        locationId,
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(query.businessDate
          ? { businessDate: new Date(`${query.businessDate}T00:00:00Z`) }
          : {}),
        ...(query.tableId ? { tableId: query.tableId } : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return rows.map(toOrderDto);
  }

  async get(locationId: string, orderId: string): Promise<Order> {
    return toOrderDto(await this.load(this.prisma, locationId, orderId));
  }

  /** Replaces items, discounts and details of an order that the kitchen has not started. */
  async update(
    principal: Principal,
    locationId: string,
    orderId: string,
    input: UpdateInput,
  ): Promise<Order> {
    const current = await this.load(this.prisma, locationId, orderId);
    if (!canModifyItems(current.status)) {
      throw new DomainError('INVALID_ORDER_STATE', 'Order can no longer be changed', {
        status: current.status,
        reason: 'NOT_MODIFIABLE',
      });
    }
    assertEditableByStaff(current);
    this.assertVersion(current, input.version);

    const { location, menu } = await this.menus.resolve(locationId);
    const discounts = await this.loadDiscounts(location.restaurantId, input.discountIds);
    const discountsChanged = !sameSet(
      current.discounts.map((d) => d.discountId),
      input.discountIds,
    );
    if (discountsChanged) assertPermissions(principal.assignments, locationId, ['orders.discount']);
    if (input.tableId) await this.requireTable(this.prisma, locationId, input.tableId);
    const foreignLines = await this.prisma.orderItem.count({
      where: { id: { in: input.items.map((i) => i.id) }, orderId: { not: orderId } },
    });
    if (foreignLines > 0)
      throw new DomainError('CONFLICT', 'Line id belongs to another order', {
        reason: 'LINE_ID_IN_USE',
      });

    // Re-priced with today's menu and the order's own tax mode snapshot.
    const quote = quoteOrder({
      menu,
      taxInclusive: current.taxInclusive,
      items: toItemRequests(input.items),
      discounts: discounts.map((d) => ({ id: d.id, type: d.type, value: d.value })),
    });

    // Money already taken stays covered: an edit may not push the total below it.
    const held = settledEntries(current.payments);
    const { paid, refunded } = paymentTotals(current.total, held);
    if (quote.pricing.total < paid - refunded) {
      throw new DomainError('INVALID_ORDER_STATE', 'The new total is below what was already paid', {
        reason: 'BELOW_PAID',
        held: paid - refunded,
      });
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, version: current.version },
        data: {
          paymentStatus: derivePaymentStatus(quote.pricing.total, held),
          channel: input.channel,
          tableId: input.tableId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          guestCount: input.guestCount,
          notes: input.notes,
          ...totalsOf(quote),
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw this.staleVersion(current.version + 1);

      const keep = new Set(input.items.map((i) => i.id));
      await tx.orderItem.deleteMany({ where: { orderId, id: { notIn: [...keep] } } });
      await tx.orderItemModifier.deleteMany({ where: { orderItemId: { in: [...keep] } } });
      await this.writeLines(
        tx,
        orderId,
        menu,
        quote,
        input.items,
        new Set(current.items.map((i) => i.id)),
      );
      await tx.orderTax.deleteMany({ where: { orderId } });
      await tx.orderTax.createMany({ data: taxRows(orderId, menu, quote) });
      if (discountsChanged || discounts.length > 0) {
        await tx.orderDiscount.deleteMany({ where: { orderId } });
        await tx.orderDiscount.createMany({
          data: discountRows(orderId, discounts, quote, principal.userId),
        });
      }
      await this.audit.record(
        {
          action: 'order.modified',
          entityType: 'Order',
          entityId: orderId,
          locationId,
          metadata: {
            before: {
              total: current.total,
              items: current.items.length,
              discounts: current.discounts.map((d) => d.discountId),
            },
            after: {
              total: quote.pricing.total,
              items: input.items.length,
              discounts: input.discountIds,
            },
          },
        },
        tx,
      );
      // A confirmed order is already in the kitchen: its tickets follow the edit.
      const ticketEvents =
        current.status === 'CONFIRMED' ? await this.kitchen.syncTickets(tx, current) : [];
      await this.changes.record(tx, { orderIds: [orderId], ticketIds: ticketIdsOf(ticketEvents) });
      const updated = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: orderInclude,
      });
      return { updated, ticketEvents };
    });
    this.publishOrder('order.updated', row.updated, row.ticketEvents);
    return toOrderDto(row.updated);
  }

  /** Moves an order through the state machine on behalf of a staff member. */
  async transition(
    principal: Principal,
    locationId: string,
    orderId: string,
    input: TransitionInput,
  ): Promise<Order> {
    const current = await this.load(this.prisma, locationId, orderId);
    if (input.version !== undefined) this.assertVersion(current, input.version);
    const rule = assertTransition({
      from: current.status,
      to: input.to,
      trigger: 'STAFF',
      paymentStatus: current.paymentStatus,
      reason: input.reason,
    });
    if (rule.permission) assertPermissions(principal.assignments, locationId, [rule.permission]);
    assertWebOrderDecision(current, input.to, new Date());
    if (this.mode === 'cloud' && isAwaitingAcceptance(current)) {
      // The restaurant accepts or rejects at its hub, where the kitchen is; the cloud's only
      // decision is the acceptance timeout, which also voids the payment (ADR 0013).
      throw new DomainError('INVALID_ORDER_STATE', 'Website orders are decided at the restaurant', {
        reason: 'DECIDED_AT_RESTAURANT',
      });
    }
    if (input.to === 'CANCELLED') {
      // Online payments of a website order not yet accepted are voided by the cloud (ADR 0013).
      const held = current.payments.filter((p) => !isVoidedOnCancel(current, p));
      const { paid, refunded } = paymentTotals(current.total, settledEntries(held));
      if (paid - refunded > 0) {
        throw new DomainError('INVALID_ORDER_STATE', 'Refund the payments before cancelling', {
          reason: 'REFUND_FIRST',
          held: paid - refunded,
        });
      }
    }

    const source = RequestContext.get()?.source ?? 'POS';
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, version: current.version, status: current.status },
        data: {
          status: input.to,
          version: { increment: 1 },
          ...(input.to === 'PLACED' ? { placedAt: now } : {}),
          ...(input.to === 'COMPLETED' ? { completedAt: now } : {}),
          ...(input.to === 'CANCELLED' ? { cancelledAt: now, cancelReason: input.reason } : {}),
        },
      });
      if (claimed.count !== 1) throw this.staleVersion(current.version + 1);
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: current.status,
          toStatus: input.to,
          actorType: 'USER',
          actorId: principal.userId,
          source,
          reason: input.reason,
        },
      });
      await this.audit.record(
        {
          action: input.to === 'CANCELLED' ? 'order.cancelled' : 'order.status_changed',
          entityType: 'Order',
          entityId: orderId,
          locationId,
          metadata: {
            from: current.status,
            to: input.to,
            reason: input.reason,
            total: current.total,
          },
        },
        tx,
      );
      const ticketEvents = await this.followKitchen(tx, current, input.to);
      await this.changes.record(tx, { orderIds: [orderId], ticketIds: ticketIdsOf(ticketEvents) });
      const updated = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: orderInclude,
      });
      return { updated, ticketEvents };
    });
    this.publishOrder(
      input.to === 'CANCELLED' ? 'order.cancelled' : 'order.updated',
      row.updated,
      row.ticketEvents,
    );
    return toOrderDto(row.updated);
  }

  // --- helpers ---------------------------------------------------------------------------------

  /** Kitchen side effects of a staff transition (runs inside the transition's transaction). */
  private async followKitchen(
    tx: PrismaTx,
    current: OrderRow,
    to: TransitionInput['to'],
  ): Promise<RealtimeEvent[]> {
    const order = { ...current, status: to };
    if (to === 'CONFIRMED') return this.kitchen.syncTickets(tx, order);
    if (to === 'CANCELLED') return this.kitchen.cancelTickets(tx, order);
    if (to === 'COMPLETED') {
      if (current.status === 'CONFIRMED') await this.kitchen.assertNothingPending(tx, current.id);
      return this.kitchen.completeReadyTickets(tx, order);
    }
    return [];
  }

  private publishOrder(
    type: 'order.updated' | 'order.cancelled',
    row: OrderRow,
    ticketEvents: readonly RealtimeEvent[],
  ): void {
    const payload = orderEventPayload(row);
    this.bus.publish([
      type === 'order.cancelled'
        ? this.bus.event(type, row, { ...payload, reason: row.cancelReason })
        : this.bus.event(type, row, payload),
      ...ticketEvents,
    ]);
  }

  // --- persistence helpers ------------------------------------------------------------------

  private replay(existing: OrderRow, locationId: string): Order {
    if (existing.locationId !== locationId) {
      throw new DomainError('CONFLICT', 'Order id already used elsewhere', { reason: 'ID_IN_USE' });
    }
    return toOrderDto(existing);
  }

  private async writeLines(
    tx: PrismaTx,
    orderId: string,
    menu: Parameters<typeof itemSnapshot>[0],
    quote: ReturnType<typeof quoteOrder>,
    items: CreateInput['items'],
    existingIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    for (const [index, line] of quote.lines.entries()) {
      const input = items[index];
      if (!input) continue;
      const { item, modifiers } = itemSnapshot(menu, line, input, index);
      if (existingIds.has(item.id)) {
        const { id, ...data } = item;
        await tx.orderItem.update({ where: { id }, data });
      } else {
        await tx.orderItem.create({ data: { ...item, orderId } });
      }
      if (modifiers.length > 0) {
        await tx.orderItemModifier.createMany({
          data: modifiers.map((m) => ({ ...m, orderItemId: item.id })),
        });
      }
    }
  }

  private async loadDiscounts(restaurantId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.discount.findMany({
      where: { id: { in: [...ids] }, restaurantId, archivedAt: null },
    });
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length > 0)
      throw new DomainError('DISCOUNT_NOT_FOUND', 'Discount not found', { discountIds: missing });
    // Apply in the order the client listed them (the engine applies discounts sequentially).
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r !== undefined);
  }

  private async requireTable(tx: PrismaTx, locationId: string, tableId: string): Promise<void> {
    const found = await tx.diningTable.count({
      where: { id: tableId, locationId, archivedAt: null },
    });
    if (found !== 1) throw new DomainError('TABLE_NOT_FOUND', 'Table not found', { tableId });
  }

  private async load(tx: PrismaTx, locationId: string, orderId: string): Promise<OrderRow> {
    const row = await tx.order.findFirst({
      where: { id: orderId, locationId },
      include: orderInclude,
    });
    if (!row) throw new DomainError('ORDER_NOT_FOUND', 'Order not found', { orderId });
    return row;
  }

  private assertVersion(current: OrderRow, version: number): void {
    if (current.version !== version) throw this.staleVersion(current.version);
  }

  private staleVersion(currentVersion: number): DomainError {
    return new DomainError('CONFLICT', 'Order was changed by someone else', {
      reason: 'STALE_VERSION',
      currentVersion,
    });
  }
}
