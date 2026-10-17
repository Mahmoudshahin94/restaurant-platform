# Realtime events

Typed in `packages/shared-types/src/events.ts` (`EventMap`, `RealtimeEvent<K>`). The cloud API and
the location hub serve the same socket (shared server code); in a restaurant the POS and KDS
connect to the hub on the LAN, so kitchen traffic never depends on the Internet.

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
| `order.created`                                    | Order created at the POS, or a website order received by the hub | POS (incoming-order prompt), KDS      | Phase 4 |
| `order.updated`                                    | Status, items or payments changed, incl. derived PREPARING/READY | POS, KDS, customer status (via cloud) | Phase 4 |
| `order.cancelled`                                  | Cancelled (with reason), incl. by the cloud's acceptance timeout | POS, KDS                              | Phase 4 |
| `order.payment_completed`                          | Balance reaches zero                                             | POS                                   | Phase 4 |
| `kitchen.ticket_created`                           | Ticket sent to a station (or reopened by an edit)                | KDS (chimes)                          | Phase 4 |
| `kitchen.ticket_started` / `_ready` / `_completed` | Kitchen action, or handover at the POS (`_completed`)            | KDS, POS                              | Phase 4 |
| `kitchen.ticket_updated`                           | Items edited, priority, line struck, undo/recall, dismissed      | KDS                                   | Phase 4 |
| `kitchen.ticket_cancelled`                         | Order cancelled, or an edit removed the station's items          | KDS                                   | Phase 4 |
| `sync.completed`                                   | The hub's push delivered operations (`processed`, `pending`)     | POS sync indicator and screen         | Phase 6 |
| `sync.failed`                                      | The cloud refused operations (`failed`, `lastError`)             | POS sync indicator and screen         | Phase 6 |
| `sync.status_changed`                              | The hub's indicator state changed (`state`, `pending`, `failed`) | POS sync indicator and screen         | Phase 6 |
| `restaurant.status_changed`                        | Online ordering state changed (typed; not emitted yet)           | — (the website polls)                 | Phase 7 |
| `menu.updated`                                     | The hub applied a new configuration snapshot                     | POS, KDS, customer web                | Phase 5 |

Website orders (Phase 7): the hub publishes `order.created` when it stores a website order from
the cloud's change feed (status `PLACED`, channel `WEBSITE`), and `order.updated` /
`order.cancelled` when the cloud changed it; the POS refreshes its incoming-orders prompt on any
`order.*` event (polling every 15 s is the fallback). Customers have no socket: the order-status
page polls `GET /orders/track` every 5 seconds until the order is final.

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
- Events are delivered in-process: one hub per site is exactly that; several cloud API instances
  would need a shared channel (e.g. Postgres LISTEN/NOTIFY) behind `RealtimeBus`.
