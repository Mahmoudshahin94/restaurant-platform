# Synchronization protocol

**Status:** implemented. Phase 5 built the hub, pairing (device credentials), provisioning by
location snapshot and the outbox; Phase 6 built the sync engine: push with exactly-once
application in the cloud, the change feed with long polling, retries, conflict detection, the POS
indicator and synchronization screen, and the cloud's record of refused operations. Phase 7 added
website orders: the `ORDER` topic of the change feed and the ownership hand-over on acceptance.
Design decisions: [ADR 0006](adr/0006-sync-protocol.md), [ADR 0012](adr/0012-sync-engine.md) and
[ADR 0013](adr/0013-online-ordering.md).

## Actors

- **Location hub** (`apps/gateway`): one per restaurant site. It owns the local SQLite
  database, the operational source of truth while offline.
- **Cloud API** (`apps/api`): owns PostgreSQL, the source of truth for synchronized data.

POS terminals and KDS screens never sync with the cloud directly; they talk to the hub.

## Outbox (hub → cloud)

Every mutation that must reach the cloud inserts a `sync_operations` row **in the same SQLite
transaction** as the mutation itself. If either fails, both roll back.

| column                         | meaning                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `id`                           | local row id                                              |
| `operation_id`                 | UUIDv7, the idempotency key, unique                       |
| `entity_type`, `entity_id`     | e.g. `Order`, `<uuid>`                                    |
| `operation_type`               | `ORDER_UPSERT`, `SHIFT_UPSERT`, `KITCHEN_TICKET_UPSERT`   |
| `payload`                      | the aggregate's full state after the change               |
| `entity_version`               | per-entity sequence of the hub's changes (1, 2, 3, …)     |
| `status`                       | `PENDING → PROCESSING → COMPLETED` or `FAILED`            |
| `retry_count`, `next_retry_at` | how often the cloud answered RETRY, and when to try again |
| `error_code`, `error_message`  | last failure; the POS translates the code                 |
| `created_at`, `processed_at`   | UTC timestamps                                            |

## Provisioning snapshot (Phase 5)

Pairing: an owner runs `pnpm --filter @pos/gateway pair --cloud <url> --email <owner> --location
<CODE>` on the hub machine. The cloud registers a `GATEWAY` device and returns its credential
once; the hub stores it in `hub_state` and authenticates every `/sync/*` call with it.

The hub pulls `GET /api/v1/sync/snapshot` at start-up, whenever the change feed reports a
configuration change (below), and every `HUB_SNAPSHOT_INTERVAL_SECONDS` as a safety net (default
1800), with `If-None-Match` so unchanged configuration costs a `304`. A new snapshot is applied in one transaction: rows are upserted by id in dependency
order, join tables and role grants are replaced, staff missing from the snapshot are deactivated,
and nothing referenced by local orders is ever deleted. A `menu.updated` event tells screens to
refresh. Without the cloud the hub keeps serving its last snapshot.

