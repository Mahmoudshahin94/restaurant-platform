import { Injectable } from '@nestjs/common';
import { Prisma } from '@pos/database/hub-client';
import { derivePaymentStatus } from '@pos/domain';
import {
  ChangeRecorder,
  KitchenDispatchService,
  PrismaService,
  RealtimeBus,
  ticketIdsOf,
} from '@pos/server';
import type { RealtimeEvent } from '@pos/shared-types';
import type { SyncOrder } from '@pos/validation';
import { type HubTx, asHubTx } from '../database/hub-database';

export type InboundOutcome = 'created' | 'updated' | 'cancelled-in-cloud' | 'payments' | 'kept';

const date = (value: string) => new Date(value);
const dateOrNull = (value: string | null) => (value === null ? null : new Date(value));
const json = (value: Record<string, unknown> | null) =>
  value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

/**
 * Stores website orders the cloud announced on its change feed (ADR 0013).
 *
 * The cloud owns a website order until the restaurant accepts or rejects it. While the hub has not
 * changed the order, the cloud's copy simply replaces the hub's. Once the restaurant decided here,
 * the hub's push hands the order over; if the cloud decided first (it cancelled the order at the
 * acceptance deadline), the cloud's decision stands: the hub takes the cloud's copy, cancels the
 * kitchen tickets it opened and marks its own unsent change superseded. After the hand-over the
 * hub owns the order, and only the cloud's online payment rows (a void) are merged in.
 */
