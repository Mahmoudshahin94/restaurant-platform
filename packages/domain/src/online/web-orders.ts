import type {
  FulfillmentType,
  OrderChannel,
  OrderStatus,
  PaymentMethodType,
  WebPaymentOption,
} from '@pos/shared-types';
import { DomainError } from '../errors';
import type { PricingFeeInput } from '../pricing/types';

/** The fee id of the delivery fee in the pricing engine. */
export const DELIVERY_FEE_ID = 'delivery';

/**
 * Fees of a website order, priced by the shared engine (preview in the browser, authoritative in
 * the cloud). The delivery fee is untaxed.
 */
export function webOrderFees(fulfillment: FulfillmentType, deliveryFee: number): PricingFeeInput[] {
  return fulfillment === 'DELIVERY' && deliveryFee > 0
    ? [{ feeId: DELIVERY_FEE_ID, amount: deliveryFee, taxes: [] }]
    : [];
}

export interface FulfillmentOptions {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
}

/** Refuses a fulfillment or payment choice the location does not offer. */
export function assertWebOrderOptions(
  options: FulfillmentOptions,
  fulfillment: FulfillmentType,
  payment: WebPaymentOption,
): void {
  const offered = fulfillment === 'PICKUP' ? options.pickupEnabled : options.deliveryEnabled;
  if (!offered) {
    throw new DomainError('ONLINE_ORDERING_DISABLED', 'This fulfillment is not offered', {
      reason: 'FULFILLMENT_UNAVAILABLE',
      fulfillment,
    });
  }
  const valid =
    payment === 'ONLINE_CARD' ||
    (payment === 'PAY_AT_PICKUP' && fulfillment === 'PICKUP') ||
    (payment === 'CASH_ON_DELIVERY' && fulfillment === 'DELIVERY');
  if (!valid) {
    throw new DomainError('VALIDATION_FAILED', 'Payment option does not fit the fulfillment', {
      reason: 'PAYMENT_OPTION_MISMATCH',
      fulfillment,
      payment,
    });
  }
}

/** When a website order placed at `placedAt` must be accepted by. */
export function acceptanceDeadline(placedAt: Date, minutes: number): Date {
  return new Date(placedAt.getTime() + minutes * 60_000);
}

interface WebOrderState {
  channel: OrderChannel;
  status: OrderStatus;
  acceptBy: Date | null;
}

/** A website order the restaurant has not accepted or rejected yet (owned by the cloud). */
export function isAwaitingAcceptance(order: { channel: OrderChannel; status: OrderStatus }) {
  return order.channel === 'WEBSITE' && order.status === 'PLACED';
}

/** Whether the acceptance deadline of a website order has passed. */
export function isAcceptanceExpired(order: WebOrderState, now: Date): boolean {
  return isAwaitingAcceptance(order) && order.acceptBy !== null && now > order.acceptBy;
}

/**
 * Staff may accept a website order only before its deadline: after it, the cloud cancels the
 * order (and voids its payment), so an acceptance would contradict what the customer was told.
 * Rejecting stays possible; both end in a cancellation.
 */
export function assertWebOrderDecision(order: WebOrderState, to: OrderStatus, now: Date): void {
  if (to === 'CONFIRMED' && isAcceptanceExpired(order, now)) {
    throw new DomainError('INVALID_ORDER_STATE', 'The acceptance time of this order has passed', {
      reason: 'ACCEPTANCE_EXPIRED',
      acceptBy: order.acceptBy?.toISOString() ?? null,
    });
  }
}

/**
 * The content of a website order is what the customer ordered and paid for: it cannot be edited
 * until the restaurant accepts it (the cloud owns it until then, ADR 0013).
 */
export function assertEditableByStaff(order: { channel: OrderChannel; status: OrderStatus }) {
  if (isAwaitingAcceptance(order)) {
    throw new DomainError('INVALID_ORDER_STATE', 'Accept the website order before editing it', {
      status: order.status,
      reason: 'AWAITING_ACCEPTANCE',
    });
  }
}

/**
 * Online payments of a website order still awaiting acceptance are voided by the cloud when the
 * order is rejected or times out, so they do not block a cancellation at the restaurant.
 */
export function isVoidedOnCancel(
  order: { channel: OrderChannel; status: OrderStatus },
  payment: { methodType: PaymentMethodType },
): boolean {
  return isAwaitingAcceptance(order) && payment.methodType === 'ONLINE';
}
