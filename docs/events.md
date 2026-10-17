# Realtime events

Typed in `packages/shared-types/src/events.ts` (`EventMap`, `RealtimeEvent<K>`). The same
contract is used on the hub's LAN WebSocket (POS ↔ hub ↔ KDS) and on the cloud socket.

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

| Event                                              | Emitted when                                        | Consumers                             |
| -------------------------------------------------- | --------------------------------------------------- | ------------------------------------- |
| `order.created`                                    | Order placed (POS or accepted web order)            | POS, KDS                              |
| `order.updated`                                    | Status/items changed, incl. derived PREPARING/READY | POS, KDS, customer status (via cloud) |
| `order.cancelled`                                  | Cancelled (with reason)                             | POS, KDS                              |
| `order.payment_completed`                          | Balance reaches zero                                | POS                                   |
| `kitchen.ticket_created`                           | Ticket routed to a station                          | KDS (station room)                    |
| `kitchen.ticket_started` / `_ready` / `_completed` | KDS action                                          | KDS, POS                              |
| `sync.completed` / `sync.failed`                   | Push/pull cycle finished                            | POS sync indicator, admin             |
| `restaurant.status_changed`                        | Online ordering state changed                       | POS, customer web                     |
| `menu.updated`                                     | Menu published/changed for a location               | POS, KDS, customer web                |

Rules:

- Events are published **after** the database transaction commits, never before.
- Events notify; they do not carry authority. A client that missed events re-fetches state.
- KDS subscribes to rooms per station (`location:<id>:station:<id>`) so a station screen only
  receives its own tickets.
