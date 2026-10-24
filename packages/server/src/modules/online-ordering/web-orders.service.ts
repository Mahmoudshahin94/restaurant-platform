import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  DomainError,
  acceptanceDeadline,
  assertOnlineOrderingOpen,
  assertTransition,
  assertWebOrderOptions,
  businessDateFor,
  formatOrderNumber,
  newId,
  quoteOrder,
  webOrderFees,
} from '@pos/domain';
import { WEB_ACCEPTANCE_TIMEOUT_REASON } from '@pos/shared-types';
import type { WebOrderCreated, createWebOrderSchema } from '@pos/validation';
import type { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ChangeRecorder } from '../../prisma/change-recorder';
import { isUniqueViolation } from '../../prisma/errors';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PublishedMenuService } from '../menu/published-menu.service';
import { itemSnapshot, taxRows, totalsOf } from '../orders/order-snapshot';
import { orderEventPayload } from '../orders/orders.mappers';
import { RealtimeBus } from '../realtime/realtime.bus';
import { OnlinePaymentsService } from './online-payments.service';
import { OnlineStatusService } from './online-status.service';
import { TrackingTokens, trackingSecret } from './tracking-token';
import { type PublicOrderRow, publicOrderInclude, toPublicOrder } from './web-order.mappers';

type CreateInput = z.output<typeof createWebOrderSchema>;

/**
 * An acceptance the hub made just before the deadline may reach the cloud a little later; the
 * sweep waits this long past the deadline so it does not cancel an order that was accepted in time.
 */
export const ACCEPT_GRACE_MS = 30_000;

/** The website's order-number prefix (ADR 0003): never collides with hub numbers. */
const WEB_PREFIX = 'W';

/**
 * Website orders (ADR 0013). The cloud creates them as PLACED on channel WEBSITE, re-pricing
 * everything with the shared domain engine (browser totals are never read), takes online card
 * payments through the payment provider, and cancels orders the tenant does not accept in
 * time. Every change is reported to the change feed (`ORDER` topic) so the hub receives it.
 */
