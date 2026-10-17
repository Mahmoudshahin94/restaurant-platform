import type { RealtimeEvent } from '@pos/shared-types';
import type { PrismaTx } from './prisma.service';

/** Aggregates changed by one transaction. */
export interface ChangeSet {
  orderIds?: Iterable<string>;
  shiftIds?: Iterable<string>;
  ticketIds?: Iterable<string>;
}

/**
 * Captures changes that must leave this node, inside the transaction that made them. The location
 * hub writes them to its sync outbox (so a change and its outbox row commit or roll back
 * together); the cloud is the destination and records nothing.
 */
export abstract class ChangeRecorder {
  abstract record(tx: PrismaTx, changes: ChangeSet): Promise<void>;
}

export class NoopChangeRecorder extends ChangeRecorder {
  record(): Promise<void> {
    return Promise.resolve();
  }
}

/** Ticket ids touched by a list of kitchen events (as returned by kitchen dispatch). */
export function ticketIdsOf(events: readonly RealtimeEvent[]): string[] {
  return events.flatMap((e) =>
    e.type.startsWith('kitchen.') && 'ticketId' in e.payload ? [e.payload.ticketId] : [],
  );
}
