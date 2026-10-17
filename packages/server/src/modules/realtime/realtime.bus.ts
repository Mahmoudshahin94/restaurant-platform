import { Injectable, Logger } from '@nestjs/common';
import { newId } from '@pos/domain';
import type { EventMap, EventType, RealtimeEvent } from '@pos/shared-types';

type Listener = (event: RealtimeEvent) => void;

export interface EventScope {
  restaurantId: string;
  locationId: string;
}

/**
 * In-process publish/subscribe for realtime events, keyed by location. Services collect events
 * while they work and publish them only after their transaction commits, so subscribers never
 * see a change that was rolled back.
 *
 * One API instance is assumed until the location hub takes over LAN delivery (Phase 5); running
 * several API instances needs a shared channel (e.g. Postgres LISTEN/NOTIFY) behind this class.
 */
@Injectable()
export class RealtimeBus {
  private readonly logger = new Logger(RealtimeBus.name);
  private readonly listeners = new Map<string, Set<Listener>>();

  event<K extends EventType>(type: K, scope: EventScope, payload: EventMap[K]): RealtimeEvent<K> {
    return {
      eventId: newId(),
      type,
      restaurantId: scope.restaurantId,
      locationId: scope.locationId,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  subscribe(locationId: string, listener: Listener): () => void {
    let set = this.listeners.get(locationId);
    if (!set) {
      set = new Set();
      this.listeners.set(locationId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(locationId);
    };
  }

  publish(events: readonly RealtimeEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners.get(event.locationId) ?? []) {
        try {
          listener(event);
        } catch (error) {
          // One broken subscriber must not stop delivery to the others.
          this.logger.warn(`Realtime listener failed: ${String(error)}`);
        }
      }
    }
  }

  subscriberCount(locationId: string): number {
    return this.listeners.get(locationId)?.size ?? 0;
  }
}
