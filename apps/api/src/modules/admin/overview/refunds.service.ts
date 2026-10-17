import { Injectable } from '@nestjs/common';
import { DomainError, assertRefund, derivePaymentStatus, isAwaitingAcceptance } from '@pos/domain';
import { AuditService, OnlinePaymentsService, type Principal, PrismaService } from '@pos/server';
import type { AdminRefundRequest, PaymentListItem } from '@pos/validation';
import { recordOrderChange } from '../../sync/web-order-change.recorder';
import { paymentListInclude, toPaymentItem } from './search.service';

/**
 * Refunds from the admin portal (ADR 0014): online card charges only. The cloud settles those
 * with the provider (also for orders the location's hub owns), as an append-only REFUND row
 * without a drawer; the order's payment status follows, its version does not change, and the hub
 * is told so it merges the row. Cash and card-terminal refunds need the drawer and happen at the
 * POS, where the hub owns the order.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly online: OnlinePaymentsService,
  ) {}

  async refund(
    principal: Principal,
    locationId: string,
    chargeId: string,
    input: AdminRefundRequest,
  ): Promise<PaymentListItem> {
    const id = await this.prisma.$transaction(async (tx) => {
      const charge = await tx.payment.findFirst({ where: { id: chargeId, locationId } });
      if (!charge) throw new DomainError('PAYMENT_NOT_FOUND', 'Payment not found');
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${charge.orderId}::uuid FOR UPDATE`;

      const existing = await tx.payment.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.refundOfId !== chargeId || existing.type !== 'REFUND') {
          throw new DomainError('CONFLICT', 'Payment id already used elsewhere', {
            reason: 'ID_IN_USE',
          });
        }
        return existing.id; // A resend of the same refund.
      }
      if (charge.methodType !== 'ONLINE') {
        throw new DomainError('REFUND_NOT_ALLOWED', 'Refund this payment at the POS', {
          reason: 'IN_STORE_METHOD',
        });
      }
      const order = await tx.order.findUniqueOrThrow({
        where: { id: charge.orderId },
        include: { payments: true },
      });
      if (isAwaitingAcceptance(order)) {
        // The restaurant's rejection (or the timeout) voids it; refunding first would race that.
        throw new DomainError('INVALID_ORDER_STATE', 'The order is waiting for the restaurant', {
          reason: 'AWAITING_ACCEPTANCE',
        });
      }
      const entries = order.payments
        .filter((p) => p.status === 'CAPTURED')
        .map((p) => ({ id: p.id, type: p.type, amount: p.amount, refundOfId: p.refundOfId }));
      assertRefund(
        charge.status === 'CAPTURED'
          ? { id: charge.id, type: charge.type, amount: charge.amount, refundOfId: null }
          : undefined,
        entries,
        input.amount,
        input.reason,
      );
      if (!this.online.configured) {
        throw new DomainError('PAYMENT_FAILED', 'No online payment provider is configured', {
          reason: 'PROVIDER_NOT_CONFIGURED',
        });
      }
      const result = await this.online.provider.refundPayment({
        refundId: input.id,
        providerRef: charge.providerRef,
        amount: input.amount,
        currency: order.currencyCode,
      });
      await tx.payment.create({
        data: {
          id: input.id,
          restaurantId: charge.restaurantId,
          locationId,
          orderId: order.id,
          shiftId: null,
          paymentMethodId: charge.paymentMethodId,
          methodType: charge.methodType,
          methodNameEn: charge.methodNameEn,
          methodNameAr: charge.methodNameAr,
          type: 'REFUND',
          status: result.status,
          provider: charge.provider,
          providerRef: result.providerRef,
          amount: input.amount,
          refundOfId: charge.id,
          reason: input.reason,
          createdById: principal.userId,
        },
      });
      const captured = await tx.payment.findMany({
        where: { orderId: order.id, status: 'CAPTURED' },
      });
      const paymentStatus = derivePaymentStatus(
        order.total,
        captured.map((p) => ({
          id: p.id,
          type: p.type,
          amount: p.amount,
          refundOfId: p.refundOfId,
        })),
      );
      // Like a void, a refund is not an order edit: the version stays (the hub may own it).
      if (paymentStatus !== order.paymentStatus) {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus } });
      }
      await this.audit.record(
        {
          action: 'payment.refunded',
          entityType: 'Order',
          entityId: order.id,
          locationId,
          metadata: {
            refundId: input.id,
            chargeId: charge.id,
            method: charge.methodType,
            amount: input.amount,
            reason: input.reason,
            status: result.status,
            paymentStatus,
            orderStatus: order.status,
          },
        },
        tx,
      );
      await recordOrderChange(tx, order);
      return input.id;
    });
    const row = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: paymentListInclude,
    });
    return toPaymentItem(row);
  }
}
