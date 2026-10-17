# Realtime events

Typed in `packages/shared-types/src/events.ts` (`EventMap`, `RealtimeEvent<K>`). The same
contract is used on the cloud socket today and on the hub's LAN WebSocket (POS ↔ hub ↔ KDS) from
Phase 5.

Envelope:

```ts
interface RealtimeEvent<K extends EventType> {
  eventId: string; // UUIDv7 — consumers de-duplicate on it
  type: K;
  restaurantId: string;
  locationId: string;
  occurredAt: string; // ISO-8601 UTC
  payload: EventMap[K];
}
```

Order payloads carry `{ orderId, orderNumber, channel, status, paymentStatus, version }`; kitchen
payloads carry `{ ticketId, orderId, orderNumber, stationId, status, version }`.

| Event                                              | Emitted when                                                     | Consumers                             | Since   |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- | ------- |
| `order.created`                                    | Order created (POS or accepted web order)                        | POS, KDS                              | Phase 4 |
| `order.updated`                                    | Status, items or payments changed, incl. derived PREPARING/READY | POS, KDS, customer status (via cloud) | Phase 4 |
| `order.cancelled`                                  | Cancelled (with reason)                                          | POS, KDS                              | Phase 4 |
| `order.payment_completed`                          | Balance reaches zero                                             | POS                                   | Phase 4 |
| `kitchen.ticket_created`                           | Ticket sent to a station (or reopened by an edit)                | KDS (chimes)                          | Phase 4 |
| `kitchen.ticket_started` / `_ready` / `_completed` | Kitchen action, or handover at the POS (`_completed`)            | KDS, POS                              | Phase 4 |
| `kitchen.ticket_updated`                           | Items edited, priority, line struck, undo/recall, dismissed      | KDS                                   | Phase 4 |
| `kitchen.ticket_cancelled`                         | Order cancelled, or an edit removed the station's items          | KDS                                   | Phase 4 |
| `sync.completed` / `sync.failed`                   | Push/pull cycle finished                                         | POS sync indicator, admin             | Phase 6 |
| `restaurant.status_changed`                        | Online ordering state changed                                    | POS, customer web                     | Phase 7 |
| `menu.updated`                                     | Menu published/changed for a location                            | POS, KDS, customer web                | later   |

## Socket protocol (`GET /api/v1/realtime`, WebSocket)

1. The client opens the socket and sends `{ "type": "auth", "token": "<access token>",
"locationId": "<uuid>" }` within 10 s. The token never goes in the URL, so it stays out of logs.
2. The server checks the token, the location's tenant and a viewing permission (`kitchen.view`
   or `orders.view`), then answers `{ "type": "ready", "locationId" }` and streams
   `{ "type": "event", "event": RealtimeEvent }` for that location.
3. `{ "type": "ping" }` gets `{ "type": "pong" }`; the server also pings every 30 s and drops
   silent clients.
4. Close codes: `4401` token invalid or expired (refresh, then reconnect), `4403` no access to the
   location (do not retry), `4400` malformed message or no auth in time.

`connectRealtime` in `@pos/api-client` implements this (reconnect with jittered backoff, token
refresh on 4401, de-duplication by `eventId`), and `useRealtime` in `@pos/app-kit` wraps it for
React.

Because authentication uses an explicit token rather than cookies, a page on another origin
cannot ride on a signed-in user's session, so the Origin header is not used for authorization.

## Rules

- Events are published **after** the database transaction commits, never before.
- Events notify; they do not carry authority. Clients re-fetch what they display, and keep a slow
  polling fallback for a dropped connection.
- A screen subscribes per location and filters by station itself (payloads carry `stationId`).
  Station-level rooms can be added in the hub if LAN traffic ever matters.
- The cloud API delivers events in-process: one API instance is assumed until the hub takes over
  LAN delivery (Phase 5). Several instances need a shared channel (e.g. Postgres LISTEN/NOTIFY)
  behind `RealtimeBus`.
