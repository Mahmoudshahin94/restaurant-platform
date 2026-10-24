# Architecture

**MADAR** (powered by JudyTech): a multi-tenant, offline-first commerce platform. One codebase
serves many independent tenants (restaurants, coffee shops, supermarkets, clothing and other
stores) with a POS, Kitchen Display System (KDS), customer online ordering, admin portal, cloud
API, and a per-location hub. Arabic and English with full RTL.

> The platform began as a single-restaurant system (Phases 0–10 below). The MADAR expansion
> generalizes it in ten further phases, M1–M10; see the
> [migration plan](madar/migration-plan.md) and [§11](#11-madar-expansion).

> Status: Phases 0–10 (foundations, menu, POS, payments, KDS, location hub, sync engine, customer
> website and online ordering, admin portal, reporting, hardening with the full end-to-end suite)
> are implemented. See the [phase checklist](#10-development-phases) at the end, the
> [testing guide](testing.md) and the [release checklist](release.md).

## 1. Starting point

The repository was empty when work began (October 2026). Every decision below was made for this
codebase; there was no legacy code to preserve.

## 2. System architecture

```
Customer Web ─┐                          ┌─ Admin
              ▼                          ▼
        Cloud API (NestJS + Fastify, modular monolith) ── PostgreSQL (source of truth for synced data)
              ▲   ▲  outbound HTTP long poll (hub → cloud; the location opens no inbound ports)
   REST push  │   │  REST pull (cursor-based change feed)
              │   │
        Location Hub (apps/gateway, Node) ── SQLite (operational source of truth while offline)
         │  REST + WebSocket on the location LAN      │  PrinterService (ESC/POS network/USB adapters)
         ├── POS terminals (Tauri 2 + React) × N
         └── KDS screens (React, any tablet browser, served by the hub) × N
```

Principles:

- **A location never depends on the cloud.** POS and KDS talk only to the location hub.
  The hub syncs with the cloud independently, retrying with backoff while the Internet is down.
- **Business rules live in `packages/domain` only.** It is pure TypeScript with no I/O. The API,
  the hub and the UIs import the same functions: money, pricing, the order state machine, menu
  selection validation, permission resolution, and (later) kitchen routing and sync conflict
  rules. The server side (API or hub) is authoritative. UIs use the domain only for previews.
- **Thin adapters.** Controllers validate input with Zod contracts from `packages/validation`,
  then call application services. Those services orchestrate domain functions and persistence.
  Controllers never contain business logic.
- **The gateway contains no business rules.** It is a transport and runtime host (WebSocket,
  device registry, printers, health) plus an application layer that calls `packages/domain`.
- **Modular monolith, not microservices.** NestJS modules are bounded contexts (auth, audit,
  tenants, locations, menu, and later orders, payments, kitchen, sync...). They share one
  database and one deployment.

See [ADR 0001](adr/0001-location-hub-owns-sqlite.md) for why the hub, not each POS terminal,
owns the local database.

## 3. Repository layout

```
apps/
  api/            NestJS + Fastify cloud API                         (Phase 0–1: implemented)
  admin/          React admin portal                                 (Phases 1, 8, 9)
  gateway/        Location hub: SQLite, sync engine, LAN WS, printers (Phase 5–6)
  pos/            Tauri 2 + React point of sale                      (Phase 2: order entry)
  kds/            React kitchen display                              (Phase 4)
  customer-web/   React customer ordering site (cloud API only)       (Phase 7)
packages/
  shared-types/   Enums, permission catalog, error codes, realtime event contracts
  validation/     Zod schemas — the API contract (types via z.infer)
  domain/         Pure business logic + unit tests
  api-client/     Typed fetch client (refresh-and-retry, typed errors)
  app-kit/        Shared React plumbing: session client (web/native), i18n bootstrap, errors, money
  database/       Prisma schema, migrations, seed, credential hashing
  ui/             shadcn/ui-style components, Tailwind v4 theme, RTL via logical properties
  i18n/           i18next setup, en/ar resources, direction + Intl formatting
tools/eslint-rules/  Repository-local lint rules (e.g. no untranslated JSX text)
docs/             This documentation and ADRs
infrastructure/   docker-compose.yml, .env.example
```

Tooling: pnpm workspaces + Turborepo. Libraries build with tsup (ESM + CJS for the NestJS
consumer). TypeScript runs in strict mode with `noUncheckedIndexedAccess`. Linting uses ESLint 9
flat config with `typescript-eslint` strict-type-checked plus the local
`pos-local/no-untranslated-jsx` rule. Prettier formats. Vitest is the test runner everywhere,
NestJS included, via SWC for decorator metadata. Playwright runs end-to-end tests.

Pinned major versions were chosen for stability: TypeScript 5.9, NestJS 11, Prisma 6, Zod 4,
React 19, Vite 7, Vitest 3, Tailwind 4. Newer majors (TypeScript 7, NestJS 12, Prisma 8) existed
at project start. They are deliberately deferred until the platform is feature-complete.

## 4. Domain model

See [domain-model.md](domain-model.md) for the ERD and per-entity notes. Conventions:

- IDs are **UUIDv7**, generated by whichever node creates the row. The hub creates orders
  offline, and the same id is used in the cloud ([ADR 0003](adr/0003-uuidv7-identifiers.md)).
- Timestamps are `timestamptz` in **UTC**. Conversion to the location timezone happens only in
  the presentation layer (`@pos/i18n` `formatDateTime`).
- Money is an **integer in minor units** of the tenant currency. The exponent comes from
  ISO 4217, so it is 2 for SAR and 3 for KWD. Rates and percentage discounts are **basis points**
  (1500 = 15%). No floating-point arithmetic touches money
  ([ADR 0002](adr/0002-money-integer-minor-units.md)).
- Tenant rows carry `tenantId`; location-sensitive rows also carry `locationId`.
- Catalog rows are archived (`archivedAt`), never deleted. Financial rows are never deleted or
  updated in place; corrections are new rows.
- Localized menu content uses relational columns (`nameEn`, `nameAr`, `descriptionEn`,
  `descriptionAr`), not JSON blobs ([ADR 0004](adr/0004-localized-columns.md)).

## 5. Order lifecycle

```
DRAFT → PLACED → CONFIRMED → PREPARING → READY → COMPLETED → (REFUNDED)
   └──────┴──────────┴───────────┴→ CANCELLED
```

- The transition table lives in `packages/domain` (Phase 2) with guards and required
  permissions. Arbitrary status changes are impossible.
- Every transition writes an `OrderStatusHistory` row (from, to, actor, source, reason, at) and
  an `AuditLog` entry.
- **Payment status is separate** (`UNPAID / PARTIALLY_PAID / PAID / PARTIALLY_REFUNDED /
REFUNDED`). `COMPLETED` requires balance due = 0, which supports both pay-later dine-in and
  pay-first takeaway. Cancelling from `PREPARING` requires `orders.cancel` and a reason.
- `PREPARING` and `READY` are **derived from kitchen tickets**: the first ticket started moves
  the order to `PREPARING`, and all tickets ready moves it to `READY`.
- One `Order` table serves every channel (`DINE_IN`, `TAKEAWAY`, `PHONE`, `WEBSITE`,
  `DELIVERY`). Marketplaces (`UBER_EATS`, `TALABAT`, ...) are added as enum values, never as new
  tables.

## 6. Offline synchronization

Summary (full protocol in [sync.md](sync.md)):

- The hub writes every cloud-bound mutation to `sync_operations` (the outbox) **in the same
  SQLite transaction** as the change.
- **Push:** `POST /api/v1/sync/push` with batches of operations keyed by `operationId`, each
  carrying an aggregate's full state (newest per entity, dependencies first). The cloud records
  each one in `ProcessedOperation` (primary key `operationId`) inside the transaction that applies
  it. A replay answers `DUPLICATE`, so duplicates are impossible even when requests race.
- **Pull:** `GET /api/v1/sync/pull?cursor=` reads a monotonic `ChangeLog` sequence, never
  timestamps, filled by database triggers on configuration tables. The hub keeps a long poll open,
  so changes arrive within seconds, and refreshes its snapshot on a `CONFIG` change.
- **Retries:** transient failures use exponential backoff with full jitter. Permanent failures
  become `FAILED`, are shown to administrators, and are never dropped. Ordering is per entity.
- **Conflicts** follow explicit ownership rules (menu → cloud; 86/availability → hub; local
  orders → hub; website orders → cloud until accepted). Stale writes are rejected with
  `SYNC_CONFLICT` and never overwritten.

## 7. API boundary

Summary (details in [api.md](api.md)):

- REST under `/api/v1`. Liveness is at `/health` and readiness at `/ready`; neither is
  versioned.
- Requests are validated by Zod schemas from `@pos/validation` (the same schemas the clients use).
- Errors use one envelope, `{ code, message, details, requestId }`. Clients localize via
  `errors:<code>`. Stack traces never leave the server.
- Authentication: argon2id passwords, 15-minute HS256 access JWTs, and rotating refresh tokens
  with reuse detection. Browsers get the refresh token as an httpOnly SameSite=strict cookie,
  with an Origin check as CSRF defense. Native clients get it in the body.
- Authorization is **deny-by-default**. Every non-public route declares `@RequirePermissions`.
  A global guard verifies tenant ownership of `:tenantId` / `:locationId` (answering 404 for
  other tenants) and evaluates permissions in location scope.
- Fastify plugins provide helmet security headers, a CORS allowlist and rate limiting (stricter
  on credential endpoints). Logs are structured pino with redaction and carry
  requestId/user/tenant/location context.

## 8. KDS event flow (Phases 4–5)

1. POS → hub: `order.place`.
2. The hub's application service opens one SQLite transaction: order + items + modifiers + one
   kitchen ticket per station (routed from `ProductStation`) + outbox row.
3. After commit, the hub broadcasts `kitchen.ticket_created` to the station rooms on the LAN
   WebSocket.
4. KDS → hub: `ticket.start` / `ticket.ready` / `ticket.complete`. Each is validated, persisted
   with an outbox row, then broadcast as `kitchen.ticket_*` plus the derived `order.updated`.

The cloud is never in this path. Event names and payloads are typed in
`@pos/shared-types` ([events.md](events.md)).

## 9. Customer online ordering flow (Phase 7)

See [ADR 0013](adr/0013-online-ordering.md), [api.md](api.md#online-ordering-phase-7-cloud-only)
and [sync.md](sync.md#website-orders-phase-7).

1. Customer web → `POST /api/v1/orders` (choices only: products, options, quantities, contact,
   pickup or delivery, payment option; idempotent by the browser-generated order id).
2. The cloud checks the location's online-ordering state (`onlineOrderingStatus` in
   `@pos/domain`): the location's `OPEN/PAUSED/CLOSED`, then the opening hours, then `OFFLINE`
   when the hub's heartbeat is older than 3 minutes. Refusals are `ONLINE_ORDERING_DISABLED` or
   `LOCATION_OFFLINE`.
3. The cloud validates products, modifiers and availability, then **recalculates** prices, tax,
   fees (delivery) and the total with the shared pricing engine. Browser totals are ignored.
4. It charges an online card through the `PaymentProvider` (documented mock adapter only), then
   creates the order (`PLACED`, channel `WEBSITE`, `W-NNN`, `acceptBy`; owner = cloud) and an
   `ORDER` change-log entry in the same transaction. The customer gets a tracking token.
5. The hub, long-polling the feed, fetches and stores the order; the POS opens an incoming-order
   dialog. Accept → `CONFIRMED` (tickets go to the KDS) or reject → `CANCELLED` with a reason;
   the hub's push carries `baseVersion` and hands the order over to the hub. A rejection voids the
   online payment in the cloud.
6. The customer's status page polls the cloud every 5 s. An order still unaccepted 30 s after
   `acceptBy` is cancelled by the cloud and its payment voided; that decision wins over an
   acceptance made offline.

## 10. Development phases

| Phase | Scope                                                                                                                                                   | Status  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0     | Docs, monorepo, tooling, shared packages, identity/tenancy schema, auth, RBAC, audit, tenants/locations API                                             | ✅ Done |
| 1     | Menu: categories, products, variants, modifier groups/modifiers, kitchen stations, location availability/price overrides, published menu, admin menu UI | ✅ Done |
| 2     | POS order creation, pricing engine, taxes, discounts, order state machine, tables, Tauri shell                                                          | ✅ Done |
| 3     | Payments (provider abstraction, cash, split), shifts, cash drawer                                                                                       | ✅ Done |
| 4     | KDS app, kitchen tickets, station routing                                                                                                               | ✅ Done |
| 5     | Location hub with SQLite, offline POS                                                                                                                   | ✅ Done |
| 6     | Synchronization engine                                                                                                                                  | ✅ Done |
| 7     | Customer website, online ordering availability                                                                                                          | ✅ Done |
| 8     | Admin portal completion                                                                                                                                 | ✅ Done |
| 9     | Reporting                                                                                                                                               | ✅ Done |
| 10    | Hardening, full E2E suite                                                                                                                               | ✅ Done |

Gate after every phase: tests, typecheck, lint, migration status, build, and docs updated.

**Phase 0–1 verification (2026-10-17):** `turbo run build typecheck lint test --force` with 36/36
tasks green. That covers 137 unit and integration tests (domain 47, validation 11, i18n 16,
api-client 6, ui 2, database 5, API 42 against a real Postgres, admin 8) plus 3 Playwright E2E
tests (catalog CRUD with session reload, Arabic RTL ⇄ English LTR, permission-limited user)
and the lint-rule test. Prisma `migrate status` is clean.

**Phase 2 verification (2026-10-17):** `turbo run build typecheck lint test --force` with 44/44
tasks green. That covers 214 unit and integration tests (domain 79, API 63, i18n 20, validation 16,
POS 9, database 9, api-client 6, app-kit 5, admin 5, ui 2), 8 Playwright E2E tests (admin 3; POS 5:
dine-in order, takeaway order with server-confirmed total, lost-response retry without
duplication, editing an open order, Arabic RTL ⇄ English LTR), and the Rust shell's `cargo fmt`,
`clippy -D warnings` and tests. `tauri build --debug` produces `MADAR POS.app`.

### Phase 2 decisions

- **The POS talks to the cloud API until the hub exists (Phase 5)**
  ([ADR 0008](adr/0008-pos-before-hub.md)). All POS data access goes through `@pos/api-client`
  and the session client, so Phase 5 swaps the base URL to the location hub without UI changes.
  The cart is persisted on the terminal (a draft, not business data), and its client-generated
  order id makes every submit idempotent from day one.
- **One pricing engine** (`priceOrder` / `quoteOrder` in `@pos/domain`) prices the POS preview
  and the authoritative server order. The server never accepts client prices.
- **Order numbers** come from an atomic per-location, per-business-day counter
  (`order_counters`). The business day is the calendar date in the location's timezone.
- **Optimistic concurrency:** each order has a `version`. Edits and transitions with a stale
  version answer `409 CONFLICT` (`reason: STALE_VERSION`), and the POS reloads the order.
- **Staff vs system transitions:** PREPARING/READY are system transitions (KDS, Phase 4) and are
  rejected from staff requests.
- **Shared app plumbing** moved to `@pos/app-kit` so the admin and POS do not duplicate session,
  i18n or error handling.

**Phase 3 verification (2026-10-17):** `turbo run build typecheck lint test --force` with 48/48
tasks green. That covers 269 unit and integration tests (domain 99, API 81, i18n 22, validation 16,
database 14, POS 11, receipts 8, api-client 6, app-kit 5, admin 5, ui 2) and 12 Playwright E2E
tests (admin 3; POS 9, adding: cash with change → complete → receipt; a bill split between card and
cash with a card number refused; shift close-out reporting the cash difference; an Arabic receipt
encoded as a valid ESC/POS raster job). Refunds, idempotent and concurrent charges, and shift
rules are covered by the API integration tests. Also `pnpm test:tools` (lint rule, printer
decoder), the Rust shell's `cargo fmt`, `clippy -D warnings` and tests (5, including printer
target validation), and a clean `migrate status`.

### Phase 3 decisions

See [ADR 0009](adr/0009-payment-providers-and-raster-receipts.md).

- **Payment providers:** cash, externally approved card (approval code only, card numbers
  rejected), and an online provider that fails until a gateway is configured.
- **Payments are append-only and idempotent** by their client id; the order row is locked while
  charging. `paymentStatus` is derived from the payment rows. A fully refunded completed order
  moves to `REFUNDED` as a system transition.
- **An open shift is required to take payments** and each payment records its shift. Shift
  close stores expected, counted and difference; one open shift per drawer is a unique index.
- **Cash rounding** is per location and off by default; it never alters order totals.
- **Receipts** render to a canvas (correct Arabic shaping and RTL) and print as ESC/POS raster
  over TCP from the Tauri shell, or through the browser print dialog.
- **Money guards on orders:** cancel requires refunding first; edits cannot drop the total below
  what is held.
- The `test:tools` script previously passed directory arguments to `node --test`, which ran no
  test files. It now uses a glob, and both tool tests run.

**Phase 4 verification (2026-10-17):** `turbo run build typecheck lint test --force` with 52/52
tasks green. That covers 318 unit and integration tests (domain 117, API 97, i18n 23, database 16,
validation 16, api-client 11, POS 11, receipts 8, KDS 7, app-kit 5, admin 5, ui 2) and 16
Playwright E2E tests (admin 3; POS 9, now including the kitchen marking an order ready and the
POS showing it live before handover; KDS 4: a POS order reaching each station live and moving
through start, strike, ready, bump and recall; a cancellation that must be acknowledged; rush
ordering; Arabic RTL). The API suite covers routing to several stations, derived order statuses
under two stations finishing at once, edits and cancellations after dispatch, and the realtime
socket (authentication, close codes, no leaks between locations). Also `pnpm test:tools`, the
Rust shell checks, a clean `migrate status`, and manual runs of the KDS and POS against the
development API.

### Phase 4 decisions

See [ADR 0010](adr/0010-kitchen-tickets-and-realtime.md).

- **Orders reach the kitchen when confirmed.** The POS now creates orders as `CONFIRMED`; `PLACED`
  is kept for orders awaiting acceptance (web, Phase 7).
- **One ticket per order and station**, items routed to every station of their product; items
  without a station are not sent.
- **The order's PREPARING/READY follow its tickets** as system transitions, with the order row
  locked so concurrent stations derive them once. Handover (COMPLETED) stays at the POS and
  clears ready tickets; completing a confirmed order with kitchen work left is refused.
- **KDS** (`apps/kds`, web app for tablets and wall screens): dark theme, large type, status shown
  with icon and words (never colour alone), running timers with per-location warn/late
  thresholds, station filter and expo view, rush, line strike, undo, recall, cancellation
  acknowledgement, chime on new tickets (after one tap, as browsers require).
- **Realtime socket** on the API with token-in-first-message authentication; the POS and KDS
  refresh on events, and polling became a 30–60 s fallback.

**Phase 5 verification (2026-10-17):** `turbo run build typecheck lint test --force` with 60/60
tasks green. That covers 344 unit and integration tests (domain 119, API 96, i18n 23, database 19
incl. the cloud/hub schema contract, gateway 16, validation 16, api-client 11, POS 11, receipts 8,
KDS 7, server 6, app-kit 5, admin 5, ui 2) and 19 Playwright E2E tests. The POS (12) and KDS (4)
suites now run against a hub that was paired with a freshly seeded cloud which is then **stopped**:
every order, payment, shift and kitchen test passes with no cloud at all. The hub suite covers
provisioning, PIN sign-in and lockout, a full order through payment and kitchen on SQLite with its
outbox rows, atomic rollback of outbox rows, three concurrent payments, read-only cloud settings,
offline operation, restart persistence, snapshot refreshes, staff deactivation and a revoked
credential; the migrator suite covers idempotency, edited-migration detection and rollback. Also
`pnpm test:tools`, the Rust shell checks, a clean `migrate status`, and a manual run: POS PIN
sign-in through the hub, then an order placed after stopping the cloud API.

### Phase 5 decisions

See [ADR 0011](adr/0011-one-server-codebase-on-two-databases.md).

- **One server codebase** (`@pos/server`) runs the cloud API on PostgreSQL and the hub
  (`apps/gateway`) on SQLite, with a generated hub schema guarded by a contract test.
- **Pairing:** an owner runs the hub's pairing command once; the cloud issues a device credential
  (stored hashed) that the hub uses for `/sync/*`. Devices can be listed and disabled.
- **Provisioning by snapshot** until Phase 6: configuration, catalog, floor and staff (with
  password/PIN hashes for offline sign-in) are pulled at start-up and every 5 minutes, applied in
  one transaction, with ETag short-circuiting.
- **Outbox written now:** every order, shift and kitchen-ticket change writes a full aggregate row
  to `sync_operations` in the same transaction (Phase 6 sends them).
- **Hub mode:** cloud-managed settings are read-only on the hub; PIN sign-in (employee code + PIN,
  locked after 5 failures) exists only on the hub; until provisioned, the hub answers
  `HUB_NOT_PROVISIONED`.
- **POS/KDS** talk to the hub in development and tests; the POS offers PIN sign-in with an on-screen
  keypad and shows the hub's cloud link and pending changes.

**Phase 6 verification (2026-10-17):** `turbo run build typecheck lint test` with 60/60 tasks
green, covering 391 unit and integration tests (domain 119, API 123, gateway 34, i18n 23,
database 21, validation 16, api-client 11, POS 11, receipts 8, KDS 7, server 6, app-kit 5,
admin 5, ui 2), and 20 Playwright E2E tests (admin 3, POS 13, KDS 4). New: the cloud's push/pull suite (exactly once under repeated and
concurrent delivery, line replacement with append-only history, payments and cash movements,
ticket dependencies, conflicts for stale, cloud-changed and cloud-owned entities, scope and
validation refusals per operation, database rules, a refused operation applied after its cause was
fixed, Phase 5-format operations, device authentication, the trigger-fed change feed with paging and
long polling, and a contract test that the payload schemas match the database models); the hub's
engine suite (offline then reconnect, coalescing, dependency order, FAILED holding back only its
entity, manager retry, RETRY backoff and give-up, HTTP 500 and refused credentials, crash recovery
with DUPLICATE answers, cursor handling, the background loops) and batch planner unit tests; and a
POS E2E test of the specification's acceptance flow against the real cloud: the cloud is down, an
order is taken, the cloud comes back, "Sync now", the order is in the cloud exactly once, and a
second sync duplicates nothing. Starting the cloud in that test also uploads everything the other
POS suites recorded offline (payments, refunds, shift closes, kitchen tickets) with no refusal.
Also `pnpm test:tools`, a clean `migrate status`, and a manual run on the dev hub: its Phase 5
offline backlog was sent, two orders were refused as `SYNC_CONFLICT` because the dev cloud had
already numbered `MAIN-001`/`MAIN-002` that day (shown as "Sync error · 2 failed" with the reason),
and a new order continued the cloud's numbering (`MAIN-006`) and synchronized within seconds.

### Phase 6 decisions

See [ADR 0012](adr/0012-sync-engine.md) and [sync.md](sync.md).

- **State-based push:** each operation carries the aggregate's full state; the hub sends the
  newest per entity (coalescing) with dependencies first, the cloud stores it after scope,
  ownership and schema checks without re-running commands.
- **Exactly once:** the `processed_operations` ledger (primary key `operationId`) is written in the
  applying transaction; repeats and racing deliveries answer `DUPLICATE`. Refusals are kept for
  administrators (`GET /locations/:lid/sync/issues`).
- **Ownership without timestamps:** an entity is written only if new to the cloud or unchanged since
  this hub last pushed it (row `version` versus the ledger); a backwards outbox sequence is a
  conflict. `entityVersion` became a per-entity outbox sequence.
- **Change feed:** PostgreSQL triggers on every snapshot table record one `CONFIG` change per
  transaction, serialised per tenant so cursors never skip a late commit; the hub long-polls
  `GET /sync/pull` and refreshes its snapshot on a change (safety-net refresh now every 30 minutes).
- **Failure handling:** unreachable cloud → `OFFLINE` with full-jitter backoff (2 s to 60 s);
  `CONFLICT`/`REJECTED` → `FAILED`, holding back only that entity, retried by a manager; `RETRY`
  answers back off per operation and fail after 10.
- **POS:** footer indicator (`Online · 12 synchronized`, `Offline · 3 pending`, `Syncing · 5
pending`, `Sync error · 2 failed`) and a synchronization screen with "Sync now", figures and the
  outbox, in English and Arabic.
- **Order numbers:** the snapshot carries the cloud's order counters of recent days, so a hub paired
  mid-day continues the cloud's numbering instead of reusing it.

**Phase 7 verification (2026-10-17):** `turbo run build typecheck lint test --force` with 64/64
tasks green, covering 464 unit, integration and component tests (API 146, domain 135, gateway 44,
i18n 24, database 22, validation 20, POS 13, customer-web 12, api-client 11, server 10, receipts 8,
KDS 7, app-kit 5, admin 5, ui 2), and 24 Playwright E2E tests (admin 3, POS 14, KDS 4,
customer-web 3). New: the cloud's online-ordering suite (storefront and settings, CLOSED/PAUSED/
outside-hours/stale-hub refusals, server re-pricing that ignores tampered browser totals with the
delivery fee and `W-` numbers, domain validation, idempotent and racing resends, mock card capture
and decline, tracking tokens including forgeries and the rate limit, `ORDER` feed entries scoped to
the location and never echoing hub pushes, the hand-over on acceptance, the refused crossings (no or
stale `baseVersion`, an edit while `PLACED`, a hub-invented website order, a late acceptance after
the timeout), the void after a rejection, the timeout sweep with its grace period, and cloud staff
refused on waiting website orders); the hub's website-order suite (storing feed orders with their
event, keeping the cursor while the cloud is away, skipping 404s, refreshing the menu first,
hand-over push with `baseVersion` and kitchen tickets, refusing edits and late acceptances,
rejecting an online-paid order and merging the void, adopting the cloud's cancellation over an
offline acceptance with `SYNC_SUPERSEDED`); a hub-migration upgrade test on a database holding
orders, payments and cash; domain tests for opening hours (overnight windows, timezones), the
ordering status, fees, options and acceptance rules; component tests for the product dialog,
cart/preview, checkout payload, status page (EN/AR, errors) and the POS order details. The
customer-web E2E suite runs the specification's acceptance steps 14–17 with cloud, hub, POS and
website all running: an English pickup order accepted at the POS (kitchen ticket at the hub, the
customer's page turns "Accepted"), an Arabic RTL delivery order paid by test card and rejected by
a manager working in Arabic (the customer sees the reason and the voided payment), and a paused
branch refusing checkout. Also `pnpm test:tools`, a clean `migrate status`, the hub schema check,
and a manual run on the development stack (website order W-001 → dev hub within seconds → accepted
at the POS → "تم القبول" on the customer's page).

### Phase 7 decisions

See [ADR 0013](adr/0013-online-ordering.md).

- **The cloud creates website orders** (cloud-only `OnlineOrderingModule` in `@pos/server`) and
  prices them with the shared engine; the browser sends choices only. They are `PLACED`, channel
  `WEBSITE`, numbered `W-NNN` from a cloud-only counter, idempotent by the browser's order id.
- **Ordering status** comes from the domain: the location's switch, then opening hours (weekly
  windows in the location timezone), then the hub heartbeat (stale after 3 minutes → `OFFLINE`).
  Settings at `PUT /locations/:lid/online-ordering` (`online_ordering.manage`).
- **ORDER topic:** the cloud's `ChangeRecorder` appends an entry for every cloud change of a
  website order, in its transaction, under the feed's advisory lock; the hub fetches the order
  aggregate (`GET /sync/orders/:id`) and stores it.
- **Hand-over:** the hub's first push of a website order must be the location's decision on
  exactly the version the cloud handed out (`baseVersion`, hub table `inbound_orders`); otherwise
  `SYNC_CONFLICT`. The hub refuses edits before acceptance and acceptances after the deadline.
- **Timeout:** the cloud cancels unaccepted orders 30 s after `acceptBy` and voids their payment;
  when the hub accepted offline meanwhile, the cloud's cancellation wins and the hub's change is
  marked `SYNC_SUPERSEDED` (this closes the open question about the acceptance timeout).
- **Payment:** pay at pickup / cash on delivery (nothing recorded until the POS takes the money);
  online card only through the documented mock adapter, captured at checkout, drawer-less
  (`payments.shift_id` nullable for `ONLINE` only), voided as an append-only `REFUND` row.
- **Tracking token:** `<orderId>.<HMAC>`, nothing stored, sent in `x-tracking-token`; order
  creation and tracking have their own rate limits; the status page polls every 5 s.
- **Customer website** (`apps/customer-web`): guest checkout only; cart and language in
  localStorage, the placed order's token in sessionStorage; EN/AR with RTL; one tenant per
  deployment (`VITE_TENANT_SLUG`).
- **POS:** a banner and an auto-opening dialog for each new website order (items, fulfillment,
  address, payment, countdown), accept or reject with a reason preset; online tenders are no
  longer offered at the till.

**Phase 8 verification (2026-10-18):** `turbo run build typecheck lint test --force` with 64/64
tasks green, covering 518 unit, integration and component tests (API 175, domain 142, gateway 48,
i18n 24, database 23, validation 20, admin 18, POS 13, customer-web 12, api-client 11, server 10,
receipts 8, KDS 7, app-kit 5, ui 2), and 28 Playwright E2E tests (admin 7, POS 14, KDS 4,
customer-web 3). New: the cloud's staff suite (users with location roles, passwords never
returned or audited, role changes audited before/after, deactivation ending sessions and refresh
tokens, the last-owner and self rules, privilege escalation refused for grants, removals,
deactivation, password resets and PIN links, roles from the catalog with audited permission
changes, protected system roles, employees with hashed PINs and reset); the overview suite
(payment methods and drawers with archive rules, dashboard per location within the caller's reach
with the hub link, order/customer/payment searches with filters and paging, online refunds that
are append-only, idempotent and announced to the hub, cash refunds sent to the till, hub-owned
orders refused in the cloud, audit-log filters, scope and redaction on read); the resolution suite
(stored refused payloads, both versions compared, applying the hub's version with the cloud's copy
in the audit log and a duplicate on resend, keeping the cloud's version with older hub changes
refused and `baseVersion` changes accepted, never dropping a sale or a hub payment, a failed apply
leaving the issue open, resend after a fix, permissions, a replaced hub's change rescued, malformed
payloads kept); an audit-coverage test producing each action the specification lists; the hub's
resolution suite (resend, adopting the cloud's order with superseded changes and `baseVersion`,
keeping money taken at the till, unknown decisions skipped); domain tests for grants and resolution
options; component tests for the sync issue page, roles matrix, users, online ordering and product
overrides. The admin E2E suite runs the main flows: an owner creating a role and a user (audited,
enforced in a second browser), branch settings, online ordering and payment setup in Arabic RTL,
order search and detail with the customer view, and an administrator resolving a refused hub
change in Arabic. Also `pnpm test:tools`, `prettier --check`, a clean `migrate status` (development
and test databases), the hub schema check, and a manual run of every screen against the
development database (including the two refusals left there in Phase 6, which offer only a
resend because their state predates Phase 8).

