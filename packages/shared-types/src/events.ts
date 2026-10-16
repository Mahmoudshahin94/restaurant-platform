import type { KitchenTicketStatus, OnlineOrderingState, OrderChannel, OrderStatus } from './enums';

/**
 * Typed realtime events, used on the hub LAN WebSocket (POS/KDS) and the cloud socket.
 * Payloads carry identifiers and the state that changed; consumers fetch full aggregates when
 * they need more. Payloads grow with the phase that implements each feature.
 */
export interface OrderEventPayload {
  orderId: string;
  orderNumber: string;
  channel: OrderChannel;
  status: OrderStatus;
}

export interface KitchenTicketEventPayload {
  ticketId: string;
  orderId: string;
  stationId: string;
  status: KitchenTicketStatus;
}

export interface EventMap {
  'order.created': OrderEventPayload;
  'order.updated': OrderEventPayload;
  'order.cancelled': OrderEventPayload & { reason: string | null };
  'order.payment_completed': OrderEventPayload & { paidAmount: number };
  'kitchen.ticket_created': KitchenTicketEventPayload;
  'kitchen.ticket_started': KitchenTicketEventPayload;
  'kitchen.ticket_ready': KitchenTicketEventPayload;
  'kitchen.ticket_completed': KitchenTicketEventPayload;
  'sync.completed': { processed: number; pending: number };
  'sync.failed': { failed: number; lastError: string };
  'restaurant.status_changed': { locationId: string; state: OnlineOrderingState };
  'menu.updated': { locationId: string; version: string };
}

export type EventType = keyof EventMap;

export interface RealtimeEvent<K extends EventType = EventType> {
  /** UUIDv7; consumers de-duplicate on it. */
  eventId: string;
  type: K;
  restaurantId: string;
  locationId: string;
  /** ISO-8601 UTC. */
  occurredAt: string;
  payload: EventMap[K];
}
