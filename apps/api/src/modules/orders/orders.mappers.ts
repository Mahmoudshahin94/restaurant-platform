import type { Prisma } from '@pos/database';
import type { Order } from '@pos/validation';

export const orderInclude = {
  items: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } },
  taxes: true,
  discounts: { orderBy: { createdAt: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  table: { select: { label: true } },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function toOrderDto(row: OrderRow): Order {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
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
      quantity: item.quantity,
      basePrice: item.basePrice,
      unitPrice: item.unitPrice,
      gross: item.gross,
      discount: item.discount,
      tax: item.tax,
      total: item.total,
      notes: item.notes,
      stationIds: item.stationIds,
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