### Phase 8 decisions

See [ADR 0014](adr/0014-admin-portal-and-conflict-resolution.md).

- **Admin portal** (`apps/admin`) completed with grouped, permission-filtered navigation: dashboard;
  operations (orders with filters and detail, customers, payments with online refunds, shifts
  read-only); menu (now with per-product modifier min/max overrides); settings (business,
  locations with tax mode, cash rounding and kitchen timers, online ordering with opening hours,
  taxes, discounts, tables, payment methods, cash drawers); staff (users, roles with a permission
  matrix, employees with PINs); system (devices with pairing instructions, synchronization with
  conflict resolution, audit log). Every screen has loading, empty and error states, English and
  Arabic with RTL, and asks the API for every decision.
- **Cloud-only admin API** (`apps/api/src/modules/admin`): staff, payment setup, dashboard,
  searches across the caller's locations (only where they hold the permission), online refunds,
  audit-log search (redacted again on read).
- **No privilege escalation:** nobody grants, revokes, edits or deletes a role holding permissions
  they lack at that scope; linking a user to an employee or setting that employee's PIN requires
  the user's permissions; system roles hold every permission (also new ones) and cannot change;
  an active owner always remains; nobody changes or deactivates themselves. Deactivation and
  password resets end sessions at once. All permission changes are audited.
