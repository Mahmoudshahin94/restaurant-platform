import type { OrderStatus, PaymentStatus, Permission } from '@pos/shared-types';
import { DomainError } from '../errors';

/**
 * Who may trigger a transition. STAFF transitions are requested by people (POS, admin);
 * SYSTEM transitions are derived by the platform, e.g. PREPARING/READY from kitchen tickets
 * (ADR 0005), and are never accepted from a staff request.
 */
export type TransitionTrigger = 'STAFF' | 'SYSTEM';

export interface TransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  trigger: TransitionTrigger;
  /** Permission the actor needs (in the order's location scope). */
  permission: Permission | null;
  requiresReason: boolean;
  /** Payment must be settled (balance due = 0) before this transition. */
  requiresPaid: boolean;
}

const rule = (
  from: OrderStatus,
  to: OrderStatus,
  options: Partial<Omit<TransitionRule, 'from' | 'to'>> = {},
): TransitionRule => ({
  from,
  to,
  trigger: 'STAFF',
  permission: 'orders.update',
  requiresReason: false,
  requiresPaid: false,
  ...options,
});

/** The complete set of allowed status changes. Anything not listed is rejected. */
export const ORDER_TRANSITIONS: readonly TransitionRule[] = [
  rule('DRAFT', 'PLACED', { permission: 'orders.create' }),
  rule('DRAFT', 'CANCELLED', { permission: 'orders.create' }),

  rule('PLACED', 'CONFIRMED'),
  rule('PLACED', 'CANCELLED', { permission: 'orders.cancel', requiresReason: true }),

  rule('CONFIRMED', 'PREPARING', { trigger: 'SYSTEM', permission: null }),
  rule('CONFIRMED', 'CANCELLED', { permission: 'orders.cancel', requiresReason: true }),
  // Orders with nothing to prepare (e.g. bottled drinks) can be handed over once paid.
  rule('CONFIRMED', 'COMPLETED', { requiresPaid: true }),

  rule('PREPARING', 'READY', { trigger: 'SYSTEM', permission: null }),
  rule('PREPARING', 'CANCELLED', { permission: 'orders.cancel', requiresReason: true }),

  rule('READY', 'COMPLETED', { requiresPaid: true }),

  rule('COMPLETED', 'REFUNDED', { permission: 'orders.refund', requiresReason: true }),
];

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'REFUNDED'];

/** Items can be changed only before the kitchen starts. */
const MODIFIABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['DRAFT', 'PLACED', 'CONFIRMED']);

export function canModifyItems(status: OrderStatus): boolean {
  return MODIFIABLE.has(status);
}

export function findTransition(from: OrderStatus, to: OrderStatus): TransitionRule | undefined {
  return ORDER_TRANSITIONS.find((r) => r.from === from && r.to === to);
}

export function allowedTransitions(from: OrderStatus, trigger: TransitionTrigger): OrderStatus[] {
  return ORDER_TRANSITIONS.filter((r) => r.from === from && r.trigger === trigger).map((r) => r.to);
}

export interface TransitionRequest {
  from: OrderStatus;
  to: OrderStatus;
  trigger: TransitionTrigger;
  paymentStatus: PaymentStatus;
  reason?: string | null;
}

/**
 * Validates a status change and returns its rule (the caller still checks `rule.permission`
 * against the actor). Throws INVALID_ORDER_STATE with a machine-readable `reason`.
 */
export function assertTransition(request: TransitionRequest): TransitionRule {
  const { from, to } = request;
  const found = findTransition(from, to);
  if (!found) {
    throw new DomainError('INVALID_ORDER_STATE', `Cannot move order from ${from} to ${to}`, {
      from,
      to,
      reason: 'NOT_ALLOWED',
      allowed: allowedTransitions(from, request.trigger),
    });
  }
  if (found.trigger !== request.trigger) {
    throw new DomainError('INVALID_ORDER_STATE', `${from} → ${to} is set by the system`, {
      from,
      to,
      reason: 'SYSTEM_ONLY',
    });
  }
  if (found.requiresReason && !request.reason?.trim()) {
    throw new DomainError('INVALID_ORDER_STATE', 'A reason is required', {
      from,
      to,
      reason: 'REASON_REQUIRED',
    });
  }
  if (found.requiresPaid && request.paymentStatus !== 'PAID') {
    throw new DomainError('INVALID_ORDER_STATE', 'Order must be fully paid', {
      from,
      to,
      reason: 'UNPAID',
      paymentStatus: request.paymentStatus,
    });
  }
  return found;
}
