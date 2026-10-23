import type { PrismaClient } from '@pos/database';
import { newId, priceOrder } from '@pos/domain';
import type { DiscountType, OrderChannel, OrderStatus, PaymentMethodType } from '@pos/shared-types';

/**
 * Seeds sales history for report tests straight into the database, with exact timestamps and
 * business dates (orders cannot be back-dated through the API). Every order is priced by the
 * shared pricing engine, so the stored figures are what the POS would have stored.
 */

export interface SeedTax {
  id: string;
  nameEn: string;
  nameAr: string;
  rateBps: number;
}

export interface SeedLine {
  product: { id: string; nameEn: string; nameAr: string };
  variant?: { id: string; nameEn: string; nameAr: string };
  unitPrice: number;
  quantity: number;
  taxes: readonly SeedTax[];
}

export interface SeedDiscount {
  id: string;
  nameEn: string;
  nameAr: string;
  type: DiscountType;
  value: number;
}

export interface SeedOrder {
  locationId: string;
  businessDate: string;
  channel: OrderChannel;
  status?: OrderStatus;
  taxInclusive: boolean;
  /** When the order was placed (UTC). */
  at: string;
  lines: readonly SeedLine[];
  discounts?: readonly SeedDiscount[];
  fee?: number;
}

export interface SeededOrder {
  id: string;
  locationId: string;
  total: number;
  tax: number;
}

export interface SeedMethod {
  id: string;
  type: PaymentMethodType;
  nameEn: string;
  nameAr: string;
}

let numbers = 0;