- **Hub-owned orders are changed at the POS:** the cloud refuses staff edits, transitions, charges
  and refunds of orders a hub owns (`OWNED_BY_LOCATION`); online card refunds stay with the cloud
  (append-only, no version change, announced to the hub).
- **Conflict resolution:** refused hub changes keep their state; an administrator with
  `sync.resolve` applies the hub's version (the cloud's copy goes to the audit log first),
  keeps the cloud's version (orders only, never dropping a sale or a hub payment), or asks for a
  resend, with a required note. The decision reaches the hub on the change feed (`RESOLUTION`); a
  kept cloud version is enforced through `baseVersion`.
- **New permission** `sync.resolve`; new error codes `USER_NOT_FOUND`, `ROLE_NOT_FOUND`,
  `EMPLOYEE_NOT_FOUND`, `DEVICE_NOT_FOUND`, `PAYMENT_METHOD_NOT_FOUND`, `SYNC_ISSUE_NOT_FOUND`.
- **Audit coverage** checked against the specification: login and logout, cancellation, refund
  (and online voids), discount, price change, product change, payment correction, shift open and
  close, permission change (user roles, role permissions, employee links and PINs) and
  configuration change (tenant, locations, online ordering, taxes, discounts, floor, payment
  methods, drawers, devices, sync decisions) are recorded in the cloud; actions taken at the hub
  are recorded on the hub (upload in Phase 10).

