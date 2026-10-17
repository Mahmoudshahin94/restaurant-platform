import type { OnlineOrderingState } from '@pos/shared-types';
import { DomainError } from '../errors';
import { type OpeningWindow, isWithinOpeningHours } from './opening-hours';

/** Why online ordering is not open (null when it is). */
export type OnlineOrderingReason =
  'LOCATION_INACTIVE' | 'SETTING_CLOSED' | 'SETTING_PAUSED' | 'OUTSIDE_HOURS' | 'HUB_OFFLINE';

export interface OnlineOrderingInput {
  /** What the restaurant chose in its settings (OPEN, PAUSED or CLOSED). */
  setting: OnlineOrderingState;
  isActive: boolean;
  openingHours: readonly OpeningWindow[];
  timeZone: string;
  /** Last time the location's hub talked to the cloud (its heartbeat); null if never. */
  hubLastSeenAt: Date | null;
  /** A hub silent for longer than this is offline. */
  hubStaleAfterMs: number;
  now: Date;
}

export interface OnlineOrderingStatus {
  state: OnlineOrderingState;
  reason: OnlineOrderingReason | null;
}

/**
 * What a customer sees for a location (ADR 0013). The restaurant's own choice comes first (closed,
 * then paused), then its opening hours; an open restaurant whose hub stopped talking to the cloud
 * is OFFLINE, because a new order could not reach the kitchen.
 */
export function onlineOrderingStatus(input: OnlineOrderingInput): OnlineOrderingStatus {
  if (!input.isActive) return { state: 'CLOSED', reason: 'LOCATION_INACTIVE' };
  if (input.setting === 'CLOSED') return { state: 'CLOSED', reason: 'SETTING_CLOSED' };
  if (input.setting === 'PAUSED') return { state: 'PAUSED', reason: 'SETTING_PAUSED' };
  if (!isWithinOpeningHours(input.openingHours, input.timeZone, input.now)) {
    return { state: 'CLOSED', reason: 'OUTSIDE_HOURS' };
  }
  const seen = input.hubLastSeenAt?.getTime();
  if (
    input.setting === 'OFFLINE' ||
    seen === undefined ||
    input.now.getTime() - seen > input.hubStaleAfterMs
  ) {
    return { state: 'OFFLINE', reason: 'HUB_OFFLINE' };
  }
  return { state: 'OPEN', reason: null };
}

/** Refuses a new website order unless ordering is open. */
export function assertOnlineOrderingOpen(status: OnlineOrderingStatus): void {
  if (status.state === 'OPEN') return;
  if (status.state === 'OFFLINE') {
    throw new DomainError('RESTAURANT_OFFLINE', 'The restaurant cannot receive orders right now', {
      reason: status.reason,
    });
  }
  throw new DomainError('ONLINE_ORDERING_DISABLED', 'Online ordering is not available', {
    state: status.state,
    reason: status.reason,
  });
}
