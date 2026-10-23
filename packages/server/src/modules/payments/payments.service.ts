import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  assertRefund,
  assertSafeCardReference,
  assertTransition,
  derivePaymentStatus,
  paymentTotals,
  prepareCharge,
} from '@pos/domain';
import type {
  Order,
  OrderPayment,
  PaymentMethod,
  createPaymentSchema,
  refundPaymentSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { SERVER_MODE, type ServerMode } from '../../common/auth/managed-in-cloud';
import type { Principal } from '../../common/auth/principal';
import { RequestContext } from '../../common/context/request-context';
import { ChangeRecorder } from '../../prisma/change-recorder';
import { SqlDialect } from '../../prisma/dialect';
import { isUniqueViolation } from '../../prisma/errors';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeBus } from '../realtime/realtime.bus';
import {
  orderEventPayload,
  orderInclude,
  settledEntries,
  toOrderDto,
  toPaymentDto,
} from '../orders/orders.mappers';
import { assertCloudMayChangeOrder } from '../orders/hub-ownership';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

type ChargeInput = z.output<typeof createPaymentSchema>;
type RefundInput = z.output<typeof refundPaymentSchema>;

export interface PaymentOutcome {
  payment: OrderPayment;
  order: Order;
}

/**
 * Takes and refunds payments. Each operation locks the order row (SELECT … FOR UPDATE) so two
 * terminals cannot over-collect or over-refund concurrently, and every payment id is an
 * idempotency key: retries return the recorded payment instead of charging twice.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly audit: AuditService,
    private readonly bus: RealtimeBus,
    private readonly dialect: SqlDialect,
    private readonly changes: ChangeRecorder,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {}

  async listMethods(tenantId: string): Promise<PaymentMethod[]> {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { tenantId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map((m) => ({
      id: m.id,
      type: m.type,
      nameEn: m.nameEn,
      nameAr: m.nameAr,
      sortOrder: m.sortOrder,
    }));
  }

  async charge(
    principal: Principal,
    locationId: string,
    orderId: string,
    input: ChargeInput,
  ): Promise<PaymentOutcome> {
    const replay = await this.replay(input.id, locationId, orderId, 'CHARGE');
    if (replay) return replay;

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.dialect.lockOrderRow(tx, locationId, orderId);
        // A concurrent retry with the same id may have committed while we waited for the lock.
        const committed = await this.replayIn(tx, input.id, locationId, orderId, 'CHARGE');
        if (committed) return committed;
        await assertCloudMayChangeOrder(this.mode, tx, orderId);
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: orderInclude,
        });
        await this.requireOpenShift(tx, locationId, input.shiftId);
        const method = await tx.paymentMethod.findFirst({
          where: { id: input.paymentMethodId, tenantId: order.tenantId, archivedAt: null },
        });
        if (!method)
          throw new DomainError('PAYMENT_FAILED', 'Unknown payment method', {
            reason: 'UNKNOWN_METHOD',
          });

        if (method.type === 'CARD') {
          if (!input.reference) {
            throw new DomainError(
              'PAYMENT_FAILED',
              'Enter the approval code from the card terminal',
              {
                reason: 'REFERENCE_REQUIRED',
              },
            );
          }
          assertSafeCardReference(input.reference);
        } else if (input.reference) {
          assertSafeCardReference(input.reference);
        }

        const location = await tx.location.findUniqueOrThrow({ where: { id: locationId } });
        const entries = settledEntries(order.payments);
        const { balanceDue } = paymentTotals(order.total, entries);
        const charge = prepareCharge({
          orderStatus: order.status,
          method: method.type,
          balanceDue,
          amount: input.amount,
          tendered: method.type === 'CASH' ? input.tendered : (input.tendered ?? undefined),
          cashRoundingIncrement: location.cashRoundingIncrement,
        });

        // Local providers (cash, external card) settle synchronously. A remote gateway would
        // create its intent before this transaction and confirm here.
        const result = await this.providers.for(method.type).createPayment({
          paymentId: input.id,
          orderId,
          amount: charge.amount,
          currency: order.currencyCode,
          reference: input.reference,
        });

        const payment = await tx.payment.create({
          data: {
            id: input.id,
            tenantId: order.tenantId,
            locationId,
            orderId,
            shiftId: input.shiftId,
            paymentMethodId: method.id,
            methodType: method.type,
            methodNameEn: method.nameEn,
            methodNameAr: method.nameAr,
            type: 'CHARGE',
            status: result.status,
            provider: this.providers.for(method.type).name,
            providerRef: result.providerRef,
            amount: charge.amount,
            tendered: charge.tendered,
            change: charge.change,
            roundingAdjustment: charge.roundingAdjustment,
            reference: input.reference,
            createdById: principal.userId,
          },
        });
        if (method.type === 'CASH' && result.status === 'CAPTURED') {
          // What stays in the drawer: the amount plus any cash rounding.
          await tx.cashTransaction.create({
            data: {
              id: payment.id,
              shiftId: input.shiftId,
              type: 'SALE',
              amount: charge.amount + charge.roundingAdjustment,
              paymentId: payment.id,
              createdById: principal.userId,
            },
          });
        }

        const updated = await this.refreshPaymentStatus(tx, orderId);
        await this.audit.record(
          {
            action: 'payment.captured',
            entityType: 'Order',
            entityId: orderId,
            locationId,
            metadata: {
              paymentId: payment.id,
              method: method.type,
              amount: charge.amount,
              change: charge.change,
              roundingAdjustment: charge.roundingAdjustment,
              paymentStatus: updated.paymentStatus,
            },
          },
          tx,
        );
        await this.changes.record(tx, { orderIds: [orderId], shiftIds: [input.shiftId] });
        return { payment: toPaymentDto(payment), order: toOrderDto(updated) };
      });
      this.publish(outcome);
      return outcome;
    } catch (error) {
      const raced = await this.replayAfterRace(error, input.id, locationId, orderId, 'CHARGE');
      if (raced) return raced;
      throw error;
    }
  }

  async refund(
    principal: Principal,
    locationId: string,
    orderId: string,
    chargeId: string,
    input: RefundInput,
  ): Promise<PaymentOutcome> {
    const replay = await this.replay(input.id, locationId, orderId, 'REFUND');
    if (replay) return replay;

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.dialect.lockOrderRow(tx, locationId, orderId);
        const committed = await this.replayIn(tx, input.id, locationId, orderId, 'REFUND');
        if (committed) return committed;
        await assertCloudMayChangeOrder(this.mode, tx, orderId);
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: orderInclude,
        });
        await this.requireOpenShift(tx, locationId, input.shiftId);
        const entries = settledEntries(order.payments);
        const charge = order.payments.find((p) => p.id === chargeId && p.status === 'CAPTURED');
        assertRefund(
          charge && {
            id: charge.id,
            type: charge.type,
            amount: charge.amount,
            refundOfId: charge.refundOfId,
          },
          entries,
          input.amount,
          input.reason,
        );
        if (!charge) throw new DomainError('PAYMENT_NOT_FOUND', 'Charge not found');

        const provider = this.providers.for(charge.methodType);
        const result = await provider.refundPayment({
          refundId: input.id,
          providerRef: charge.providerRef,
          amount: input.amount,
          currency: order.currencyCode,
        });
        const refund = await tx.payment.create({
          data: {
            id: input.id,
            tenantId: order.tenantId,
            locationId,
            orderId,
            shiftId: input.shiftId,
            paymentMethodId: charge.paymentMethodId,
            methodType: charge.methodType,
            methodNameEn: charge.methodNameEn,
            methodNameAr: charge.methodNameAr,
            type: 'REFUND',
            status: result.status,
            provider: provider.name,
            providerRef: result.providerRef,
            amount: input.amount,
            refundOfId: charge.id,
            reason: input.reason,
            createdById: principal.userId,
          },
        });
        if (charge.methodType === 'CASH' && result.status === 'CAPTURED') {
          await tx.cashTransaction.create({
            data: {
              id: refund.id,
              shiftId: input.shiftId,
              type: 'REFUND',
              amount: input.amount,
              paymentId: refund.id,
              reason: input.reason,
              createdById: principal.userId,
            },
          });
        }

        let updated = await this.refreshPaymentStatus(tx, orderId);
        // A completed order whose money was fully returned becomes REFUNDED (system transition).
        if (updated.status === 'COMPLETED' && updated.paymentStatus === 'REFUNDED') {
          assertTransition({
            from: 'COMPLETED',
            to: 'REFUNDED',
            trigger: 'SYSTEM',
            paymentStatus: 'REFUNDED',
          });
          await tx.order.update({
            where: { id: orderId },
            data: { status: 'REFUNDED', version: { increment: 1 } },
          });
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: 'COMPLETED',
              toStatus: 'REFUNDED',
              actorType: 'USER',
              actorId: principal.userId,
              source: RequestContext.get()?.source ?? 'POS',
              reason: input.reason,
            },
          });
          updated = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: orderInclude,
          });
        }

        await this.audit.record(
          {
            action: 'payment.refunded',
            entityType: 'Order',
            entityId: orderId,
            locationId,
            metadata: {
              refundId: refund.id,
              chargeId: charge.id,
              method: charge.methodType,
              amount: input.amount,
              reason: input.reason,
              paymentStatus: updated.paymentStatus,
              orderStatus: updated.status,
            },
          },
          tx,
        );
        await this.changes.record(tx, { orderIds: [orderId], shiftIds: [input.shiftId] });
        return { payment: toPaymentDto(refund), order: toOrderDto(updated) };
      });
      this.publish(outcome);
      return outcome;
    } catch (error) {
      const raced = await this.replayAfterRace(error, input.id, locationId, orderId, 'REFUND');
      if (raced) return raced;
      throw error;
    }
  }

  /** Tells POS screens the order's balance changed (after the transaction committed). */
  private publish({ order }: PaymentOutcome): void {
    const payload = orderEventPayload(order);
    this.bus.publish([
      this.bus.event('order.updated', order, payload),
      ...(order.balanceDue === 0 && order.paymentStatus === 'PAID'
        ? [
            this.bus.event('order.payment_completed', order, {
              ...payload,
              paidAmount: order.paidTotal,
            }),
          ]
        : []),
    ]);
  }

  // --- helpers -------------------------------------------------------------------------------

  private async requireOpenShift(tx: PrismaTx, locationId: string, shiftId: string): Promise<void> {
    const shift = await tx.shift.findFirst({
      where: { id: shiftId, locationId },
      select: { status: true },
    });
    if (!shift) throw new DomainError('SHIFT_NOT_FOUND', 'Shift not found', { shiftId });
    if (shift.status !== 'OPEN')
      throw new DomainError('SHIFT_NOT_OPEN', 'Open a shift before taking payments', { shiftId });
  }

  private async refreshPaymentStatus(tx: PrismaTx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: orderInclude,
    });
    const status = derivePaymentStatus(order.total, settledEntries(order.payments));
    if (status === order.paymentStatus) return order;
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: status, version: { increment: 1 } },
    });
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  }

  private replay(
    paymentId: string,
    locationId: string,
    orderId: string,
    type: 'CHARGE' | 'REFUND',
  ) {
    return this.replayIn(this.prisma, paymentId, locationId, orderId, type);
  }

  /** Returns the recorded outcome when this payment id was already processed. */
  private async replayIn(
    tx: PrismaTx,
    paymentId: string,
    locationId: string,
    orderId: string,
    type: 'CHARGE' | 'REFUND',
  ): Promise<PaymentOutcome | null> {
    const existing = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!existing) return null;
    if (
      existing.locationId !== locationId ||
      existing.orderId !== orderId ||
      existing.type !== type
    ) {
      throw new DomainError('CONFLICT', 'Payment id already used elsewhere', {
        reason: 'ID_IN_USE',
      });
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: orderInclude,
    });
    return { payment: toPaymentDto(existing), order: toOrderDto(order) };
  }

  private async replayAfterRace(
    error: unknown,
    paymentId: string,
    locationId: string,
    orderId: string,
    type: 'CHARGE' | 'REFUND',
  ): Promise<PaymentOutcome | null> {
    if (isUniqueViolation(error)) {
      return this.replay(paymentId, locationId, orderId, type);
    }
    return null;
  }
}