**Phase 9 verification (2026-10-18):** `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
green (turbo: build 16/16, typecheck, lint and test 26/26 tasks), covering 553 unit, integration
and component tests (API 193, domain 149, gateway 48, admin 26, i18n 26, database 23,
validation 20, POS 13, customer-web 12, api-client 11, server 10, receipts 8, KDS 7, app-kit 5,
ui 2), and 29 Playwright E2E tests (admin 8, POS 14, KDS 4, customer-web 3). New: the cloud's report suite against a seeded history whose figures were
worked out by hand: two locations (VAT 15% included and added), all five channels, a 10% and a
fixed discount, a cancelled prepaid order, a fully refunded website order with a delivery fee,
partial card refunds on a later day, an order still in the kitchen, and an order and payment just
after midnight local time (21:30Z the day before) — asserting every daily, channel, payment,
product, category, tax, discount, shift and prep-time figure, channel and location filters, the
time-zone day boundaries, a 366-day leap year, validation, `404` for another location and `403`
without `reports.view`, a KWD tenant (3 decimals, largest-remainder refund split), and an
order taken, paid, refunded and handed over through the real API appearing exactly as priced;
domain tests for `splitRefund`, averages, shares and date ranges; admin component tests (daily
sales and its chart, filters in the URL and the request, switching report, an inverted period
refused before any request, empty and error states, Arabic RTL, CSV content and period presets);
and an admin E2E test in which a takeaway order goes through the kitchen, cash payment and
hand-over and the owner reads it in daily sales (and its downloaded CSV), orders by channel and
prep times, then again in Arabic. Also `pnpm test:tools`, `prettier --check`, a clean
`migrate status` on the development and test databases, the hub schema check (views are not
Prisma models, so the hub schema is unchanged), and a manual run of every report against the
development database in English and Arabic.

### Phase 9 decisions

See [ADR 0015](adr/0015-reporting.md).

- **Cloud-only reports over PostgreSQL views** (`report_sales_orders`, `report_payments`,
  `report_refunds`, `report_kitchen_tickets`), filtered and summed with parameterized SQL in
  `apps/api/src/modules/reports`; no warehouse, extracts or caches. Nine reports under
  `/tenants/:tid/reports/*`, `reports.view`, scoped to the caller's locations, over business
  dates (each location's calendar day), at most 366 days, with a channel filter.
- **Sales are completed orders** (also when refunded later) on their business date;
  `netSales = total − tax − fees` in both price modes; open, draft and cancelled orders are not
  sales.
- **Refunds count on the day they were made** and are split over the refunded order's taxes,
  fees and net sales in proportion (`splitRefund`, largest remainder), giving net sales and tax
  after refunds. Refunds of orders cancelled afterwards are money, not sales.
- **Money reports** (payment summary, shift summary) date money by when it moved and include every
  order; the shift summary reuses the POS's cash formula and the stored close-out.
- **Prep time** = ticket reaching the kitchen → READY, per station, with the wait until started,
  median, 90th percentile and the location's late threshold.
- **Admin Reports section** with filters in the URL, headline figures, tables with totals, a small
  net-sales chart, locale-free CSV export (UTF-8 BOM), and English/Arabic with RTL.

**Phase 10 verification (2026-10-23):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and `pnpm format:check`
green (turbo: 26/26 typecheck, lint and test tasks, 16/16 builds), covering 585 unit, integration
and component tests (API 210, domain 149, gateway 55, admin 26, i18n 26, database 23,
validation 20, POS 17, server 14, customer-web 12, api-client 11, receipts 8, KDS 7, app-kit 5,
ui 2), and `pnpm e2e` with 31 Playwright tests in 2 min 20 s (admin 8, POS 15, customer-web 4,
KDS 4) covering all 19 critical scenarios ([testing.md](testing.md)). New: the security suites
(every cloud and hub route refused without a token, every permission-requiring route refused to a
member without permissions, every tenant-scoped route hidden from another tenant, the device guard
on `/sync/*`, the public-route list, CORS preflights and origin validation, helmet headers on
every response, separate refresh and website-order rate budgets, `TRUST_PROXY`, claimed sources,
`/ready` → `SERVICE_UNAVAILABLE`, Prisma errors logged without their arguments, log redaction and
the request context); the hub's audit trail (queued with each change, uploaded redacted and once;
the cloud storing it under the hub's location, refusing other scopes, never rewriting an entry;
the payload contract); a POS resending an order to the hub, sequentially and concurrently; the
keychain token store; the cross-app journey; the mid-service disconnect with the order on the
local KDS and the resent push. Also `pnpm test:tools` (with the scenario-matrix check), the Rust
shell's `rust:check` (fmt, clippy `-D warnings`, 7 tests, including the secure store), a clean
`migrate status` on the development and test databases, the hub migrations applied to a fresh
SQLite file with `migrate status` clean and no drift from the hub schema, the hub schema check,
and a manual run in the browser pane on an isolated stack (cloud, paired hub, POS, KDS and
website): website order → POS acceptance → three KDS stations started and ready → cash payment and
hand-over → "Completed" on the customer's page, then the same in Arabic (RTL) on all three apps,
with the cloud's audit log showing the hub's PIN sign-ins, shift, payments and kitchen changes.

### Phase 10 decisions

See [ADR 0016](adr/0016-hardening.md), [testing.md](testing.md) and [release.md](release.md).

- **The 19 critical flows** are mapped to Playwright tests in [testing.md](testing.md) (checked by
  `pnpm test:tools`) and run with one command, `pnpm e2e`. New: a cross-app journey (website →
  cloud → hub → POS acceptance → every KDS station → cash payment → hand-over, the customer's page
  following each status), the Internet dropping mid-service (order on the local KDS, synced once on
  reconnect), and the hub's push resent as a duplicate (`DUPLICATE`, still one order).
- **Routes are protected by construction:** the server refuses to start with a route that is
  neither `@Public()` nor `@RequirePermissions`; tests call every cloud and hub route and expect
  `401` without a token, `403` for a member without permissions, `404` across tenants and the
  device guard on `/sync/*`, against an explicit list of public routes.
- **Transport:** `CORS_ORIGINS` must be bare origins (`*` refused at start-up), `TRUST_PROXY` for
  per-client rate limits behind a proxy, helmet defaults tested; the cookie refresh keeps
  SameSite=strict plus the Origin check. Clients can no longer label audit entries `HUB` or
  `SYSTEM`.
- **Observability:** logs and audit context carry `orderId` and `deviceId` besides request, user,
  tenant and location; redaction goes one level deeper; database errors are logged without
  their query arguments; `/ready` answers the typed `SERVICE_UNAVAILABLE`; the hub's public status
  keeps only the code and message of a cloud refusal.
- **The hub's audit trail reaches the cloud** through the outbox (`AUDIT_LOG_APPEND`, append-only,
  exactly once, scoped to the hub's location), so the admin portal's audit log shows PIN sign-ins,
  shifts, payments, refunds and kitchen actions taken at the location.
- **The POS desktop app stays signed in across a restart:** its refresh token lives in the OS
  keychain (Tauri `keyring`), never in web storage.
- Raw SQL, input validation (every body, query and parameter through a Zod schema) and the
  specification's testing requirements were audited; only the gaps above needed code.

### Known gaps

Carried forward after Phase 10 (each was weighed in [ADR 0016](adr/0016-hardening.md); none blocks
running a location):

- **Sync conflicts** (ADR 0014): an order-number clash (the same number twice on one business day,
  possible only with data from before Phase 6) cannot be settled by choosing a version; there is no
  screen to renumber an order. "Keep the cloud's version" exists for orders only.
- Shifts have no `version` column, so a shift changed in the cloud itself would not be detected as a
  conflict; nothing in the cloud edits hub shifts today.
- **Scaling out the cloud API** (several instances) needs shared state that is in-process today:
  the change feed's waiting requests poll PostgreSQL once a second each (`LISTEN/NOTIFY` needs a
  dedicated connection outside Prisma), realtime delivery is in-process (`RealtimeBus`), rate-limit
  counters are per instance, and the website-order timeout sweep runs in every instance. One
  instance serves tens of hubs comfortably.
- Password sign-in is throttled per client IP (PINs per employee code); there is no per-account
  lockout against a guess spread over many addresses, no second factor and no password reset by
  e-mail.
- The POS desktop app keeps its refresh token in the OS keychain (Phase 10); a browser-served POS
  keeps it in memory (sign in again after a reload). An employee signs in with the roles of a
  linked user, so every PIN user is also a user account (with an e-mail); employees without one
  cannot sign in.
- Security tooling outside the code: no CI pipeline, dependency or container scanning, or secret
  manager integration ships with the repository ([release checklist](release.md)); the static web
  apps' own headers (CSP) belong to whatever host serves them.
- The hub runs as a separate Node process; packaging it as a Tauri sidecar for single-terminal
  sites, an installer/service wrapper and disk encryption of its data are hardening work.
- The hub's SQLite tables have no CHECK constraints (the cloud's do); rules are enforced by the
  shared services.
- Card payments are recorded after approval on a standalone terminal; no integrated terminal or
  online gateway is wired yet. Receipt QR blocks are placeholders until a market's e-invoicing
  rules are chosen.
- Printing goes from the terminal to the printer; a hub printer service (cash drawer kick,
  printer status, kitchen printers for stations without a screen) is not built yet.
- Drafts are supported by the API (`status: DRAFT`) but not exposed in the POS UI yet.
- A configurable business-day start hour (for venues open past midnight) is not implemented; the
  business day is the calendar date in the location's timezone.
- KDS screens and POS terminals sign in as staff; only the hub itself is a registered device so
  far. Registering terminals and screens as devices is future work.
- No bump-bar/keyboard control on the KDS.
- Tenants are provisioned by seed only; there is no platform-operator UI yet.
- **Online ordering (Phase 7):** no customer accounts, saved addresses, delivery zones or radius,
  scheduled orders, promo codes or tips; customers (and support staff in the cloud) cannot cancel
  a website order, only the location (reject) or the acceptance timeout can; the delivery fee is
  flat and untaxed.
- Online card payments use the mock adapter only; a real gateway (authorize at checkout, capture
  on acceptance, voids through an outbox instead of inside the database transaction) is still to
  be integrated. A void the provider refuses is recorded as a `PENDING` refund for an operator.
- The customer status page polls (5 s); there is no SSE or push notification, and no SMS/e-mail
  confirmation. `tenant.status_changed` is typed but not emitted; the website re-checks the
  branch every 30 s.
- The POS prompt has no sound and no printed ticket for new website orders; the KDS shows them only
  once accepted.
- A hub that stays offline keeps the website orders it already received; new ones are refused
  (`LOCATION_OFFLINE`) after 3 minutes, and pending ones time out in the cloud.
- The tracking token is part of the status page URL (`/track/<token>`): whoever has the link sees
  the order. Tokens cannot be revoked one by one (rotating `TRACKING_TOKEN_SECRET` revokes all).
- **Admin portal (Phase 8):** customers are grouped from order contact details (no accounts,
  merging or erasure yet); the portal refunds online card payments only (cash and card refunds
  happen at the POS) and cannot cancel or edit orders a hub owns; users have no self-service
  password change, password reset by e-mail or second factor; the audit log has no free-text search
  or export; pairing a hub still needs the command on the hub machine (the portal shows it);
  location and tenant time zones are typed as IANA names, not picked from a list. Audit
  entries of a conflict resolution keep the cloud's full copy of the order, customer contact
  details included (the undo record; erasure is the open privacy item below).

- **Reports (Phase 9):** reports read live views (no materialized views, replica or warehouse
  yet); there are no scheduled or e-mailed reports, no PDF/print layout (CSV only), no hourly or
  day-part breakdown, and no staff, table or customer reports. Product and category sales are not
  net of refunds (refunds name no lines). The location hub has only its shift-close daily summary,
  so reports need the cloud and show what hubs have uploaded. Comparisons between periods and
  locations side by side are not built.

## 11. MADAR expansion

MADAR generalizes the platform into a multi-tenant commerce platform in ten phases, M1–M10. Each
phase has its own branch, pull request and ADR (0017 onwards). See the
[migration plan](madar/migration-plan.md) for the map of every existing component to its change.
Configuration precedence is in [configuration.md](configuration.md).

| Phase | Scope                                                                                                    | Status  |
| ----- | -------------------------------------------------------------------------------------------------------- | ------- |
| M1    | Multi-tenant foundation: Tenant root, profile, tenant context, tenant-scoped client, provisioning, tests | ✅ Done |
| M2    | Feature/module system: catalog, business-type defaults, overrides, FeatureService, UI capability guards  | ✅ Done |
| M3    | Branding and theme: platform and tenant branding, design tokens, dark/light/system, tenant files         | ✅ Done |
| M4    | Currency and localization: currency configuration (ILS default), supported locales                       | ✅ Done |
| M5    | Retail: SKU, barcodes, generic product options and variants, scanner abstraction                         | ✅ Done |
| M6    | Self-service: kiosk app, terminal devices, shared order engine, self-checkout                            | ⏳      |
| M7    | Multi-tenant website: host resolution, verified domains, configurable sections                           | ⏳      |
| M8    | Payment configuration: per-tenant provider accounts, encrypted secrets                                   | ⏳      |
| M9    | Platform admin: separate app and identity, tenants, health, support and repair tools                     | ⏳      |
| M10   | Versioning: one MADAR version, device versions, release tracking                                         | ⏳      |

### Phase M1 decisions

See [ADR 0017](adr/0017-tenant-root-and-isolation.md).

- **Restaurant → Tenant everywhere** by an in-place rename (table, columns, routes, token claim,
  error codes, UI wording). The change-feed functions and report views are replaced in the same
  migration; the hub renames its SQLite tables, columns and pairing record without copying data.
  The snapshot format is 2.
- **Tenant profile:** legal name, business type (text validated against `BusinessType`), status and
  supported locales. The business type picks defaults only; staff cannot change it.
- **Isolation by construction:** every service uses a Prisma client scoped to the tenant in scope.
  It filters every tenant-owned model and refuses foreign writes. In the cloud, a tenant query
  without a tenant is refused. Cross-tenant work is explicit (`runUnscoped`) and limited to
  reviewed files by a lint rule. Public storefront routes find their tenant first. Raw SQL binds
  the caller's own location or record ids.
- **The hub holds one tenant:** it refuses snapshots carrying other tenants' rows. PIN codes
  matching staff of two tenants sign nobody in.
- **Provisioning** (`provisionTenant`) is shared by the seed and the future platform API. The seed
  has one tenant per business type. ILS is supported.

**Phase M1 verification (2026-10-23):** `pnpm build`, `typecheck`, `lint` and `test` green (614 unit,
integration and component tests: API 224, domain 149, gateway 58, admin 26, i18n 26, database 24,
server 23, validation 22, POS 17, customer-web 12, api-client 11, receipts 8, KDS 7, app-kit 5,
ui 2), `pnpm test:tools` (6, including the new lint rule), the hub schema check, a clean
`migrate status`, and all 31 Playwright E2E tests (admin 8, POS 15, KDS 4, customer-web 4). New:
the tenant-isolation suite, the scoped-client tests on PostgreSQL and SQLite, the change feed
after the rename, the pre-rename hub upgrade, and the hub's tenant checks. A POS payment test
failed once on a full run and passed on two reruns: a timing flake seen once, not reproduced.

### Phase M2 decisions

See [ADR 0018](adr/0018-feature-modules.md) and [configuration.md](configuration.md#modules-m2).

- **Modules are capabilities.** `Feature` lists 14 modules. `resolveLayered` resolves platform
  defaults → business-type defaults → tenant → location → device. Every value names its layer.
  The platform's entitlement caps the result: a module outside the plan is off, and one the
  platform manages ignores the tenant's layers.
- **Data:** `tenant_entitlements` (the platform's) and `feature_overrides` (the tenant's, one per
  scope through a derived `scope` column). Both get change-feed triggers and ride the snapshot
  (format 3, with the location's devices). The hub migration was checked by hand.
- **Enforcement:**
  - `FeatureService` (memoized per request) answers on the cloud and on the hub.
  - `@RequireFeature` and the global `FeatureGuard` protect the kitchen (`KDS`), floor (`TABLES`)
    and online-ordering (`ONLINE_ORDERING`) routes. Public routes are checked by the storefront's
    tenant resolver.
  - The route inventory records each route's modules, and the security suite calls every gated
    route with its module off.
- **Behaviour follows capabilities:** without KDS no kitchen tickets and direct handover; without
  TABLES dine-in needs no table; without MODIFIERS the published menu has no modifier groups. A
  lint rule forbids branching on the business type outside its defaults.
- **Apps:**
  - `GET /tenants/:tenantId/context` (cloud and hub) feeds `TenantProvider`, `useFeature` and
    `<FeatureGate>`.
  - The POS hides tables, the table picker, modifiers and kitchen progress when their module is
    off.
  - The KDS says when its module is off.
  - The admin hides module pages and gains Settings → Modules (EN/AR) to switch modules for the
    business or a location.

**Phase M2 verification (2026-10-23):** `pnpm build`, `typecheck`, `lint` and `test` green (663
unit, integration and component tests: API 242, domain 164, gateway 60, admin 31, i18n 26, database
24, server 23, validation 22, POS 20, customer-web 12, api-client 11, app-kit 9, KDS 9, receipts 8,
ui 2), `pnpm test:tools`, the hub schema check, a clean `migrate status`, and all 32 Playwright E2E
tests (admin 9, POS 15, KDS 4, customer-web 4), including the new module scenario. The last API
test (an order seated before TABLES was switched off keeps its table) was added after the full run
and passed with its suites. A manual browser check covered the admin Modules page in Arabic (RTL)
and English: switching Tables off for the main location hid its navigation. Through a hub paired
with the dev cloud, the POS lost its Tables screen, shortcut and table picker, and dine-in asked
for guests only. Switching it back reached the POS through the change feed within seconds.

### Phase M3 decisions

See [ADR 0019](adr/0019-branding-and-theme.md) and
[configuration.md](configuration.md#branding-and-theme-m3).

- **The platform's brand has one source.** `PLATFORM_BRAND` (MADAR · Powered by JudyTech) feeds
  the translations (`common:appName`, `$t(common:platform.name)`), every page title and favicon
  (a Vite plugin fills `index.html`), the POS bundle ("MADAR POS", `app.madar.pos`, keychain
  service included) and the footers of the sign-in screens and the admin sidebar.
  `tools/brand/brand.test.mjs` fails on a hardcoded brand or a drifting bundle.
- **Tenant branding is configuration:** `tenant_branding` (names, logo, favicon, three brand
  colours, typeface, logo size, theme mode, surface style, radius) with per-surface overrides
  (`login`, `pos`, `kds`, `kiosk`, `website`) as zod-validated JSON. `resolveBranding` runs
  platform → tenant → surface (a new configuration layer) → the device's theme mode. A contrast
  check refuses brand colours that would be unreadable on either theme.
- **Tenant files:** a `TenantFileStorage` interface (local disk for development and the hub),
  keys under `tenants/<tenantId>/`, immutable, raster images only, verified by their bytes
  (no SVG), size-limited. Only files the branding shows are public (website, hub sign-in).
- **Design tokens** are semantic only. Dark (charcoal, soft borders, a restrained glow) is the
  default; light and system follow `data-theme`. `applyTenantTheme` writes the tenant's colours
  with computed foregrounds; `ThemeProvider` puts the device's choice over the tenant's; glass
  cards are a surface style. The KDS no longer forces dark. `pos-local/no-raw-colors` keeps
  palette classes and colour literals out of everything but the token files and receipts.
- **Reaching screens:** the tenant context carries the branding of the asking surface; the
  website and the hub's sign-in screens read public branding. Branding has a change-feed trigger
  and rides the snapshot (format 4) with its files' bytes, which the hub checks before storing,
  so a hub shows the tenant's look offline.
- **Admin:** Settings → Branding (EN/AR, RTL): names, logo and favicon uploads, colours with live
  contrast messages, light or dark, cards, corners, typeface, per-screen overrides, and a preview
  in either theme. Every screen has an Appearance choice (business default, light, dark, system).

**Phase M3 verification (2026-10-23):** `pnpm build`, `typecheck`, `lint` and `test` green (720
unit, integration and component tests: API 259, domain 178, gateway 63, admin 34, app-kit 29, i18n
26, database 24, server 23, validation 22, POS 20, customer-web 12, api-client 11, KDS 9, receipts
8, ui 2), `pnpm test:tools` (13, the brand test and the colour rule included), the hub schema check,
a clean `migrate status`, and all 33 Playwright E2E tests (admin 10, POS 15, KDS 4, customer-web 4),
including the new branding scenario. The first full run caught two stale tests, fixed: the KDS
settings now has two selects (language, appearance), so its Arabic E2E test names the one it uses,
and the TenantProvider test now expects the surface in the context request. A manual browser check
against the dev cloud and a paired dev hub covered, in English and Arabic and in dark and light: the
admin (Branding page with uploads, live contrast refusal, per-screen override and preview; the admin
itself re-themed on save), the POS through the hub (the hub's public sign-in branding, then the POS
surface's light override, then the device's dark choice winning over it), the KDS (dark by default
without the old forced class, light by choice) and the customer website (public logo and favicon).
An SVG upload was refused with `415`.

### Phase M4 decisions

See [ADR 0020](adr/0020-currency-and-localization.md) and
[configuration.md](configuration.md#currency-and-languages-m4).

- **The currency stays fixed; its display is configuration.** `CurrencyConfiguration` is the code
  and its ISO decimal places (read-only) plus the tenant's symbol (₪ by default for ILS), display
  (narrow symbol, symbol or code) and format locale (a closed list). `resolveCurrency` runs
  platform → tenant on `resolveLayered`. The settings are nullable tenant columns, so they ride the
  tenant row's change feed and snapshot to the hubs.
- **Formatting takes the configuration:** `formatMoney` and `useMoneyFormat` format the exact
  decimal string with the ISO decimal places (never `Intl`'s guess) and write the symbol override.
  Lint refuses `parseFloat`. New tenants default to ILS (column, `createTenantSchema`,
  `provisionTenant`); the demo restaurant is in shekels in `Asia/Hebron`, and no app hardcodes
  `SAR` or `Asia/Riyadh`: the admin's forms read the tenant context.
- **Languages drive every app:** the screen language is the device's stored choice if supported,
  else the user's `preferredLocale`, else the tenant default (the website: the visitor's choice,
  else the default). The switcher offers only the supported locales and disappears for a
  single-locale tenant, on the hub's sign-in screens too (`GET /hub/locales`). Arabic-Indic digits
  are a tenant setting for Arabic money, numbers, dates and receipts; English stays Latin.
- **Admin:** Settings → Language and currency (EN/AR, RTL), backed by
  `GET`/`PUT /tenants/:tid/localization` (strict: the currency and decimal places are refused,
  audited as `localization.updated`). The Business page keeps names, legal name and time zone.

**Phase M4 verification (2026-10-24):** `pnpm build`, `typecheck`, `lint` and `test` green (805
unit, integration and component tests: API 267, domain 204, gateway 66, app-kit 44, i18n 44, admin
38, validation 29, database 24, server 23, POS 20, customer-web 16, api-client 11, KDS 9, receipts
8, ui 2), `pnpm test:tools` (13), the hub schema check, a clean `migrate status`, `format:check`,
and all 34 Playwright E2E tests (admin 11, POS 15, KDS 4, customer-web 4) in one `pnpm e2e` run,
including the new scenario 22. Earlier runs caught a stale expectation (amounts in SAR), two POS
init scripts writing a preferences version the store discards (so the Arabic-preferring cashier
now, correctly, got Arabic), and a timing flake in the Branding page's saved notice (TanStack Query
drops `mutate` callbacks when the form remounts on refetch), fixed in both settings pages. A manual
browser check against a freshly seeded database and a newly paired hub covered: the admin
dashboard and the new page showing ₪ in English and Arabic; switching the business to Arabic only
with Arabic-Indic digits, after which the admin turned RTL at once and lost its language switcher,
as did the POS sign-in screen (from `GET /hub/locales`), the POS itself (₪ prices in ٠–٩) and the
website; and back to two languages, where the website started in the default (English, ₪28.00),
the POS signed the Arabic-preferring cashier in in Arabic, and a choice in the switcher held.

### Phase M5 decisions

See [ADR 0021](adr/0021-retail-catalog-and-barcodes.md) and
[configuration.md](configuration.md#retail-catalog-m5).

- **Generic options and variants:** `ProductOption` (an axis: Size, Colour…), `ProductOptionValue`
  and `ProductVariantOptionValue`. A product with options sells combinations of one value of each,
  named after them; without options, variants are still named by hand. Variants gain `sku`, `cost`
  and `trackInventory`; `ProductImage` attaches tenant files (cloud only for now). A request names
  new values by their index in its own `options`.
- **Barcodes** (`ProductBarcode`) are unique per tenant and code, one primary per item, on the
  variants of a product that has variants. EAN/UPC check digits are verified in `@pos/domain`, the
  same rule in the admin, the request schema and the server. SKUs are unique across products and
  variants. Order lines keep `sku` and `barcode` (the scanned code, checked against the item).
- **Lookup everywhere from one function:** `lookupCode` over the resolved menu (barcodes, then
  SKUs) serves `GET /locations/:lid/catalog/lookup` on the cloud and the hub and the POS's own
  copy of the menu, which now carries the codes. Without `BARCODE` the menu has none. Snapshot
  format 5 carries options, values, combinations and codes, replaced wholesale on the hub.
- **Scanner abstraction** in `@pos/app-kit`: `ScannerSource`, `KeyboardWedgeScanner` (HID bursts
  ending in Enter, configurable timing, typing untouched), `ManualEntry`, a `NativeScanner`
  placeholder, `useBarcodeScanner`. The POS adds scanned items to the cart (the options dialog
  only for a required choice), shows a toast for unknown or sold-out codes, and has manual entry.
- **Admin:** the product editor gained options, the generated matrix with per-variant SKU, price,
  cost, barcode and stock flag, and barcode entry, in English and Arabic. It shows what the
  modules allow. The stock ledger is a later phase: `INVENTORY` only adds the flag.

**Phase M5 verification (2026-10-24):** `pnpm build`, `typecheck`, `lint` and `test` green (878
unit, integration and component tests: API 284, domain 239, gateway 69, app-kit 56, i18n 44, admin
43, validation 34, database 24, server 23, POS 20, customer-web 16, api-client 11, KDS 9, receipts
8, ui 2), `pnpm test:tools` (13), the hub schema check, a clean `migrate status`, `format:check`,
and all 36 Playwright E2E tests (admin 12, POS 16, KDS 4, customer-web 4) in one `pnpm e2e` run,
including the new scenarios 23 and 24. A manual browser check against a freshly seeded database:
the clothing store's T-shirt in the admin in Arabic (RTL) showed its Size × Colour matrix with
SKUs, costs, barcodes and stock flags; adding the value XL grew the matrix to eight rows, a
mistyped EAN-13 was refused as typed, and saving created XL / White with its code and left
XL / Black unsold. At the POS, signed in through a newly paired hub, a simulated scanner burst
added the demo cola's sizes to the cart (a repeat scan raised the quantity), an unknown code
showed a toast, manual entry found the large cola by its SKU, and the placed order reached the
cloud with each line's SKU and barcode. The check led to one change: a scan now opens the options
dialog only when a choice is required.

## Architectural decisions and open questions

Recorded as ADRs in [adr/](adr/):

1. [0001](adr/0001-location-hub-owns-sqlite.md): the location hub owns SQLite (not each POS).
   Trade-off: on a multi-terminal site the hub machine is a single point of failure. A standby
   hub is future work.
2. [0002](adr/0002-money-integer-minor-units.md): integer minor units, basis points, and the
   rounding policy.
3. [0003](adr/0003-uuidv7-identifiers.md): UUIDv7 everywhere. The spec's "temporary local id"
   mapping is unnecessary because the local id _is_ the cloud id. Human order numbers carry a
   source prefix (location code for hub orders, `W` for web orders) so they never collide.
4. [0004](adr/0004-localized-columns.md): relational en/ar columns. A third language needs a
   migration (accepted).
5. [0005](adr/0005-order-and-payment-status.md): separate payment status, and kitchen-derived
   PREPARING/READY.
6. [0006](adr/0006-sync-protocol.md): outbox + idempotent push + cursor pull + ownership-based
   conflict rules.
7. [0007](adr/0007-tooling-choices.md): Vitest everywhere, stable major versions, Homebrew
   Postgres for local development (Docker optional).
8. [0008](adr/0008-pos-before-hub.md): the POS uses the cloud API (through the shared client)
   until the location hub exists; client-generated order ids make submits idempotent now.
9. [0009](adr/0009-payment-providers-and-raster-receipts.md): payment provider abstraction,
   externally approved cards, shift-bound payments, and receipts printed as ESC/POS raster
   images.
10. [0010](adr/0010-kitchen-tickets-and-realtime.md): kitchen tickets per station, order status
    derived from tickets, handover at the POS, and the authenticated realtime socket.
11. [0011](adr/0011-one-server-codebase-on-two-databases.md): one server codebase on PostgreSQL
    (cloud) and SQLite (hub), generated hub schema with a contract test, pairing and snapshot
    provisioning, outbox capture.
12. [0012](adr/0012-sync-engine.md): the sync engine: state-based push with coalescing and
    dependencies, exactly-once ledger, ownership by version history instead of timestamps,
    trigger-fed configuration change feed read by long polling.
13. [0013](adr/0013-online-ordering.md): online ordering: cloud-created website orders priced by
    the shared engine, the `ORDER` change feed, ownership hand-over on acceptance (`baseVersion`),
    the acceptance timeout winning over a late acceptance, mock online card with append-only
    voids, signed tracking tokens.
14. [0014](adr/0014-admin-portal-and-conflict-resolution.md): admin portal: no privilege
    escalation in staff management, hub-owned orders changed only at the POS (online refunds stay
    in the cloud), and resolving refused hub changes by an explicit, audited decision
    (`RESOLUTION` change-feed topic).
15. [0015](adr/0015-reporting.md): reporting: cloud-only reports over PostgreSQL views, sales =
    completed orders on their business date, refunds on the day they were made and split in
    proportion to the order, money reports dated by when money moved, prep time from ticket
    timestamps.
16. [0016](adr/0016-hardening.md): hardening: the 19 critical flows mapped to Playwright tests
    (a cross-app journey, a mid-service disconnect, a resent push), routes protected by
    construction and tested route by route, CORS/proxy/log hardening, the hub's audit trail
    uploaded through the outbox, the POS refresh token in the OS keychain.
17. [0017](adr/0017-tenant-root-and-isolation.md): MADAR: the tenant is the root (an in-place
    rename), and tenant isolation is enforced by a tenant-scoped database client, with
    cross-tenant work explicit and allowlisted.
18. [0018](adr/0018-feature-modules.md): MADAR modules: a capability catalog resolved in layers
    (platform → business type → tenant → location → device) under the platform's entitlement,
    enforced by route guards and capability-driven services on the cloud and, from the snapshot,
    offline on the hub; code never branches on the business type.
19. [0019](adr/0019-branding-and-theme.md): MADAR branding: one source for the platform's brand,
    tenant branding resolved in layers (platform → tenant → surface → device theme mode) on
    semantic design tokens with dark, light and system themes, contrast checked on save, and
    tenant files in an isolated, immutable storage that reaches the hubs with the snapshot.
20. [0020](adr/0020-currency-and-localization.md): MADAR currency and languages: the currency is
    fixed at provisioning (ILS by default) while its symbol, display and format locale are tenant
    configuration resolved platform → tenant; formatting uses ISO decimal places and never a
    float; the tenant's supported locales, default and digit style drive every app's language
    switcher and initial language.
21. [0021](adr/0021-retail-catalog-and-barcodes.md): MADAR retail catalog: generic product
    options whose value combinations are the variants, per-variant SKU, cost and stock flag,
    barcodes unique per tenant with GS1 check digits verified in the domain, one code lookup over
    the resolved menu on the cloud, the hub and the till (offline), and a scanner abstraction that
    reads keyboard-wedge scanners without blocking typing.

Open items to revisit:

- Customer privacy erasure vs. immutable financial records. The plan is to anonymize customer
  PII while keeping transactions.
- Country-specific receipt and e-invoicing rules (e.g. Saudi ZATCA QR). The receipt builder will
  expose an extension hook; there is no market-specific logic yet because the first market is
  undecided.
