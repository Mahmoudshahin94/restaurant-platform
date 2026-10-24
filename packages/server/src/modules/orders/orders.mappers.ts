import type { Payment as PaymentRow, Prisma } from '@pos/database';
import { paymentTotals } from '@pos/domain';
import type { OrderEventPayload } from '@pos/shared-types';
import type { Order, OrderPayment } from '@pos/validation';
import { jsonStringArray } from '../../prisma/json';
import { orderTicketsInclude, toTicketSummary } from '../kitchen/kitchen.mappers';

export const orderInclude = {
  items: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } },
  taxes: true,
  discounts: { orderBy: { createdAt: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  table: { select: { label: true } },
  payments: { orderBy: { createdAt: 'asc' } },
  tickets: orderTicketsInclude,
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function toPaymentDto(p: PaymentRow): OrderPayment {
  return {
    id: p.id,
    type: p.type,
    status: p.status,
    paymentMethodId: p.paymentMethodId,
    methodType: p.methodType,
    methodNameEn: p.methodNameEn,
    methodNameAr: p.methodNameAr,
    amount: p.amount,
    tendered: p.tendered,
    change: p.change,
    roundingAdjustment: p.roundingAdjustment,
    reference: p.reference,
    refundOfId: p.refundOfId,
    reason: p.reason,
    shiftId: p.shiftId,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Captured payment rows in the shape the domain payment rules use. */
export function settledEntries(payments: readonly PaymentRow[]) {
  return payments
    .filter((p) => p.status === 'CAPTURED')
    .map((p) => ({ id: p.id, type: p.type, amount: p.amount, refundOfId: p.refundOfId }));
}

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

/** A stored delivery address (JSON column) in its API shape. */
export function toDeliveryAddress(value: Prisma.JsonValue | null): Order['deliveryAddress'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const line1 = textOrNull(value.line1);
  if (line1 === null) return null;
  return {
    line1,
    line2: textOrNull(value.line2),
    city: textOrNull(value.city),
    notes: textOrNull(value.notes),
  };
}

export function toOrderDto(row: OrderRow): Order {
  const totals = paymentTotals(row.total, settledEntries(row.payments));
  return {
    id: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    orderNumber: row.orderNumber,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    channel: row.channel,
    status: row.status,
    paymentStatus: row.paymentStatus,
    source: row.source,
    tableId: row.tableId,
    tableLabel: row.table?.label ?? null,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    guestCount: row.guestCount,
    customerEmail: row.customerEmail,
    fulfillmentType: row.fulfillmentType,
    deliveryAddress: toDeliveryAddress(row.deliveryAddress),
    notes: row.notes,
    currencyCode: row.currencyCode,
    taxInclusive: row.taxInclusive,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    feeTotal: row.feeTotal,
    total: row.total,
    version: row.version,
    createdById: row.createdById,
    placedAt: isoOrNull(row.placedAt),
    acceptBy: isoOrNull(row.acceptBy),
    completedAt: isoOrNull(row.completedAt),
    cancelledAt: isoOrNull(row.cancelledAt),
    cancelReason: row.cancelReason,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      variantNameEn: item.variantNameEn,
      variantNameAr: item.variantNameAr,
      sku: item.sku,
      barcode: item.barcode,
      quantity: item.quantity,
      basePrice: item.basePrice,
      unitPrice: item.unitPrice,
      gross: item.gross,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
      notes: item.notes,
      stationIds: jsonStringArray(item.stationIds),
      modifiers: item.modifiers.map((m) => ({
        modifierId: m.modifierId,
        modifierGroupId: m.modifierGroupId,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceDelta: m.priceDelta,
      })),
    })),
    taxes: row.taxes
      .map((t) => ({
        taxId: t.taxId,
        nameEn: t.nameEn,
        nameAr: t.nameAr,
        rateBps: t.rateBps,
        taxableAmount: t.taxableAmount,
        amount: t.amount,
      }))
      .sort((a, b) => a.taxId.localeCompare(b.taxId)),
    discounts: row.discounts.map((d) => ({
      discountId: d.discountId,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      type: d.type,
      value: d.value,
      amount: d.amount,
    })),
    payments: row.payments.map(toPaymentDto),
    tickets: row.tickets.map(toTicketSummary),
    paidTotal: totals.paid,
    refundedTotal: totals.refunded,
    balanceDue: totals.balanceDue,
    statusHistory: row.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      source: h.source,
      actorId: h.actorId,
      reason: h.reason,
      createdAt: iso(h.createdAt),
    })),
  };
}

/** Realtime payload for order events; consumers re-fetch the order when they need more. */
export function orderEventPayload(row: {
  id: string;
  orderNumber: string;
  channel: Order['channel'];
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  version: number;
}): OrderEventPayload {
  return {
    orderId: row.id,
    orderNumber: row.orderNumber,
    channel: row.channel,
    status: row.status,
    paymentStatus: row.paymentStatus,
    version: row.version,
  };
}
