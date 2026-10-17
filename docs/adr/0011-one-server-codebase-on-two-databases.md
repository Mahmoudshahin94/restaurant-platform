# ADR 0011: One server codebase on PostgreSQL (cloud) and SQLite (location hub)

- Status: Accepted (2026-10-17)

## Context

The location hub (ADR 0001) must run orders, payments, shifts and the kitchen without the
Internet, on SQLite as the specification requires. The cloud API already implements all of this
on PostgreSQL. Re-implementing it for the hub would duplicate the orchestration around the domain
rules (idempotency, locking, audit, events, kitchen dispatch) and let the two drift apart, which
the specification forbids ("no duplicate logic").

Prisma 6 supports SQLite with enums and JSON. Only a handful of places in the API used
PostgreSQL-specific features: two raw SQL statements (row lock and order counter), a `uuid[]`
column, `instanceof` checks on the PostgreSQL client's error class, and `skipDuplicates`.

## Decision

- **The application layer is one package, `@pos/server`**, used by both `apps/api` (cloud) and
  `apps/gateway` (hub). Services receive the database client as an injected `PrismaService`
  token; the cloud provides its PostgreSQL client, the hub its SQLite client.
- **The hub's Prisma schema is generated from the cloud's** (`scripts/hub-schema.mjs`: switch the
  provider, drop `@db.*` column types, append hub-only models). A contract test compares the two
  generated clients model by model, field by field, so the hub client can safely stand in for the
  cloud client. Hub migrations are generated from that schema and applied by the hub itself at
  start-up (no Prisma CLI on restaurant PCs).
- **Database-specific SQL lives in one `SqlDialect`** (row lock, order counter). The hub opens
  SQLite with a single connection, so interactive transactions run one at a time and no row
  locks are needed. Errors are recognised by shape, not class.
- **Server mode** (`cloud` | `hub`): on the hub, controllers marked `@ManagedInCloud()` (menu,
  prices, floor plan, locations) are read-only (`MANAGED_IN_CLOUD`), and PIN sign-in exists only
  on the hub.
- **Change capture is a port** (`ChangeRecorder`): services report the orders, shifts and tickets
  a transaction changed; the hub writes full aggregate rows to its outbox in the same transaction,
  the cloud records nothing.
- **Provisioning before the change feed:** the hub is paired once (a pairing command issues it a
  device credential) and pulls a location snapshot (configuration, catalog, floor, staff with credential
  hashes) at start-up and periodically, applying it in one transaction. Phase 6 replaces this
  with the incremental change feed and pushes the outbox.

## Consequences

- Every rule and fix applies to cloud and hub at once; the API's integration tests exercise the
  shared code, and the hub suite runs the same flows on SQLite.
- Schema changes need one extra step: regenerate the hub schema and write a hub migration
  (`pnpm --filter @pos/database hub:schema` and `hub:migration <name>`); the contract test fails
  otherwise.
- The hub stores staff password and PIN hashes so staff can sign in offline. The hub machine
  must be treated as trusted (disk encryption at rest is future hardening).
- SQLite-specific behaviour (single writer, text enums without CHECK constraints) is accepted for
  a single-location workload; database CHECK constraints exist only in the cloud for now.
