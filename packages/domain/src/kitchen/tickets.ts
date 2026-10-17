import type { KitchenTicketStatus, OrderStatus, TicketPriority } from '@pos/shared-types';
import { DomainError } from '../errors';

/**
 * Kitchen tickets: one per order and station. Kitchen staff move them NEW → PREPARING → READY →
 * COMPLETED (bumped off the screen); the platform cancels them when the order is cancelled or
 * their items are removed. The order's PREPARING/READY statuses are derived from its tickets
 * (ADR 0005), never set by hand.
 */
export type TicketTrigger = 'STAFF' | 'SYSTEM';

interface TicketRule {
  from: KitchenTicketStatus;
  to: KitchenTicketStatus;
  trigger: TicketTrigger;
}

const staff = (from: KitchenTicketStatus, to: KitchenTicketStatus): TicketRule => ({
  from,
  to,
  trigger: 'STAFF',
});
const system = (from: KitchenTicketStatus, to: KitchenTicketStatus): TicketRule => ({
  from,
  to,
  trigger: 'SYSTEM',
});

export const TICKET_TRANSITIONS: readonly TicketRule[] = [
  staff('NEW', 'PREPARING'),
  // Quick items can be marked ready without being started first.
  staff('NEW', 'READY'),
  staff('PREPARING', 'READY'),
  // Undo a "ready" tapped by mistake.
  staff('READY', 'PREPARING'),
  // Bump: the food left the pass.
  staff('READY', 'COMPLETED'),
  // Recall a bumped ticket back to the screen.
  staff('COMPLETED', 'READY'),

  // Handing the order over at the POS clears its ready tickets.
  system('READY', 'COMPLETED'),
  system('NEW', 'CANCELLED'),
  system('PREPARING', 'CANCELLED'),
  system('READY', 'CANCELLED'),
  // Items routed to a station again after an edit had removed them all.
  system('CANCELLED', 'NEW'),
];

export function allowedTicketTransitions(
  from: KitchenTicketStatus,
  trigger: TicketTrigger,
): KitchenTicketStatus[] {
  return TICKET_TRANSITIONS.filter((r) => r.from === from && r.trigger === trigger).map(
    (r) => r.to,
  );
}

/** Throws INVALID_TICKET_STATE (`reason`: NOT_ALLOWED | SYSTEM_ONLY | ORDER_CLOSED). */
export function assertTicketTransition(request: {
  from: KitchenTicketStatus;
  to: KitchenTicketStatus;
  trigger: TicketTrigger;
  orderStatus: OrderStatus;
}): void {
  const { from, to, trigger, orderStatus } = request;
  // Some moves exist for both triggers (a bump by the kitchen, or by the POS handover).
  const rules = TICKET_TRANSITIONS.filter((r) => r.from === from && r.to === to);
  const found = rules.find((r) => r.trigger === trigger) ?? rules[0];
  if (!found) {
    throw new DomainError('INVALID_TICKET_STATE', `Cannot move ticket from ${from} to ${to}`, {
      from,
      to,
      reason: 'NOT_ALLOWED',
      allowed: allowedTicketTransitions(from, trigger),
    });
  }
  if (found.trigger !== trigger) {
    throw new DomainError('INVALID_TICKET_STATE', `${from} → ${to} is set by the system`, {
      from,
      to,
      reason: 'SYSTEM_ONLY',
    });
  }
  if (trigger === 'STAFF') {
    // Once the order is handed over, the screen may still bump or recall its tickets.
    const screenOnly =
      (from === 'READY' && to === 'COMPLETED') || (from === 'COMPLETED' && to === 'READY');
    const closed =
      orderStatus === 'CANCELLED' ||
      orderStatus === 'REFUNDED' ||
      (orderStatus === 'COMPLETED' && !screenOnly);
    if (closed) {
      throw new DomainError('INVALID_TICKET_STATE', 'The order is closed', {
        from,
        to,
        reason: 'ORDER_CLOSED',
        orderStatus,
      });
    }
  }
}

/** True for tickets that still count towards the order's kitchen progress. */
export const isLiveTicket = (status: KitchenTicketStatus): boolean => status !== 'CANCELLED';

/**
 * System order transitions implied by the tickets, in the order they must be applied:
 * the first ticket started moves CONFIRMED → PREPARING; all live tickets ready (or bumped) moves
 * it on to READY; un-readying a ticket moves READY back to PREPARING.
 */
export function deriveOrderStatus(
  orderStatus: OrderStatus,
  ticketStatuses: readonly KitchenTicketStatus[],
): OrderStatus[] {
  const live = ticketStatuses.filter(isLiveTicket);
  if (live.length === 0) return [];
  const started = live.some((s) => s !== 'NEW');
  const allReady = live.every((s) => s === 'READY' || s === 'COMPLETED');
  switch (orderStatus) {
    case 'CONFIRMED':
      if (allReady) return ['PREPARING', 'READY'];
      return started ? ['PREPARING'] : [];
    case 'PREPARING':
      return allReady ? ['READY'] : [];
    case 'READY':
      return allReady ? [] : ['PREPARING'];
    default:
      return [];
  }
}

export type TicketUrgency = 'ok' | 'warn' | 'late';

/** How overdue a ticket is, from its age and the location's KDS thresholds (minutes). */
export function ticketUrgency(
  ageMs: number,
  thresholds: { warnMinutes: number; lateMinutes: number },
): TicketUrgency {
  const minutes = ageMs / 60_000;
  if (minutes >= thresholds.lateMinutes) return 'late';
  if (minutes >= thresholds.warnMinutes) return 'warn';
  return 'ok';
}

/** Kitchen screen order: rush tickets first, then oldest first. */
export function compareTickets(
  a: { priority: TicketPriority; createdAt: string },
  b: { priority: TicketPriority; createdAt: string },
): number {
  if (a.priority !== b.priority) return a.priority === 'RUSH' ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt);
}
