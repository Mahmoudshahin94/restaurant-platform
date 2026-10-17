# Synchronization protocol

**Status:** Phase 5 implemented the hub, pairing (device credentials), provisioning by full
location snapshot (`GET /sync/snapshot`, below) and the outbox: every hub change writes its
`sync_operations` row in the same transaction. Phase 6 implements push, the change feed and the
connectivity states below; the snapshot remains for first provisioning and recovery.

## Actors

- **Location hub** (`apps/gateway`): one per restaurant site. It owns the local SQLite
  database, the operational source of truth while offline.
- **Cloud API** (`apps/api`): owns PostgreSQL, the source of truth for synchronized data.

POS terminals and KDS screens never sync with the cloud directly; they talk to the hub.

## Outbox (hub → cloud)

Every mutation that must reach the cloud inserts a `sync_operations` row **in the same SQLite
transaction** as the mutation itself. If either fails, both roll back.

| column                                          | meaning                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `id`                                            | local row id                                                     |
| `operation_id`                                  | UUIDv7, the idempotency key, unique                              |
| `entity_type`, `entity_id`                      | e.g. `Order`, `<uuid>`                                           |
| `operation_type`                                | e.g. `ORDER_UPSERT`, `PAYMENT_RECORDED`, `ITEM_AVAILABILITY_SET` |
| `payload`                                       | JSON snapshot needed to apply the operation                      |
| `entity_version`                                | hub-side version for optimistic concurrency                      |
| `status`                                        | `PENDING → PROCESSING → COMPLETED` or `FAILED`                   |
| `retry_count`, `next_retry_at`, `error_message` | retry bookkeeping                                                |
| `created_at`, `processed_at`                    | UTC timestamps                                                   |

## Provisioning snapshot (Phase 5)

Pairing: an owner runs `pnpm --filter @pos/gateway pair --cloud <url> --email <owner> --location
<CODE>` on the hub machine. The cloud registers a `GATEWAY` device and returns its credential
once; the hub stores it in `hub_state` and authenticates every `/sync/*` call with it.

The hub then pulls `GET /api/v1/sync/snapshot` at start-up and every
`HUB_SNAPSHOT_INTERVAL_SECONDS` (default 300), with `If-None-Match` so unchanged configuration
costs a `304`. A new snapshot is applied in one transaction: rows are upserted by id in dependency
order, join tables and role grants are replaced, staff missing from the snapshot are deactivated,
and nothing referenced by local orders is ever deleted. A `menu.updated` event tells screens to
refresh. Without the cloud the hub keeps serving its last snapshot.

Outbox payloads are full aggregate rows: an order with items, modifiers, taxes, discounts, status
history and payments (`ORDER_UPSERT`, `entityVersion` = order version); a shift with its cash
transactions (`SHIFT_UPSERT`); a kitchen ticket with its items (`KITCHEN_TICKET_UPSERT`).

## Push

`POST /api/v1/sync/push` authenticated as the hub device:

```json
{
  "operations": [
    {
      "operationId": "…",
      "entityType": "Order",
      "entityId": "…",
      "operationType": "ORDER_UPSERT",
      "entityVersion": 3,
      "payload": {}
    }
  ]
}
```

The server processes operations **in order**, each in its own Postgres transaction:

1. `INSERT INTO processed_operations (operation_id, …)`. A unique violation means "already
   applied": return the stored result instead (status `DUPLICATE`, which counts as success for
   the hub).
2. Apply the operation through the same application services the API uses, with ownership and
   version checks.
3. Store the result and append to `change_log` in the same transaction.

The response lists a result per operation: `APPLIED | DUPLICATE | CONFLICT | REJECTED`.
Idempotency is enforced by the database constraint, never by the client.

## Pull (cloud → hub)

`GET /api/v1/sync/pull?cursor=<seq>&limit=…` returns `change_log` entries with `seq > cursor`
for the hub's location: menu changes, configuration, website orders and cloud-side status
changes. The hub applies them and stores the new cursor in `sync_state`. Ordering comes from the
bigserial sequence, **never from timestamps**.

To avoid polling latency, the hub keeps an outbound WebSocket to the cloud. The cloud sends a
"poke" when new changes exist for the location, and the hub then pulls. If the socket is down,
the hub falls back to periodic pulls.

## Retry policy

- Transient failures (network error, DNS failure, timeout, HTTP 5xx, 429):
  `delay = random(0, min(cap, base × 2^retryCount))` (full jitter), with base 2 s and cap 5 min.
- Permanent failures (HTTP 4xx validation, `REJECTED`, `CONFLICT`): status `FAILED`, with the
  error kept. They are shown in the POS sync screen and the admin Synchronization page, and are
  never deleted. An administrator can retry or resolve them.
- **Per-entity ordering**: an operation is not sent while an earlier operation for the same
  `entity_id` is `PENDING` or `FAILED`. Other entities continue.

## Conflict rules

| Data                                      | Authority                      | Rule                                                                          |
| ----------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Menu, prices, taxes, roles, configuration | Cloud                          | The hub applies pulled changes; it never pushes them.                         |
| Item availability ("86") at a location    | Hub                            | Pushed as operational state; the cloud accepts it.                            |
| Orders created at the hub                 | Hub (owner)                    | The cloud accepts newer `entity_version`s; stale versions → `CONFLICT`.       |
| Website orders                            | Cloud until accepted, then hub | Accepting transfers ownership; the cloud rejects hub edits before acceptance. |
| Payments, refunds, cash transactions      | Append-only                    | Idempotent inserts keyed by id, so they cannot conflict.                      |
| Completed orders                          | Immutable                      | Only explicit refund/correction operations may follow.                        |

Timestamps alone never decide a conflict or identify duplicates.

## Identifiers

All rows created offline use UUIDv7 generated on the hub. The cloud stores the same id, so no
local→cloud id remapping exists. Human-readable order numbers are per location and business day,
prefixed by source: `<LOCATIONCODE>-042` for hub orders, `W-017` for web orders.

## Connectivity indicator (POS)

| State        | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| `ONLINE`     | Last push/pull succeeded; shows the synchronized count                           |
| `OFFLINE`    | Cloud unreachable; shows pending operations                                      |
| `SYNCING`    | Push or pull in progress; shows pending                                          |
| `SYNC_ERROR` | One or more operations `FAILED`; shows the failed count; opens the detail screen |
