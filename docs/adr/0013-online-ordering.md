# ADR 0013: Online ordering: cloud-created website orders, ORDER change feed, ownership hand-over

- Status: Accepted (2026-10-17)

## Context

Phase 7 adds the customer website. A guest orders from a branch for pickup or delivery; the order
must reach the restaurant's kitchen, which runs on the location hub (ADR 0001) and may be offline;
the restaurant accepts or rejects it at the POS; the customer follows the status. ADR 0006 already
set the ownership rule ("website orders → cloud until accepted"), and ADR 0012 left an `ORDER`
topic for the change feed. This ADR records how that is built and the choices the specification
left open.

## Decision

### Where website orders are created and priced

- **The cloud creates them** (`POST /api/v1/orders`, a cloud-only `OnlineOrderingModule` in
  `@pos/server` that the hub never loads). Customers never talk to a hub: restaurants open no
  inbound ports, and the hub may be offline.
- **Never trust the browser.** The request carries choices only (product, variant, modifiers,
  quantity, notes); validation strips any price or total. The cloud validates against the
  location's published menu and prices with the shared `quoteOrder` (`webOrderFees` adds the
  delivery fee as an engine fee). The website runs the same engine for its preview only.
- Orders are created `PLACED`, channel `WEBSITE`, source `WEBSITE`, actor `CUSTOMER`, with
  `fulfillmentType` (PICKUP/DELIVERY), the delivery address, the e-mail given, and `acceptBy`
  (placed + the location's `onlineAcceptMinutes`, default 10).
- **Numbers** are `W-001…` per location and business day from a cloud-only `web_order_counters`
  table, so they never touch `order_counters`, which the hub continues (ADR 0012).
- **Idempotent** by the browser-generated order id. A resend with the same id and phone returns
  the same order and tracking token; another phone gets `409 CONFLICT` (`ID_IN_USE`), so an id
  cannot be used to read someone else's order.

### Whether a branch takes orders

`onlineOrderingStatus()` in `@pos/domain` decides, in this order: an inactive location or the
restaurant's `CLOSED` setting → `CLOSED`; `PAUSED` → `PAUSED`; outside the weekly opening hours
(in the location timezone; windows may run past midnight; no windows = no restriction) → `CLOSED`
(`OUTSIDE_HOURS`); the hub's heartbeat (latest `lastSeenAt` of the location's active GATEWAY
devices, refreshed by every sync call) older than `HUB_HEARTBEAT_STALE_SECONDS` (180) → `OFFLINE`;
otherwise `OPEN`. Placing an order answers `RESTAURANT_OFFLINE` (503) or `ONLINE_ORDERING_DISABLED`
(409, with `state` and `reason`). The restaurant manages the setting, hours, pickup/delivery and
the delivery fee at `PUT /locations/:lid/online-ordering` (`online_ordering.manage`); `OFFLINE` is
never set by hand.

### Payment

- **Pay at pickup / cash on delivery** records nothing: the POS takes the money at handover, in a
  shift, as for any order.
- **Online card** goes through the `PaymentProvider` abstraction. The only adapter is
  `MockOnlinePaymentProvider` (`ONLINE_PAYMENT_PROVIDER=mock`, refused in production): test tokens
  `tok_mock_…` stand in for what a gateway's browser SDK returns, `tok_mock_decline…` is declined,
  and card numbers never reach the API. The charge is captured at checkout (no order is created if
  it is declined) and recorded as a drawer-less payment: `payments.shift_id` became nullable, only
  for `ONLINE` (database CHECK), and the POS no longer lists online tenders.
- **Voids are append-only.** When the restaurant rejects the order, or it times out, the cloud
  calls the provider's void (`cancelPayment`) and records a `REFUND` row of the charge
  (`reason = "VOID: <reason>"`); the order becomes `REFUNDED` in payment status. Financial rows
  are still never edited.

### Tracking

`GET /api/v1/orders/track` with the token in the `x-tracking-token` header (never in the API URL,
so not in logs; redacted from log lines). The token is `<orderId>.<HMAC-SHA256(orderId)>` with
`TRACKING_TOKEN_SECRET` (derived from `JWT_ACCESS_SECRET` when unset): nothing is stored, and an
invalid token looks exactly like an unknown order (404). The answer is a customer view without
staff, device or internal fields; cancel reasons are shown as codes (`TOO_BUSY`, …,
`ACCEPTANCE_TIMEOUT`, `OTHER` for free text). The website polls every 5 seconds until a final
status (SSE was not needed for this). Order creation and tracking have their own per-IP rate-limit
budgets (`WEB_ORDER_RATE_LIMIT_PER_MINUTE`, `TRACKING_RATE_LIMIT_PER_MINUTE`).

### Reaching the restaurant: the ORDER topic

