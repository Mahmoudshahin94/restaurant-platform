import type { Location, Prisma } from '@pos/database';
import { type OnlineOrderingStatus, parseOpeningHours } from '@pos/domain';
import {
  WEB_ACCEPTANCE_TIMEOUT_REASON,
  WebRejectReason,
  type WebPaymentOption,
} from '@pos/shared-types';
import type { PublicLocation, PublicOrder } from '@pos/validation';
import { toDeliveryAddress } from '../orders/orders.mappers';

export const publicOrderInclude = {
  items: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  location: true,
} satisfies Prisma.OrderInclude;

export type PublicOrderRow = Prisma.OrderGetPayload<{ include: typeof publicOrderInclude }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const KNOWN_REASONS = new Set<string>([
  ...Object.values(WebRejectReason),
  WEB_ACCEPTANCE_TIMEOUT_REASON,
]);

/** A cancel reason as customers may see it: a known code, or OTHER for staff free text. */
export function publicCancelReason(reason: string | null): string | null {
  if (reason === null) return null;
  return KNOWN_REASONS.has(reason) ? reason : WebRejectReason.OTHER;
}

/** How the customer chose to pay: an online charge means the card; otherwise on handover. */
export function paymentOptionOf(row: {
  fulfillmentType: PublicOrder['fulfillmentType'] | null;
  payments: readonly { methodType: string; type: string }[];
}): WebPaymentOption {
  if (row.payments.some((p) => p.methodType === 'ONLINE' && p.type === 'CHARGE')) {
    return 'ONLINE_CARD';
  }
  return row.fulfillmentType === 'DELIVERY' ? 'CASH_ON_DELIVERY' : 'PAY_AT_PICKUP';
}

/** The customer's view of an order: no staff, device or internal ids. */
export function toPublicOrder(row: PublicOrderRow): PublicOrder {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    locationId: row.locationId,
    location: {
      nameEn: row.location.nameEn,
      nameAr: row.location.nameAr,
      phone: row.location.phone,
      addressLine: row.location.addressLine,
      timezone: row.location.timezone,
    },
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentOption: paymentOptionOf(row),
    fulfillmentType: row.fulfillmentType ?? 'PICKUP',
    deliveryAddress: toDeliveryAddress(row.deliveryAddress),
    customerName: row.customerName ?? '',
    notes: row.notes,
    currencyCode: row.currencyCode,
    taxInclusive: row.taxInclusive,
    items: row.items.map((item) => ({
      id: item.id,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      variantNameEn: item.variantNameEn,
      variantNameAr: item.variantNameAr,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
      notes: item.notes,
      modifiers: item.modifiers.map((m) => ({
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceDelta: m.priceDelta,
      })),
    })),
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    feeTotal: row.feeTotal,
    total: row.total,
    placedAt: iso(row.placedAt),
    acceptBy: iso(row.acceptBy),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: publicCancelReason(row.cancelReason),
    timeline: row.statusHistory.map((h) => ({ status: h.toStatus, at: h.createdAt.toISOString() })),
  };
}

export function toPublicLocation(
  location: Location,
  currencyCode: string,
  status: OnlineOrderingStatus,
  onlineCardEnabled: boolean,
): PublicLocation {
  return {
    id: location.id,
    restaurantId: location.restaurantId,
    code: location.code,
    nameEn: location.nameEn,
    nameAr: location.nameAr,
    addressLine: location.addressLine,
    phone: location.phone,
    timezone: location.timezone,
    currencyCode,
    taxInclusive: location.taxInclusive,
    status,
    openingHours: parseOpeningHours(location.openingHours),
    pickupEnabled: location.onlinePickupEnabled,
    deliveryEnabled: location.onlineDeliveryEnabled,
    deliveryFee: location.onlineDeliveryFee,
    acceptMinutes: location.onlineAcceptMinutes,
    onlineCardEnabled,
  };
}