Outbox payloads are full aggregate rows: an order with items, modifiers, taxes, discounts, status
history and payments, each payment with the cash movements it caused (`ORDER_UPSERT`); a shift
with its cash movements (`SHIFT_UPSERT`); a kitchen ticket with its items
(`KITCHEN_TICKET_UPSERT`). `entityVersion` is a per-entity sequence, not the row's `version`,
because some changes (a second partial payment) do not bump the row's version.

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
      "baseVersion": 1,
      "payload": {}
    }
  ],
  "outbox": { "pending": 3, "failed": 0 }
}
```

**What the hub sends** (`apps/gateway/src/sync/plan-batch.ts`):

- **Newest state only.** Each operation carries the full state, so the hub sends only the newest
  pending operation of an entity. When the cloud accepts it, the older pending operations of the
  entity become `COMPLETED` too (superseded, never deleted).
- **Per-entity ordering.** An entity with a `FAILED` operation, or one waiting for its retry time,
  sends nothing; other entities continue.
- **Dependencies first.** An order whose payments reference a shift waits until that shift has
  nothing left to send, or goes after it in the same batch; a kitchen ticket waits for its order.
  Cash movements caused by a payment travel inside the payment, so shifts never wait for orders.
- Up to 25 operations per request. The push runs whenever the outbox grows (debounced), when the
  cloud comes back, and on "Sync now".

`baseVersion` is sent only for orders the hub received from the cloud (website orders, hub-only
table `inbound_orders`): the cloud version the hub's change was based on (see the hand-over below).

**What the cloud does** (`apps/api/src/modules/sync`): operations are processed **in order**,
each in its own PostgreSQL transaction:

1. Lock the operation's ledger row in `processed_operations` (primary key `operation_id`). If it
   is `APPLIED`, answer `DUPLICATE` without touching data.
2. Validate the payload against its schema (`@pos/validation` `syncOperationSchema`) and its
   scope: the restaurant and location must be the hub's own, children must belong to the
   aggregate.
3. Check ownership (below), lock the entity row, and store the state: scalar fields are written,
   lines, taxes, discounts and ticket items are replaced, status history, payments and cash
   movements are inserted by id and never updated or deleted.
4. Write the ledger row (`APPLIED`, with the row's `version`) in the same transaction.

If two deliveries of one operation race, the second cannot commit (the ledger's primary key or the
entity's) and is answered `DUPLICATE`. Database rules still apply: CHECK constraints refuse bad
data (`REJECTED`), a missing referenced row asks for a retry.

Results, one per operation:

| Result      | Meaning                                                | Hub action                                  |
| ----------- | ------------------------------------------------------ | ------------------------------------------- |
| `APPLIED`   | stored                                                 | `COMPLETED` (with the operations it covers) |
| `DUPLICATE` | already stored earlier                                 | `COMPLETED`                                 |
| `CONFLICT`  | the cloud's copy changed or is newer (`SYNC_CONFLICT`) | `FAILED`, entity held back                  |
| `REJECTED`  | invalid, out of scope or against a database rule       | `FAILED`, entity held back                  |
| `RETRY`     | try later (missing dependency, unexpected error)       | `PENDING` with backoff; `FAILED` after 10   |

`CONFLICT` and `REJECTED` are recorded in the ledger with their reason, for administrators
(`GET /locations/:lid/sync/issues`, `sync.view`). A refused operation that the hub retries later
is applied if its cause was fixed (the ledger row then becomes `APPLIED`). `RETRY` is not recorded.
The hub's reported outbox size is kept in the device's metadata.

## Pull (cloud → hub)

`GET /api/v1/sync/pull?cursor=<seq>&limit=100&wait=25` returns `change_log` entries with
`seq > cursor` for the hub's restaurant (location-wide or its own location), ordered by the
bigserial sequence, **never by timestamps**:

```json
{
  "changes": [
    { "seq": "42", "topic": "CONFIG", "entityId": null, "createdAt": "…" },
    { "seq": "43", "topic": "ORDER", "entityId": "<order id>", "createdAt": "…" }
  ],
  "cursor": "43",
  "hasMore": false
}
```

- **Producers.** PostgreSQL triggers on every table of the location snapshot record a `CONFIG`
  change for the restaurant in the writing transaction (one per transaction; writes that change
  nothing, or only `updated_at`/`last_login_at`, are ignored). No code path can forget it. The
  triggers hold a per-restaurant advisory lock until commit, so `seq` order is commit order and a
  cursor never passes a change that commits late.
- **Producers (`ORDER`, Phase 7).** The cloud's `ChangeRecorder` (`WebOrderChangeRecorder`)
  appends one `ORDER` entry per website order a transaction created or changed (creation, the
  acceptance timeout, a cloud staff action, a void after a rejection), with the order's
  `locationId`, under the same advisory lock. Orders pushed by hubs are not echoed back.
- **Consumer.** The hub handles a page in order: if it holds a `CONFIG` change it refreshes its
  snapshot first; then it fetches each announced website order once (`GET /sync/orders/:id`, the
  outbox payload shape; 404 for another location's order, which is skipped) and stores it (below).
  Then it stores the new cursor in `hub_state`. If anything cannot be fetched, the cursor stays
  and the page is seen again. An order whose products the hub does not have yet triggers one more
  snapshot refresh before it is stored.
- **Long poll** instead of a WebSocket "poke": with `wait`, the cloud holds the request until a
  change arrives (checking every second) or the wait ends. The hub keeps one such request open,
  so configuration changes arrive within seconds. Outbound HTTP only, no inbound port at the
  restaurant.
- **New hub.** Without a cursor the cloud answers with the head of the feed; the hub then takes a
  full snapshot and stores that head, so no change between the two is missed.

## Retry policy

- **Cloud unreachable** (network error, DNS failure, timeout, HTTP 5xx, 429): nothing is marked
  failed. The hub reports `OFFLINE`, keeps working, and tries again after
  `random(0, min(HUB_SYNC_RETRY_MAX_MS, HUB_SYNC_RETRY_BASE_MS × 2^n))` (full jitter; defaults
  2 s and 60 s, at least 0.5 s), both for the push and for the change feed. The first success
  sends everything that queued up. "Sync now" skips the wait.
- **Operation asked to retry** (`RETRY`): the operation waits `random(0, min(5 min, 2 s × 2^n))`;
  after 10 such answers it becomes `FAILED`.
- **Refused** (`CONFLICT`, `REJECTED`): `FAILED` with the error code and message. It is shown on
  the POS synchronization screen (and its cloud copy on the admin issues endpoint), holds back
  only its entity and the entities depending on it, and is never deleted. A manager retries it
  from the POS (`sync.view`); the newest state of the entity is then sent.
- **Crash safety:** operations left `PROCESSING` return to `PENDING` at start-up; the cloud answers
  `DUPLICATE` for any it had already applied.
- **Credential refused** (HTTP 401/403): the hub shows `SYNC_ERROR` ("re-pair it") and checks again
  occasionally.
- **Housekeeping:** completed operations keep their row (and sequence) but drop their payload after
  `HUB_OUTBOX_RETENTION_DAYS` (30).

## Conflict rules

| Data                                       | Authority                      | Rule                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Menu, prices, taxes, roles, configuration  | Cloud                          | The hub applies pulled changes; it never pushes them.                                                                                                                                |
| Item availability ("86") at a location     | Hub                            | Pushed as operational state; the cloud accepts it.                                                                                                                                   |
| Orders, shifts, tickets created at the hub | Hub (owner)                    | Applied if new to the cloud, or if the cloud's copy is what this hub last pushed (row `version` equals the ledger's); otherwise, or if `entity_version` goes backwards → `CONFLICT`. |
| Website orders                             | Cloud until accepted, then hub | The hub's first push hands the order over (accept or reject, on `baseVersion`); anything else before that is `CONFLICT` (see below).                                                 |
| Payments, refunds, cash transactions       | Append-only                    | Idempotent inserts keyed by id, so they cannot conflict.                                                                                                                             |
| Completed orders                           | Immutable                      | Only explicit refund/correction operations may follow.                                                                                                                               |

Timestamps never decide a conflict or identify duplicates: duplicates are recognised by
`operationId`, ownership by the ledger, ordering by `entity_version` and the feed's `seq`.
Shifts have no `version` column, so a shift changed in the cloud itself is not detected; nothing
in the cloud changes hub shifts today.

## Website orders (Phase 7)

```
Customer web ── POST /orders ──▶ Cloud: order PLACED (+ ORDER entry, + online payment)
                                   │ change feed (long poll)