- The cloud's `ChangeRecorder` port (a no-op until now) is `WebOrderChangeRecorder`: every
  transaction that creates or changes a website order (creation, the timeout, a cloud staff
  action, a void) appends an `ORDER` entry (`entityId` = order id, `locationId` = its location) in
  that transaction, under the same per-restaurant advisory lock as the configuration triggers, so
  `seq` order stays commit order. Orders and tickets pushed by hubs are not echoed back.
- Code, not triggers, records it: the push path writes orders too, and must not announce its own
  writes to the hub that sent them.
- The hub handles a feed page in order: a `CONFIG` entry refreshes the snapshot first (so a new
  product exists before an order uses it; a foreign-key failure triggers one more refresh), then
  each announced order is fetched once at its newest state from `GET /sync/orders/:id` (the outbox
  payload shape, 404 for another location) and stored. A failure leaves the cursor in place.
- The hub publishes `order.created` / `order.updated` / `order.cancelled` on its LAN socket; the
  POS shows a banner and opens a dialog for each new website order, with a countdown to
  `acceptBy`.

### Ownership hand-over

- **The cloud owns a website order while it is `PLACED`.** The hub stores the cloud's copy and
  remembers the cloud version it received (hub-only `inbound_orders`). The hub refuses to edit
  such an order (`AWAITING_ACCEPTANCE`) and to accept it after `acceptBy` (`ACCEPTANCE_EXPIRED`).
  The decision belongs to the restaurant, at its hub, where the kitchen is: in the cloud, staff
  transitions of a waiting website order are refused (`DECIDED_AT_RESTAURANT`); the cloud's only
  decision is the acceptance timeout (which also voids the payment). Customer- or support-initiated
  cancellation is therefore not offered yet.
- **Accepting (PLACED→CONFIRMED) or rejecting (→CANCELLED) at the POS is an ordinary hub change**:
  the transition writes the outbox row (and the kitchen tickets on acceptance), and the existing
  push sends it, now with `baseVersion` = the version received.
- The cloud's `claim()` (apps/api/src/modules/sync/apply-operation.ts) allows the first hub write
  of a cloud row only as a hand-over: the row is a website order of the hub's location, still
  `PLACED`, at exactly `baseVersion`, and the pushed state is no longer `PLACED`. Then the ledger
  records the hub's version and the hub owns the order; later pushes follow ADR 0012. Everything
  else is `SYNC_CONFLICT`: no or another `baseVersion`, an edit before deciding, or an order the
  cloud already decided. A hub cannot create a website order (`REJECTED`).
- After a rejection hand-over the cloud voids the online payment in the same transaction and
  announces the order; the hub merges only the cloud's online payment rows into an order it owns
  (no version bump, no outbox row). Payment rows are append-only on both sides, so this cannot
  conflict.

### Acceptance timeout

A sweep in the cloud (`WEB_ORDER_TIMEOUT_SWEEP_SECONDS`, 15) cancels website orders still
`PLACED` 30 seconds after `acceptBy` (the grace lets an acceptance made just in time arrive): a new
SYSTEM transition PLACED→CANCELLED with reason `ACCEPTANCE_TIMEOUT`, the payment voided, an
`ORDER` entry, an audit row. The row is locked first, so the sweep and a hub's hand-over decide
in one order: whichever locks first wins, and the other gets nothing or a conflict.

When the hub accepted while it was offline and the cloud cancelled first, **the cloud's decision
stands**: the acceptance push is a conflict; when the cancellation arrives on the feed, the hub
takes the cloud's copy, cancels the kitchen tickets it opened, and marks its own unsent change
`COMPLETED` with `SYNC_SUPERSEDED` (not a failure waiting for a manager). This answers the open
question left in the architecture document.

### Customer website

`apps/customer-web` (React, Vite, TanStack Query, react-router, zustand, `@pos/ui`, `@pos/app-kit`,
`@pos/api-client`'s storefront client): restaurant landing (branches with status, pickup/delivery,
fee and hours), menu by category, product options with the domain's `validateSelection`, cart,
guest checkout, confirmation and order status by token; English and Arabic with full RTL; the cart
and language are kept in localStorage, the placed order's token in sessionStorage. One deployment
serves one restaurant (`VITE_RESTAURANT_SLUG`).

## Consequences

- The customer site depends on the cloud only; a hub outage turns the branch `OFFLINE` within
  three minutes instead of taking orders nobody sees, and unaccepted orders are cancelled and
  voided by the cloud.
- The hub keeps working offline with website orders it already received; decisions made offline
  are reconciled by the hand-over rule, and the cloud's timeout wins over a late acceptance.
- The mock adapter is the only online payment path. A real gateway should authorize at checkout,
  capture on acceptance, void on rejection, and run provider calls outside the database
  transaction (an outbox for voids); the interface already has those operations.
- Customer accounts, saved addresses, delivery zones, scheduled orders, promo codes and SSE are not
  built; the guest flow covers the specification.
- The delivery fee is untaxed and flat per location.
