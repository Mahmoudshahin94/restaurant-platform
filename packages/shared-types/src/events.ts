import type {
  KitchenTicketStatus,
  OnlineOrderingState,
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  SyncConnectionState,
} from './enums';

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
  paymentStatus: PaymentStatus;
  version: number;
}

export interface KitchenTicketEventPayload {
  ticketId: string;
  orderId: string;
  orderNumber: string;
  stationId: string;
  status: KitchenTicketStatus;
  version: number;
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
  /** Items changed (order edited before the kitchen started), priority changed, or recalled. */
  'kitchen.ticket_updated': KitchenTicketEventPayload;
  'kitchen.ticket_cancelled': KitchenTicketEventPayload;
  /** The hub's sync engine delivered operations to the cloud. */
  'sync.completed': { processed: number; pending: number };
  /** The cloud refused operations; they wait in the outbox as FAILED. */
  'sync.failed': { failed: number; lastError: string };
  /** The hub's indicator state changed (e.g. the cloud became unreachable or came back). */
  'sync.status_changed': { state: SyncConnectionState; pending: number; failed: number };
  'tenant.status_changed': { locationId: string; state: OnlineOrderingState };
  'menu.updated': { locationId: string; version: string };
}

export type EventType = keyof EventMap;

export interface RealtimeEvent<K extends EventType = EventType> {
  /** UUIDv7; consumers de-duplicate on it. */
  eventId: string;
  type: K;
  tenantId: string;
  locationId: string;
  /** ISO-8601 UTC. */
  occurredAt: string;
  payload: EventMap[K];
}
