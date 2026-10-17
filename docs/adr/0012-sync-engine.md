# ADR 0012: Sync engine: state-based push, ownership by version history, config change feed

- Status: Accepted (2026-10-17)

## Context

Phase 5 left every hub change in the outbox (`sync_operations`) as a full aggregate row (an order
with its lines, taxes, discounts, history and payments; a shift with its cash movements; a kitchen
ticket with its items), and kept the hub's configuration current by polling the location snapshot
every five minutes. Phase 6 must send the outbox to the cloud exactly once, survive any network
failure, never lose or silently overwrite data, show administrators what failed, and bring cloud
changes to the hub promptly. ADR 0006 fixed the principles (outbox, idempotent push keyed by
`operationId`, cursor pull, ownership-based conflicts); this ADR records how they are built.

## Decision

### Push (hub → cloud)

- **State-based replication.** An operation carries the entity's full state after the change, not
  a command. The cloud does not re-run the command (prices were already computed by the same
  domain code on the hub, and must not change after the fact); it checks the operation and stores
  the state. Append-only children (status history, payments, cash movements) are inserted by id
  and never updated or deleted; replaceable children (order lines, taxes, discounts, ticket items)
  are replaced.
- **Coalescing.** Because each operation is a full state, the hub sends only the newest pending
  operation of an entity; when the cloud accepts it, the older pending operations of that entity
  are marked `COMPLETED` (superseded), never deleted. An order edited ten times offline costs one
  upload.
- **Exactly once.** The cloud's `processed_operations` ledger is keyed by `operationId`. Applying
  an operation and writing its ledger row happen in one PostgreSQL transaction; a repeated
  `operationId` returns `DUPLICATE` without touching data, and two concurrent deliveries of the
  same operation cannot both commit (the primary key rejects the second, which rolls back).
  Refused operations are recorded too (`CONFLICT`/`REJECTED`, with the reason) and may be applied
  later if the hub retries them after the cause is fixed.
- **Ownership without timestamps.** The cloud applies a hub operation for an entity only if the
  entity is new to the cloud, or if the cloud's copy is exactly what that location's hub last
  pushed (its `version` equals the last applied `entityVersion` in the ledger). A cloud copy the
  hub never pushed, or one changed in the cloud since, is a `CONFLICT`: both sides changed it and
  a person must decide. An operation older than what the cloud already has is accepted as a
  no-op (`APPLIED`, superseded), since the newer state contains it.
- **Dependencies.** An order's payments reference shifts and a kitchen ticket references its
  order, so the hub does not send an entity while an entity it depends on still has unsent or
  failed operations; dependencies go first in the same batch. Cash movements created by a payment
  travel with the order (inside the payment), so shifts never depend on orders.
- **Failure handling.** Network errors, timeouts, HTTP 5xx and 429 are transient: the batch is
  retried with exponential backoff and full jitter, and the hub reports `OFFLINE`. `CONFLICT`,
  `REJECTED` and HTTP 4xx are permanent for that operation: it becomes `FAILED` with the reason,
  stops only its own entity (and entities depending on it), and stays until someone retries it
  from the POS sync screen. Nothing is dropped. Operations left `PROCESSING` by a crash return to
  `PENDING` at start-up; idempotency makes the resend safe.

### Pull (cloud → hub)

- **Change feed.** The cloud keeps `change_log` (`seq` bigserial). In Phase 6 its producer is a
  set of PostgreSQL triggers on every table of the location snapshot (configuration, catalog,
  floor, staff): any write, from any code path, records a `CONFIG` change for the restaurant in
  the same transaction (one row per transaction). The triggers take a per-restaurant advisory lock
  until commit, so `seq` order equals commit order within a restaurant and a cursor can never skip
  a change that commits late.
- **The snapshot is the payload of a `CONFIG` change.** The hub reacts by fetching the location
  snapshot (`ETag`, so unrelated changes cost a `304`) and applying it in one transaction. A full
  replacement keeps join tables and deactivations consistent without per-table diff logic, and a
  location's configuration is small. The periodic snapshot check stays as a safety net (default
  every 30 minutes instead of 5).
- **Long polling instead of a WebSocket poke.** `GET /sync/pull?cursor=…&wait=25` answers as soon
  as there is a change after the cursor, or after 25 seconds with none. It is outbound HTTP only
  (no inbound port at the restaurant), uses the same device credential, needs no connection
  state in the cloud, and its fallback is itself. The cloud checks for new rows every second
  while a request waits; PostgreSQL `LISTEN/NOTIFY` can replace this when many hubs connect.
- **Cursor.** Stored in the hub's `hub_state` after the change is handled. A hub without a cursor
  first takes the head of the feed, then refreshes its snapshot, so nothing between the two is
  missed.
- Cloud-originated orders (website orders) will use the same feed with an `ORDER` topic in
  Phase 7, together with the ownership hand-over on acceptance.

### Status

The hub derives one state from its outbox and its last contact with the cloud: `SYNC_ERROR` when
any operation failed, else `OFFLINE` when the cloud is unreachable, else `SYNCING` while
operations are pending, else `ONLINE`. It publishes `sync.completed` / `sync.failed` to its
screens, and reports its pending and failed counts to the cloud with every push (device
metadata) for the admin portal.

## Consequences

- The cloud trusts the hub's computed prices and totals. The hub is an authenticated device of
  the restaurant running the same domain code; the cloud still checks tenancy, location,
  ownership, versions and referential integrity, and validates every payload against a schema.
- Hub audit-log rows stay on the hub in Phase 6 (they are not part of the outbox); shipping them
  is Phase 10 hardening.
- Orders created for the same location directly in the cloud on the same business day can
  collide with hub order numbers (`<CODE>-NNN`); the push then reports a `CONFLICT`. Website orders
  use their own prefix (Phase 7), so this needs a misuse of the cloud API.
- The feed's waiting requests poll PostgreSQL once a second each; acceptable for tens of hubs per
  API instance, to be replaced by `LISTEN/NOTIFY` before scaling out.