@Injectable()
export class InboundOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenDispatchService,
    private readonly changes: ChangeRecorder,
    private readonly bus: RealtimeBus,
  ) {}

  async ingest(order: SyncOrder): Promise<InboundOutcome> {
    const { outcome, events } = await this.prisma.$transaction(async (raw) => {
      const tx = asHubTx(raw);
      const local = await tx.order.findUnique({ where: { id: order.id }, select: { id: true } });
      const ops = await tx.syncOperation.findMany({
        where: { entityType: 'Order', entityId: order.id },
        select: { id: true, status: true },
      });
      const unsent = ops.filter((o) => o.status !== 'COMPLETED');
      const handedOver = ops.some((o) => o.status === 'COMPLETED');

      if (!local || ops.length === 0) {
        await this.store(tx, order, local !== null);
        await this.remember(tx, order);
        const type = !local
          ? 'order.created'
          : order.status === 'CANCELLED'
            ? 'order.cancelled'
            : 'order.updated';
        return {
          outcome: local ? ('updated' as const) : ('created' as const),
          events: [this.event(type, order)],
        };
      }
      if (!handedOver && unsent.length > 0 && order.status !== 'PLACED') {
        // The cloud decided before the restaurant's decision reached it: the cloud's stands.
        await this.store(tx, order, true);
        await this.remember(tx, order);
        // The cloud can only cancel an order it still owns (acceptance happens at the hub).
        const ticketEvents =
          order.status === 'CANCELLED' ? await this.kitchen.cancelTickets(raw, order) : [];
        await this.changes.record(raw, { ticketIds: ticketIdsOf(ticketEvents) });
        await tx.syncOperation.updateMany({
          where: { id: { in: unsent.map((o) => o.id) } },
          data: {
            status: 'COMPLETED',
            processedAt: new Date(),
            nextRetryAt: null,
            errorCode: 'SYNC_SUPERSEDED',
            errorMessage: `The cloud ${order.status.toLowerCase()} the order first`,
          },
        });
        return {
          outcome: 'cancelled-in-cloud' as const,
          events: [
            this.event(order.status === 'CANCELLED' ? 'order.cancelled' : 'order.updated', order),
            ...ticketEvents,
          ],
        };
      }
      if (handedOver && (await this.mergePayments(tx, order))) {
        return { outcome: 'payments' as const, events: [this.event('order.updated', order)] };
      }
      return { outcome: 'kept' as const, events: [] };
    });
    this.bus.publish(events);
    return outcome;
  }

  /** The cloud version the hub holds, sent as `baseVersion` with its first change (hand-over). */
  private async remember(tx: HubTx, order: SyncOrder): Promise<void> {
    await tx.inboundOrder.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, cloudVersion: order.version },
      update: { cloudVersion: order.version, receivedAt: new Date() },
    });
  }

  private event(
    type: 'order.created' | 'order.updated' | 'order.cancelled',
    o: SyncOrder,
  ): RealtimeEvent {
    const scope = { restaurantId: o.restaurantId, locationId: o.locationId };
    const payload = {
      orderId: o.id,
      orderNumber: o.orderNumber,
      channel: o.channel,
      status: o.status,
      paymentStatus: o.paymentStatus,
      version: o.version,
    };
    return type === 'order.cancelled'
      ? this.bus.event(type, scope, { ...payload, reason: o.cancelReason })
      : this.bus.event(type, scope, payload);
  }

  /** Writes the cloud's state of the order (scalars, lines, taxes, history, payments). */
  private async store(tx: HubTx, o: SyncOrder, exists: boolean): Promise<void> {
    const { items, taxes, discounts, statusHistory, payments, ...scalars } = o;
    const data = {
      ...scalars,
      businessDate: date(o.businessDate),
      deliveryAddress: json(o.deliveryAddress),
      placedAt: dateOrNull(o.placedAt),
      acceptBy: dateOrNull(o.acceptBy),
      completedAt: dateOrNull(o.completedAt),
      cancelledAt: dateOrNull(o.cancelledAt),
      createdAt: date(o.createdAt),
      updatedAt: date(o.updatedAt),
    };
    if (exists) await tx.order.update({ where: { id: o.id }, data });
    else await tx.order.create({ data });

    const itemIds = items.map((i) => i.id);
    await tx.orderItemModifier.deleteMany({ where: { orderItemId: { in: itemIds } } });
    await tx.orderItem.deleteMany({ where: { orderId: o.id, id: { notIn: itemIds } } });
    for (const { modifiers, ...item } of items) {
      const row = { ...item, createdAt: date(item.createdAt), updatedAt: date(item.updatedAt) };
      await tx.orderItem.upsert({ where: { id: item.id }, create: row, update: row });
      if (modifiers.length > 0) await tx.orderItemModifier.createMany({ data: modifiers });
    }
    await tx.orderTax.deleteMany({ where: { orderId: o.id } });
    if (taxes.length > 0) await tx.orderTax.createMany({ data: taxes });
    await tx.orderDiscount.deleteMany({ where: { orderId: o.id } });
    if (discounts.length > 0) {
      await tx.orderDiscount.createMany({
        data: discounts.map((d) => ({ ...d, createdAt: date(d.createdAt) })),
      });
    }
    const known = new Set(
      (
        await tx.orderStatusHistory.findMany({ where: { orderId: o.id }, select: { id: true } })
      ).map((h) => h.id),
    );
    const history = statusHistory.filter((h) => !known.has(h.id));
    if (history.length > 0) {
      await tx.orderStatusHistory.createMany({
        data: history.map((h) => ({ ...h, createdAt: date(h.createdAt) })),
      });
    }
    await this.insertPayments(tx, payments);
  }

  /** Append-only: payments (and their cash movements) the hub does not have yet. */
  private async insertPayments(tx: HubTx, payments: SyncOrder['payments']): Promise<number> {
    const known = new Set(
      (
        await tx.payment.findMany({
          where: { id: { in: payments.map((p) => p.id) } },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    // Charges before the refunds that reference them.
    const missing = payments
      .filter((p) => !known.has(p.id))
      .sort((a, b) => Number(a.refundOfId !== null) - Number(b.refundOfId !== null));
    for (const { cash, ...payment } of missing) {
      await tx.payment.create({
        data: {
          ...payment,
          createdAt: date(payment.createdAt),
          updatedAt: date(payment.updatedAt),
        },
      });
      for (const c of cash)
        await tx.cashTransaction.create({ data: { ...c, createdAt: date(c.createdAt) } });
    }
    return missing.length;
  }

  /**
   * After the hand-over the hub owns the order; the cloud still settles its online payments (a
   * void after a rejection). Those rows are merged and the payment status re-derived; the order
   * itself is not edited and nothing goes back to the outbox.
   */
  private async mergePayments(tx: HubTx, o: SyncOrder): Promise<boolean> {
    const online = o.payments.filter((p) => p.methodType === 'ONLINE');
    if ((await this.insertPayments(tx, online)) === 0) return false;
    const rows = await tx.payment.findMany({ where: { orderId: o.id, status: 'CAPTURED' } });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: o.id },
      select: { total: true },
    });
    await tx.order.update({
      where: { id: o.id },
      data: {
        paymentStatus: derivePaymentStatus(
          order.total,
          rows.map((p) => ({ id: p.id, type: p.type, amount: p.amount, refundOfId: p.refundOfId })),
        ),
      },
    });
    return true;
  }
}
