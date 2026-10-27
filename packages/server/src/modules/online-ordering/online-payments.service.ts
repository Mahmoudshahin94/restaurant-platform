import { Injectable, Logger } from '@nestjs/common';
import { DomainError, derivePaymentStatus, newId } from '@pos/domain';
import type { PaymentMethodType } from '@pos/shared-types';
import { AuditService } from '../audit/audit.service';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { settledEntries } from '../orders/orders.mappers';
import type { PaymentProvider } from '../payments/providers/payment-provider';
import {
  type ConfiguredProvider,
  PaymentProviderFactory,
} from '../payments/providers/payment-provider.factory';

type Db = PrismaService | PrismaTx;

/** The tender an online payment is recorded under (its names are snapshotted on the payment). */
interface OnlineTender {
  id: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Online card payments of website orders (ADR 0013): charged at checkout through the provider
 * the tenant configured for the location (ADR 0024) and voided when the location rejects the order
 * or does not accept it in time. A void is recorded append-only, as a REFUND row of the charge, so
 * financial rows are never edited. A tenant without an ONLINE provider takes cash only: its
 * website offers no card, and a card checkout is refused (`ONLINE_PAYMENT_UNAVAILABLE`).
 */
@Injectable()
export class OnlinePaymentsService {
  private readonly logger = new Logger(OnlinePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderFactory,
    private readonly audit: AuditService,
  ) {}

  /**
   * The tenant's online tender: the one linked to the provider account (ADR 0024), else the first
   * one listed. Online payments are recorded under it.
   */
  async methodFor(db: Db, tenantId: string, accountId: string | null) {
    const where = { tenantId, type: 'ONLINE' as const, archivedAt: null };
    return (
      (accountId
        ? await db.paymentMethod.findFirst({
            where: { ...where, providerAccountId: accountId },
            orderBy: { sortOrder: 'asc' },
          })
        : null) ?? (await db.paymentMethod.findFirst({ where, orderBy: { sortOrder: 'asc' } }))
    );
  }

  /** Whether the location's website checkout offers online card payment. */
  async available(tenantId: string, locationId: string): Promise<boolean> {
    if (!(await this.providers.available(tenantId, 'ONLINE', locationId))) return false;
    return (await this.methodFor(this.prisma, tenantId, null)) !== null;
  }

  /**
   * The provider and tender that take a card checkout at this location, or the clear refusal
   * `ONLINE_PAYMENT_UNAVAILABLE` (a cash-only business has no ONLINE provider).
   */
  async checkout(
    tenantId: string,
    locationId: string,
  ): Promise<ConfiguredProvider & { method: OnlineTender }> {
    const configured = await this.providers.forTenant(tenantId, 'ONLINE', locationId);
    const method = await this.methodFor(this.prisma, tenantId, configured.accountId);
    if (!method) {
      throw new DomainError('ONLINE_PAYMENT_UNAVAILABLE', 'The business has no online tender');
    }
    return { ...configured, method };
  }

  /** The adapter that took a recorded online payment (its voids and refunds go back through it). */
  providerOf(
    payment: {
      tenantId: string;
      provider: string;
      providerAccountId: string | null;
      methodType: PaymentMethodType;
    },
    db: Db,
  ): Promise<PaymentProvider> {
    return this.providers.forPayment(payment, db);
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
        ? await this.providers
            .forPayment(charge, tx)
            .then((provider) => provider.cancelPayment(charge.providerRef ?? ''))
            .catch((error: unknown) => {
              // The void is still recorded: an operator settles it with the gateway.
              this.logger.error(`Void of payment ${charge.id} failed: ${String(error)}`);
              return null;
            })
        : null;
      await tx.payment.create({
        data: {
          id: newId(),
          tenantId: charge.tenantId,
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
          providerAccountId: charge.providerAccountId,
          providerRef: charge.providerRef,
          amount: charge.amount,
          refundOfId: charge.id,
          reason: `VOID: ${reason}`,
        },
      });
      // A payment correction: audited like a refund, as the system's action.
      await this.audit.record(
        {
          action: 'payment.voided',
          entityType: 'Order',
          entityId: orderId,
          tenantId: charge.tenantId,
          locationId: charge.locationId,
          metadata: {
            chargeId: charge.id,
            amount: charge.amount,
            reason,
            settled: result?.status === 'CANCELLED',
          },
        },
        tx,
      );
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