export function reportSeeder(prisma: PrismaClient, tenantId: string, currencyCode = 'SAR') {
  return {
    async order(o: SeedOrder): Promise<SeededOrder> {
      const lines = o.lines.map((l) => ({ ...l, lineId: newId() }));
      const priced = priceOrder({
        taxInclusive: o.taxInclusive,
        lines: lines.map((l) => ({
          lineId: l.lineId,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          taxes: l.taxes.map((t) => ({ taxId: t.id, rateBps: t.rateBps })),
        })),
        discounts: (o.discounts ?? []).map((d) => ({
          discountId: d.id,
          type: d.type,
          value: d.value,
        })),
        fees: o.fee ? [{ feeId: 'delivery', amount: o.fee, taxes: [] }] : [],
      });
      const id = newId();
      const status = o.status ?? 'COMPLETED';
      const at = new Date(o.at);
      numbers += 1;
      const website = o.channel === 'WEBSITE';
      await prisma.order.create({
        data: {
          id,
          tenantId,
          locationId: o.locationId,
          orderNumber: `R-${String(numbers).padStart(4, '0')}`,
          businessDate: new Date(`${o.businessDate}T00:00:00Z`),
          channel: o.channel,
          status,
          paymentStatus: 'UNPAID',
          source: website ? 'WEBSITE' : 'POS',
          fulfillmentType: website ? 'DELIVERY' : null,
          deliveryAddress: website ? { line1: '1 Test Street' } : undefined,
          currencyCode,
          taxInclusive: o.taxInclusive,
          subtotal: priced.subtotal,
          discountTotal: priced.discount,
          taxTotal: priced.tax,
          feeTotal: priced.fees,
          total: priced.total,
          placedAt: at,
          completedAt: status === 'COMPLETED' || status === 'REFUNDED' ? at : null,
          cancelledAt: status === 'CANCELLED' ? at : null,
          cancelReason: status === 'CANCELLED' ? 'Customer left' : null,
          createdAt: at,
          items: {
            create: lines.map((l, i) => {
              const p = priced.lines[i]!;
              return {
                id: l.lineId,
                productId: l.product.id,
                variantId: l.variant?.id ?? null,
                nameEn: l.product.nameEn,
                nameAr: l.product.nameAr,
                variantNameEn: l.variant?.nameEn ?? null,
                variantNameAr: l.variant?.nameAr ?? null,
                quantity: l.quantity,
                basePrice: l.unitPrice,
                unitPrice: l.unitPrice,
                gross: p.gross,
                discount: p.discount,
                tax: p.tax,
                total: p.total,
                sortOrder: i,
                createdAt: at,
              };
            }),
          },
          taxes: {
            create: priced.taxBreakdown.map((t) => {
              const tax = lines.flatMap((l) => l.taxes).find((x) => x.id === t.taxId)!;
              return {
                taxId: t.taxId,
                nameEn: tax.nameEn,
                nameAr: tax.nameAr,
                rateBps: t.rateBps,
                taxableAmount: t.taxableAmount,
                amount: t.amount,
              };
            }),
          },
          discounts: {
            create: priced.appliedDiscounts.map((d) => {
              const discount = o.discounts!.find((x) => x.id === d.discountId)!;
              return {
                discountId: d.discountId,
                nameEn: discount.nameEn,
                nameAr: discount.nameAr,
                type: discount.type,
                value: discount.value,
                amount: d.amount,
                createdAt: at,
              };
            }),
          },
        },
      });
      return { id, locationId: o.locationId, total: priced.total, tax: priced.tax };
    },

    /** A captured charge, or a refund of `refundOf`, at `at` (UTC). Cash also moves the drawer. */
    async payment(p: {
      order: SeededOrder;
      method: SeedMethod;
      amount: number;
      at: string;
      shiftId: string | null;
      refundOf?: string;
      roundingAdjustment?: number;
    }): Promise<string> {
      const id = newId();
      const at = new Date(p.at);
      const type = p.refundOf ? 'REFUND' : 'CHARGE';
      await prisma.payment.create({
        data: {
          id,
          tenantId,
          locationId: p.order.locationId,
          orderId: p.order.id,
          shiftId: p.shiftId,
          paymentMethodId: p.method.id,
          methodType: p.method.type,
          methodNameEn: p.method.nameEn,
          methodNameAr: p.method.nameAr,
          type,
          status: 'CAPTURED',
          provider: p.method.type === 'CASH' ? 'cash' : 'external-card',
          amount: p.amount,
          roundingAdjustment: p.roundingAdjustment ?? 0,
          refundOfId: p.refundOf ?? null,
          reason: p.refundOf ? 'Customer complaint' : null,
          createdAt: at,
        },
      });
      if (p.method.type === 'CASH' && p.shiftId) {
        await prisma.cashTransaction.create({
          data: {
            id: newId(),
            shiftId: p.shiftId,
            type: type === 'CHARGE' ? 'SALE' : 'REFUND',
            amount: p.amount + (type === 'CHARGE' ? (p.roundingAdjustment ?? 0) : 0),
            paymentId: id,
            createdAt: at,
          },
        });
      }
      return id;
    },

    async shift(s: {
      locationId: string;
      registerId: string;
      openedById: string;
      openedAt: string;
      openingFloat: number;
      closed?: { at: string; expectedCash: number; countedCash: number; byId: string };
    }): Promise<string> {
      const id = newId();
      await prisma.shift.create({
        data: {
          id,
          tenantId,
          locationId: s.locationId,
          cashRegisterId: s.registerId,
          status: s.closed ? 'CLOSED' : 'OPEN',
          openRegisterId: s.closed ? null : s.registerId,
          openingFloat: s.openingFloat,
          openedById: s.openedById,
          openedAt: new Date(s.openedAt),
          ...(s.closed
            ? {
                closedById: s.closed.byId,
                closedAt: new Date(s.closed.at),
                expectedCash: s.closed.expectedCash,
                countedCash: s.closed.countedCash,
                cashDifference: s.closed.countedCash - s.closed.expectedCash,
              }
            : {}),
        },
      });
      return id;
    },

    async cashMovement(shiftId: string, type: 'PAY_IN' | 'PAY_OUT', amount: number, at: string) {
      await prisma.cashTransaction.create({
        data: { id: newId(), shiftId, type, amount, reason: 'Supplies', createdAt: new Date(at) },
      });
    },

    /** A kitchen ticket that reached the kitchen at `at` (UTC); offsets in seconds. */
    async ticket(t: {
      order: SeededOrder;
      stationId: string;
      at: string;
      startedAfter?: number;
      readyAfter?: number;
      status: 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
    }): Promise<void> {
      const at = new Date(t.at);
      const plus = (s: number | undefined) =>
        s === undefined ? null : new Date(at.getTime() + s * 1000);
      await prisma.kitchenTicket.create({
        data: {
          tenantId,
          locationId: t.order.locationId,
          orderId: t.order.id,
          stationId: t.stationId,
          status: t.status,
          startedAt: plus(t.startedAfter),
          readyAt: plus(t.readyAfter),
          completedAt: t.status === 'COMPLETED' ? plus((t.readyAfter ?? 0) + 60) : null,
          cancelledAt: t.status === 'CANCELLED' ? plus(30) : null,
          createdAt: at,
        },
      });
    },
  };
}