Hub ◀── GET /sync/orders/:id ──────┘  stores it, inbound_orders.cloudVersion = v
 │ POS: accept → CONFIRMED (+ kitchen tickets) or reject → CANCELLED (reason)
 └── POST /sync/push { …, baseVersion: v } ──▶ Cloud: hand-over → hub owns it from now on
```

- **While the cloud owns the order** (it is `PLACED` and the hub has not pushed it), each `ORDER`
  entry replaces the hub's copy with the cloud's. The hub refuses staff edits of it
  (`AWAITING_ACCEPTANCE`) and acceptances after `acceptBy` (`ACCEPTANCE_EXPIRED`).
- **Hand-over.** The cloud accepts the hub's first write of a cloud-created row only if the row
  is a website order of that location, still `PLACED`, at exactly `baseVersion`, and the pushed
  state is no longer `PLACED` (the restaurant decided). The ledger then holds the hub's version and
  ordinary ownership applies. No or a different `baseVersion`, an edit while `PLACED`, or an order
  the cloud already decided are `CONFLICT`; a hub-invented website order is `REJECTED`.
- **The cloud decided first** (it cancelled the order at the acceptance deadline while the hub was
  offline and accepted it): the hub's push is a `CONFLICT`; when the cancellation arrives on the
  feed the hub adopts the cloud's copy, cancels the kitchen tickets it opened, and marks its own
  unsent operations of the order `COMPLETED` with `SYNC_SUPERSEDED`. Nothing waits for a manager.
- **After the hand-over** the hub owns the order. The cloud still settles its online payments: a
  rejection voids the charge (an append-only `REFUND` row) and announces the order; the hub merges
  only those payment rows and re-derives the payment status, without an outbox row.
- The acceptance timeout runs in the cloud (`WEB_ORDER_TIMEOUT_SWEEP_SECONDS`), 30 s after
  `acceptBy`, locking the order row first, so it and a hand-over never both win.

## Identifiers

All rows created offline use UUIDv7 generated on the hub. The cloud stores the same id, so no
local→cloud id remapping exists. Human-readable order numbers are per location and business day,
prefixed by source: `<LOCATIONCODE>-042` for hub orders, `W-017` for web orders.

## Connectivity indicator and synchronization screen (POS)

The hub derives one state (`GET /hub/status` → `state`), and announces changes with the realtime
events `sync.status_changed`, `sync.completed` and `sync.failed`:

| State        | When                                                    | Footer shows               |
| ------------ | ------------------------------------------------------- | -------------------------- |
| `SYNC_ERROR` | an operation is `FAILED`, or the credential was refused | `Sync error · 2 failed`    |
| `OFFLINE`    | the last contact with the cloud failed                  | `Offline · 3 pending`      |
| `SYNCING`    | operations are waiting or a push is running             | `Syncing · 5 pending`      |
| `ONLINE`     | nothing waiting, cloud reachable                        | `Online · 12 synchronized` |

"Synchronized" counts operations completed in the last 24 hours. The footer opens the
synchronization screen (`/sync`): state and figures (waiting, failed, synchronized, last contact,
next attempt, last error), "Sync now", and the outbox as tabs (waiting, failed, recently
synchronized) with the order number, error and attempts of each change. Anyone with
`orders.view` sees it and can "Sync now"; retrying a failed change needs `sync.view`.
