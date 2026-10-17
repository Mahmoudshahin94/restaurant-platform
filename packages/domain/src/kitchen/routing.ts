import type { KitchenTicketStatus } from '@pos/shared-types';
import { DomainError } from '../errors';

export interface RoutableItem {
  id: string;
  /** Snapshot of the product's kitchen stations at ordering time. */
  stationIds: readonly string[];
}

/**
 * Splits order items into per-station queues. An item goes to every station its product is
 * assigned to (a burger to Kitchen and Grill); items without a station need no preparation and
 * are not sent to the kitchen. Item order is preserved within each station.
 */
export function routeItems<T extends RoutableItem>(items: readonly T[]): Map<string, T[]> {
  const routed = new Map<string, T[]>();
  for (const item of items) {
    for (const stationId of new Set(item.stationIds)) {
      const queue = routed.get(stationId);
      if (queue) queue.push(item);
      else routed.set(stationId, [item]);
    }
  }
  return routed;
}

export interface ExistingTicket {
  id: string;
  stationId: string;
  status: KitchenTicketStatus;
}

export interface TicketPlan {
  /** Stations that get a new ticket. */
  create: string[];
  /** Tickets whose items are rewritten (still NEW, or CANCELLED and reopened). */
  refresh: ExistingTicket[];
  /** NEW tickets whose station no longer has any items. */
  cancel: ExistingTicket[];
}

/**
 * Reconciles an order's tickets with its current items after an edit. Edits are only allowed
 * before the kitchen starts, so a ticket that is already being worked on is a conflict.
 */
export function planTickets(
  existing: readonly ExistingTicket[],
  routedStationIds: Iterable<string>,
): TicketPlan {
  const wanted = new Set(routedStationIds);
  const plan: TicketPlan = { create: [], refresh: [], cancel: [] };
  const byStation = new Map(existing.map((t) => [t.stationId, t]));
  const assertUntouched = (ticket: ExistingTicket) => {
    if (ticket.status !== 'NEW' && ticket.status !== 'CANCELLED') {
      throw new DomainError('INVALID_ORDER_STATE', 'The kitchen already started this order', {
        reason: 'KITCHEN_STARTED',
        stationId: ticket.stationId,
        ticketStatus: ticket.status,
      });
    }
  };

  for (const stationId of wanted) {
    const ticket = byStation.get(stationId);
    if (!ticket) {
      plan.create.push(stationId);
      continue;
    }
    assertUntouched(ticket);
    plan.refresh.push(ticket);
  }
  for (const ticket of existing) {
    if (wanted.has(ticket.stationId)) continue;
    assertUntouched(ticket);
    if (ticket.status === 'NEW') plan.cancel.push(ticket);
  }
  return plan;
}