@Injectable()
export class WebOrdersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebOrdersService.name);
  private readonly tokens: TrackingTokens;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly menus: PublishedMenuService,
    private readonly status: OnlineStatusService,
    private readonly payments: OnlinePaymentsService,
    private readonly audit: AuditService,
    private readonly bus: RealtimeBus,
    private readonly changes: ChangeRecorder,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.tokens = new TrackingTokens(trackingSecret(config));
  }

  onApplicationBootstrap(): void {
    const seconds = this.config.WEB_ORDER_TIMEOUT_SWEEP_SECONDS;
    if (seconds === 0) return;
    this.sweepTimer = setInterval(() => void this.cancelExpired(), seconds * 1000);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // --- Create ------------------------------------------------------------------------------------

  /**
   * Places a website order. The client-generated id makes it idempotent: a resend with the same
   * id and phone returns the same order (and tracking token) instead of a duplicate.
   */
  async create(input: CreateInput): Promise<{ result: WebOrderCreated; created: boolean }> {
    const existing = await this.findForReplay(input);
    if (existing) return { result: this.created(existing), created: false };

    const { location, currencyCode, menu } = await this.menus.resolve(input.locationId);
    const now = new Date();
    assertOnlineOrderingOpen(await this.status.statusOf(location, now));
    assertWebOrderOptions(
      {
        pickupEnabled: location.onlinePickupEnabled,
        deliveryEnabled: location.onlineDeliveryEnabled,
      },
      input.fulfillment,
      input.payment.option,
    );

    // Authoritative prices: today's menu at this location, its tax mode, the delivery fee.
    const quote = quoteOrder({
      menu,
      taxInclusive: location.taxInclusive,
      items: input.items.map((i) => ({
        lineId: i.id,
        productId: i.productId,
        variantId: i.variantId,
        modifierIds: i.modifierIds,
        quantity: i.quantity,
      })),
      fees: webOrderFees(input.fulfillment, location.onlineDeliveryFee),
    });
    const total = quote.pricing.total;
    const charge =
      input.payment.option === 'ONLINE_CARD'
        ? await this.charge(input, location.tenantId, currencyCode, total)
        : null;

    const businessDate = businessDateFor(now, location.timezone);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const sequence = await this.nextWebNumber(tx, location.id, businessDate);
        await tx.order.create({
          data: {
            id: input.id,
            tenantId: location.tenantId,
            locationId: location.id,
            orderNumber: formatOrderNumber(WEB_PREFIX, sequence),
            businessDate: new Date(`${businessDate}T00:00:00Z`),
            channel: 'WEBSITE',
            status: 'PLACED',
            paymentStatus: charge ? 'PAID' : 'UNPAID',
            source: 'WEBSITE',
            customerName: input.customer.name,
            customerPhone: input.customer.phone,
            customerEmail: input.customer.email,
            fulfillmentType: input.fulfillment,
            deliveryAddress: input.deliveryAddress ?? undefined,
            notes: input.notes,
            currencyCode,
            taxInclusive: location.taxInclusive,
            ...totalsOf(quote),
            placedAt: now,
            acceptBy: acceptanceDeadline(now, location.onlineAcceptMinutes),
          },
        });
        for (const [index, line] of quote.lines.entries()) {
          const item = input.items[index];
          if (!item) continue;
          const snapshot = itemSnapshot(menu, line, item, index);
          await tx.orderItem.create({ data: { ...snapshot.item, orderId: input.id } });
          if (snapshot.modifiers.length > 0) {
            await tx.orderItemModifier.createMany({
              data: snapshot.modifiers.map((m) => ({ ...m, orderItemId: snapshot.item.id })),
            });
          }
        }
        await tx.orderTax.createMany({ data: taxRows(input.id, menu, quote) });
        await tx.orderStatusHistory.create({
          data: {
            orderId: input.id,
            fromStatus: null,
            toStatus: 'PLACED',
            actorType: 'CUSTOMER',
            source: 'WEBSITE',
          },
        });
        if (charge) {
          await tx.payment.create({
            data: {
              id: charge.paymentId,
              tenantId: location.tenantId,
              locationId: location.id,
              orderId: input.id,
              shiftId: null,
              paymentMethodId: charge.method.id,
              methodType: 'ONLINE',
              methodNameEn: charge.method.nameEn,
              methodNameAr: charge.method.nameAr,
              type: 'CHARGE',
              status: 'CAPTURED',
              provider: this.payments.provider.name,
              providerRef: charge.providerRef,
              amount: total,
            },
          });
        }
        await this.audit.record(
          {
            action: 'order.created',
            entityType: 'Order',
            entityId: input.id,
            actorType: 'CUSTOMER',
            actorId: null,
            tenantId: location.tenantId,
            locationId: location.id,
            metadata: {
              channel: 'WEBSITE',
              fulfillment: input.fulfillment,
              payment: input.payment.option,
              total,
              items: input.items.length,
            },
          },
          tx,
        );
        await this.changes.record(tx, { orderIds: [input.id] });
        return tx.order.findUniqueOrThrow({ where: { id: input.id }, include: publicOrderInclude });
      });
      this.bus.publish([this.bus.event('order.created', row, orderEventPayload(row))]);
      return { result: this.created(row), created: true };
    } catch (error) {
      if (charge) await this.payments.provider.cancelPayment(charge.providerRef).catch(() => null);
      if (isUniqueViolation(error)) {
        // Two identical requests raced: the loser returns what the winner created.
        const winner = await this.findForReplay(input);
        if (winner) return { result: this.created(winner), created: false };
      }
      throw error;
    }
  }

  private async charge(input: CreateInput, tenantId: string, currency: string, amount: number) {
    const method = await this.payments.methodFor(this.prisma, tenantId);
    if (!method) {
      throw new DomainError('PAYMENT_FAILED', 'Online card payment is not available', {
        reason: 'PROVIDER_NOT_CONFIGURED',
      });
    }
    const paymentId = newId();
    const result = await this.payments.provider.createPayment({
      paymentId,
      orderId: input.id,
      amount,
      currency,
      // The gateway token, handed to the provider only; it is never stored.
      reference: input.payment.cardToken,
    });
    if (result.status !== 'CAPTURED' || !result.providerRef) {
      throw new DomainError('PAYMENT_FAILED', 'The card was declined', { reason: 'CARD_DECLINED' });
    }
    return { paymentId, method, providerRef: result.providerRef };
  }

  private async findForReplay(input: CreateInput): Promise<PublicOrderRow | null> {
    const existing = await this.prisma.order.findUnique({
      where: { id: input.id },
      include: publicOrderInclude,
    });
    if (!existing) return null;
    // Only the same customer's resend gets the order (and its token) back.
    if (
      existing.channel !== 'WEBSITE' ||
      existing.locationId !== input.locationId ||
      existing.customerPhone !== input.customer.phone
    ) {
      throw new DomainError('CONFLICT', 'Order id already used', { reason: 'ID_IN_USE' });
    }
    return existing;
  }

  private created(row: PublicOrderRow): WebOrderCreated {
    return { order: toPublicOrder(row), trackingToken: this.tokens.issue(row.id) };
  }

  /** `W-001`, `W-002`, … per location and business day (cloud-only counter). */
  private async nextWebNumber(tx: PrismaTx, locationId: string, businessDate: string) {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO web_order_counters (location_id, business_date, last_number)
      VALUES (${locationId}::uuid, ${businessDate}::date, 1)
      ON CONFLICT (location_id, business_date)
      DO UPDATE SET last_number = web_order_counters.last_number + 1
      RETURNING last_number`;
    const value = rows[0]?.last_number;
    if (value === undefined) throw new DomainError('INTERNAL_ERROR', 'No web order number');
    return value;
  }

  // --- Track -------------------------------------------------------------------------------------

  /**
   * The order a tracking token opens, on its tenant's website (ADR 0023): the request is scoped to
   * the host's tenant, so another tenant's order, like an invalid token, is not found. Its
   * location's modules are checked with `assertModules`.
   */
  async track(token: string | undefined, assertModules: (locationId: string) => Promise<void>) {
    const orderId = token ? this.tokens.verify(token.trim()) : null;
    const row = orderId
      ? await this.prisma.order.findUnique({ where: { id: orderId }, include: publicOrderInclude })
      : null;
    if (!row || row.channel !== 'WEBSITE') {
      throw new DomainError('ORDER_NOT_FOUND', 'Order not found');
    }
    await assertModules(row.locationId);
    return toPublicOrder(row);
  }

  // --- Acceptance timeout ------------------------------------------------------------------------

  /** Cancels website orders still unaccepted after their deadline (single-flight). */
  cancelExpired(now = new Date()): Promise<number> {
    this.sweeping ??= this.sweep(now).finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async sweep(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - ACCEPT_GRACE_MS);
    // The sweep looks across tenants; each cancellation then runs inside its order's tenant.
    const due = await TenantContext.runUnscoped('web order timeout sweep', () =>
      this.prisma.order.findMany({
        where: { channel: 'WEBSITE', status: 'PLACED', acceptBy: { lt: cutoff } },
        select: { id: true, tenantId: true },
        orderBy: { acceptBy: 'asc' },
        take: 100,
      }),
    );
    let cancelled = 0;
    for (const { id, tenantId } of due) {
      try {
        const done = await TenantContext.runInTenant(tenantId, () =>
          this.cancelOne(id, now, cutoff),
        );
        if (done) cancelled += 1;
      } catch (error) {
        this.logger.error(`Could not cancel expired website order ${id}: ${String(error)}`);
      }
    }
    return cancelled;
  }

  private async cancelOne(orderId: string, now: Date, cutoff: Date): Promise<boolean> {
    const row = await this.prisma.$transaction(async (tx) => {
      // The hub's acceptance may be applying concurrently: whoever locks the row first decides.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'PLACED' || !order.acceptBy || order.acceptBy >= cutoff) {
        return null;
      }
      assertTransition({
        from: 'PLACED',
        to: 'CANCELLED',
        trigger: 'SYSTEM',
        paymentStatus: order.paymentStatus,
        reason: WEB_ACCEPTANCE_TIMEOUT_REASON,
      });
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: WEB_ACCEPTANCE_TIMEOUT_REASON,
          version: { increment: 1 },
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'PLACED',
          toStatus: 'CANCELLED',
          actorType: 'SYSTEM',
          source: 'SYSTEM',
          reason: WEB_ACCEPTANCE_TIMEOUT_REASON,
        },
      });
      const voided = await this.payments.voidAll(tx, orderId, WEB_ACCEPTANCE_TIMEOUT_REASON);
      await this.audit.record(
        {
          action: 'order.cancelled',
          entityType: 'Order',
          entityId: orderId,
          actorType: 'SYSTEM',
          actorId: null,
          tenantId: order.tenantId,
          locationId: order.locationId,
          metadata: {
            from: 'PLACED',
            reason: WEB_ACCEPTANCE_TIMEOUT_REASON,
            voided,
            total: order.total,
          },
        },
        tx,
      );
      await this.changes.record(tx, { orderIds: [orderId] });
      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
    if (!row) return false;
    this.bus.publish([
      this.bus.event('order.cancelled', row, {
        ...orderEventPayload(row),
        reason: row.cancelReason,
      }),
    ]);
    return true;
  }
}
