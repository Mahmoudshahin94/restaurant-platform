import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, derivePaymentStatus, newId } from '@pos/domain';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import type { PrismaTx } from '../../prisma/prisma.service';
import { settledEntries } from '../orders/orders.mappers';
import { MockOnlinePaymentProvider } from '../payments/providers/mock-online.provider';
import type { PaymentProvider } from '../payments/providers/payment-provider';
import { UnconfiguredOnlinePaymentProvider } from '../payments/providers/unconfigured-online.provider';

/**
 * Online card payments of website orders (ADR 0013): charged at checkout through the configured
 * provider and voided when the restaurant rejects the order or does not accept it in time. A void
 * is recorded append-only, as a REFUND row of the charge, so financial rows are never edited.
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);
  readonly provider: PaymentProvider;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.provider =
      config.ONLINE_PAYMENT_PROVIDER === 'mock'
        ? new MockOnlinePaymentProvider()
        : new UnconfiguredOnlinePaymentProvider();
  }

  get configured(): boolean {
    return !(this.provider instanceof UnconfiguredOnlinePaymentProvider);
  }

  /** The restaurant's online tender, if it has one; online card needs both it and a provider. */
  async methodFor(tx: PrismaTx, restaurantId: string) {
    if (!this.configured) return null;
    return tx.paymentMethod.findFirst({
      where: { restaurantId, type: 'ONLINE', archivedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Voids an order's captured online charges inside the caller's transaction. */
  async voidAll(tx: PrismaTx, orderId: string, reason: string): Promise<number> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Order not found', { orderId });
    const refunded = new Set(order.payments.flatMap((p) => (p.refundOfId ? [p.refundOfId] : [])));
    const charges = order.payments.filter(
      (p) =>
        p.methodType === 'ONLINE' &&
        p.type === 'CHARGE' &&
        p.status === 'CAPTURED' &&
        !refunded.has(p.id),
    );
    for (const charge of charges) {
      const result = charge.providerRef
        ? await this.provider.cancelPayment(charge.providerRef).catch((error: unknown) => {
            // The void is still recorded: an operator settles it with the gateway.
            this.logger.error(`Void of payment ${charge.id} failed: ${String(error)}`);
            return null;
          })
        : null;
      await tx.payment.create({
        data: {
          id: newId(),
          restaurantId: charge.restaurantId,
          locationId: charge.locationId,
          orderId,
          shiftId: null,
          paymentMethodId: charge.paymentMethodId,
          methodType: charge.methodType,
          methodNameEn: charge.methodNameEn,
          methodNameAr: charge.methodNameAr,
          type: 'REFUND',
          status: result?.status === 'CANCELLED' ? 'CAPTURED' : 'PENDING',
          provider: charge.provider,
          providerRef: charge.providerRef,
          amount: charge.amount,
          refundOfId: charge.id,
          reason: `VOID: ${reason}`,
        },
      });
    }
    if (charges.length > 0) {
      const payments = await tx.payment.findMany({ where: { orderId } });
      await tx.order.update({
        where: { id: orderId },
        // A void does not bump the order's version: like a payment, it is not an order edit
        // (and the hub may own the order by now, ADR 0013).
        data: { paymentStatus: derivePaymentStatus(order.total, settledEntries(payments)) },
      });
    }
    return charges.length;
  }
}
