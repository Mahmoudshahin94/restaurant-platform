# Cloud API

Base path `/api/v1`. Health endpoints are unversioned: `GET /health` (liveness) and
`GET /ready` (checks the database).

## Conventions

- **Contracts:** every request body, param and query is validated with a Zod schema from
  `@pos/validation`. Response types are inferred from the same schemas and used by
  `@pos/api-client`, which can also validate responses at runtime.
- **IDs** are UUIDs (v7 for new rows). Malformed ids answer `404`, the same as unknown ones.
- **Money** is integer minor units of the restaurant currency (`1850` = 18.50 SAR).
- **Timestamps** are ISO-8601 UTC strings.
- **Request ids:** send `x-request-id` (8–128 chars `[A-Za-z0-9._-]`) to correlate; otherwise
  one is generated. It is always echoed in the `x-request-id` response header and the error
  body.
- **Client source:** send `x-client-source: POS | KDS | WEBSITE | ADMIN | HUB` so audit entries
  record where an action came from (default `ADMIN`).

## Errors

Every error response has the same shape:

```json
{
  "code": "INSUFFICIENT_PERMISSION",
  "message": "Missing required permissions",
  "details": { "missing": ["settings.manage"] },
  "requestId": "…"
}
```

`code` is one of `ERROR_CODES` in `@pos/shared-types`; the HTTP status mapping is in
`apps/api/src/common/errors/http-status.ts`. Clients show `t('errors:<code>')`. `message` is for
developers and may change. Validation failures (`400 VALIDATION_FAILED`) list
`details.issues[] = { path, code, message }`. Unexpected failures return
`500 INTERNAL_ERROR` without internals; the stack is logged server-side with the request id.

## Authentication

| Method | Path            | Auth                 | Notes                                                                        |
| ------ | --------------- | -------------------- | ---------------------------------------------------------------------------- |
| POST   | `/auth/login`   | public, rate-limited | `{ email, password, client?: 'web' \| 'native' }` → `TokenResponse`          |
| POST   | `/auth/refresh` | public, rate-limited | Native: `{ refreshToken }`. Web: httpOnly cookie `pos_rt` + allowed `Origin` |
| POST   | `/auth/logout`  | public               | Revokes the refresh-token family; clears the cookie                          |
| GET    | `/auth/me`      | bearer               | Current user with role assignments                                           |

- Access token: HS256 JWT (`iss=pos-kds-api`, `aud=pos-kds`, `sub=userId`, `rid=restaurantId`),
  15 minutes by default. Expired tokens answer `401 TOKEN_EXPIRED`; clients refresh once and
  retry (built into `@pos/api-client`).
- Refresh tokens rotate on every use. Re-presenting a used token answers `401 TOKEN_REUSED` and
  revokes the whole session family. Exception: within `REFRESH_REUSE_GRACE_SECONDS` (default 10)
  of its rotation, a token is treated as a benign race, such as two tabs or a double-fired
  effect. The request fails with `401 UNAUTHENTICATED` (`details.reason = "ROTATED"`) and the
  session stays valid. Clients should still single-flight refreshes (`apps/admin/src/lib/api.ts`).
- Web refresh tokens live only in an httpOnly, SameSite=strict cookie scoped to `/api/v1/auth`.
  Cookie-authenticated calls also require an `Origin` from `CORS_ORIGINS` (CSRF defense).
- Unknown emails and wrong passwords return the same `INVALID_CREDENTIALS` with equalized
  timing. Disabled accounts get `ACCOUNT_DISABLED`.
- Login and refresh have their own per-IP rate-limit budget (`AUTH_RATE_LIMIT_PER_MINUTE`).

## Authorization

- **Deny by default.** A non-public route without `@RequirePermissions(...)` is rejected.
- Permissions are re-read from the database on every request, never trusted from the token, so
  revocations apply immediately.
- `:restaurantId` must be the caller's restaurant, otherwise `404 RESTAURANT_NOT_FOUND`.
  `:locationId` must belong to it and be reachable through the caller's roles, otherwise
  `404 LOCATION_NOT_FOUND`.
- Scope: with `:locationId`, location-scoped and restaurant-wide roles both count. Without it,
  only restaurant-wide roles count, so a branch manager cannot change restaurant-wide settings.
  List endpoints marked `any-location` filter results to the caller's locations.

## Tenancy endpoints

| Method | Path                                   | Permission                                                   |
| ------ | -------------------------------------- | ------------------------------------------------------------ |
| GET    | `/restaurants/:restaurantId`           | any member                                                   |
| PATCH  | `/restaurants/:restaurantId`           | `settings.manage` (restaurant-wide). Currency cannot change. |
| GET    | `/restaurants/:restaurantId/locations` | `locations.view` (any location; filtered)                    |
| POST   | `/restaurants/:restaurantId/locations` | `settings.manage` (restaurant-wide)                          |
| GET    | `/locations/:locationId`               | `locations.view`                                             |
| PATCH  | `/locations/:locationId`               | `settings.manage`                                            |

Restaurants are provisioned by the seed (development) or a future platform-operator flow. There
is no self-service signup.

## Menu endpoints (Phase 1)

Catalog definitions are restaurant-level. Availability ("86") and price overrides are
per location. Rows are **archived, never deleted**, because historical orders and sync
operations reference them.

| Method         | Path                                                                  | Permission                            |
| -------------- | --------------------------------------------------------------------- | ------------------------------------- |
| GET            | `/restaurants/:rid/categories?includeArchived=true`                   | `products.view` (any location)        |
| POST           | `/restaurants/:rid/categories`                                        | `products.create`                     |
| PATCH          | `/restaurants/:rid/categories/:categoryId`                            | `products.update`                     |
| POST           | `/restaurants/:rid/categories/:categoryId/archive` · `/restore`       | `products.delete` · `products.update` |
| GET/POST/PATCH | `/restaurants/:rid/kitchen-stations[/:stationId]` (+ archive/restore) | same pattern                          |
| GET/POST/PATCH | `/restaurants/:rid/modifier-groups[/:groupId]` (+ archive/restore)    | same pattern                          |
| GET            | `/restaurants/:rid/products?categoryId=&search=&includeArchived=`     | `products.view` (any location)        |
| GET/POST/PATCH | `/restaurants/:rid/products[/:productId]` (+ archive/restore)         | same pattern                          |
| GET            | `/locations/:locationId/menu`                                         | `products.view` at the location       |
| GET            | `/locations/:locationId/product-settings`                             | `products.view` at the location       |
| PUT            | `/locations/:locationId/products/:productId/settings`                 | `products.update` at the location     |

Semantics:

- **Products** take `variants`, `modifierGroups` (`{ modifierGroupId, sortOrder, minSelect?,
maxSelect? }` with optional per-product overrides) and `stationIds`. On `PATCH`, `variants` is
  the complete desired list: entries with an `id` are updated, entries without are created, and
  omitted variants are archived. `modifierGroups` and `stationIds` replace the current links.
- **Modifier groups** use the same full-list semantics for `modifiers`. The resulting group must
  satisfy `0 ≤ minSelect ≤ #modifiers` and `maxSelect ∈ {null, ≥ max(1, minSelect)}`; otherwise
  the answer is `400 VALIDATION_FAILED`. The database enforces the same with CHECK constraints.
- References (category, modifier groups, stations) must belong to the restaurant and not be
  archived. Otherwise the answer is the specific `*_NOT_FOUND` code with the offending ids.
- A duplicate `sku` (per restaurant) or station `code` answers `409 CONFLICT`.
- **Location settings:** `{ isAvailable, priceOverride }`. Price overrides apply only to
  products without variants (`400`, `reason: PRICE_OVERRIDE_WITH_VARIANTS`).
- **Published menu** (`GET /locations/:id/menu`) is built by `resolveLocationMenu()` in
  `@pos/domain`. Archived rows are removed, availability and overrides applied, and min/max
  overrides resolved. Unavailable products stay listed with `isAvailable: false`, so screens can
  show them as sold out. The response carries `version` (a content hash), equal to the `ETag`
  header. Send `If-None-Match` to get `304` when nothing changed. The POS/hub will poll it
  cheaply.
- **Audit:** `category.*`, `kitchen_station.*`, `modifier_group.*`, `product.created/updated/
archived/restored`, `product.price_changed` (base, variant and location override, with
  from/to), `modifier.price_changed`, and `location_product.updated`.

## Pricing configuration (Phase 2)

| Method     | Path                                                                  | Permission                      |
| ---------- | --------------------------------------------------------------------- | ------------------------------- |
| GET        | `/restaurants/:rid/taxes`                                             | `products.view` (any location)  |
| POST/PATCH | `/restaurants/:rid/taxes[/:taxId]`, `…/archive`, `…/restore`          | `settings.manage`               |
| GET        | `/restaurants/:rid/discounts`                                         | any member (the POS lists them) |
| POST/PATCH | `/restaurants/:rid/discounts[/:discountId]`, `…/archive`, `…/restore` | `settings.manage`               |

Products accept `taxIds`. The published menu includes `taxes` (with `rateBps`) and each
product's `taxIds`. Rate changes are audited as `tax.rate_changed` and affect only orders priced
afterwards.

## Floor plan (Phase 2)

| Method | Path                                                      | Permission                                      |
| ------ | --------------------------------------------------------- | ----------------------------------------------- |
| GET    | `/locations/:lid/floor`                                   | `orders.view`: sections → tables → `openOrders` |
| POST   | `/locations/:lid/floor/sections`, `/floor/tables`         | `tables.manage`                                 |
| PATCH  | `/locations/:lid/floor/sections/:id`, `/floor/tables/:id` | `tables.manage`                                 |
| POST   | `…/archive`, `…/restore`                                  | `tables.manage`                                 |

Mutations return the refreshed floor.

## Orders (Phase 2)

| Method | Path                                                                                     | Permission                                                       |
| ------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| POST   | `/locations/:lid/orders`                                                                 | `orders.create` (+ `orders.discount` when discounts are applied) |
| GET    | `/locations/:lid/orders?open=true&status=PLACED,CONFIRMED&businessDate=&tableId=&limit=` | `orders.view`                                                    |
| GET    | `/locations/:lid/orders/:orderId`                                                        | `orders.view`                                                    |
| PUT    | `/locations/:lid/orders/:orderId`                                                        | `orders.update` (+ `orders.discount` if discounts change)        |
| POST   | `/locations/:lid/orders/:orderId/transitions`                                            | per transition (see the state machine)                           |

- **Create** takes `{ id, channel, status?: DRAFT|PLACED|CONFIRMED, items[{ id, productId, variantId,
modifierIds, quantity, notes }], discountIds, tableId, customerName, customerPhone,
guestCount, notes }`. The `id` is a client-generated UUID and the **idempotency key**:
  resending it returns the existing order with `200` instead of `201` (concurrent duplicates
  included). Channels: `DINE_IN` needs a table of the location; `PHONE`/`DELIVERY` need a
  customer name or phone; `WEBSITE` is rejected (customer API, Phase 7). `CONFIRMED` (what the
  POS sends since Phase 4) accepts the order at once and sends it to the kitchen; `PLACED` waits
  for acceptance.
- **Prices are never accepted from clients.** Every create/update re-validates items against the
  location's published menu (`quoteOrder`) and re-prices with `priceOrder`. Unknown fields such
  as `total` or `unitPrice` are stripped by validation.
- **Update** replaces items, discounts and details. It is allowed only in `DRAFT`/`PLACED`/
  `CONFIRMED` (`409 INVALID_ORDER_STATE`, `reason: NOT_MODIFIABLE`) and requires the current
  `version` (`409 CONFLICT`, `reason: STALE_VERSION`, `currentVersion`). Editing a confirmed
  order rewrites its kitchen tickets (see Kitchen); once a station has started, the order is
  PREPARING and no longer editable.
- **Transitions** take `{ to, reason?, version? }` and are validated by `assertTransition`.
  Failure reasons: `NOT_ALLOWED` (with the allowed targets), `SYSTEM_ONLY` (PREPARING/READY come
  from the kitchen), `REASON_REQUIRED` (cancellations), `UNPAID` (completion),
  `KITCHEN_PENDING` (completing a confirmed order the kitchen still has). The specific
  permission is `orders.update`, `orders.cancel` or `orders.refund`.
- **Audit:** `order.created`, `order.discount_applied`, `order.modified` (before/after totals),
  `order.status_changed`, `order.cancelled`.

## Payments (Phase 3)

| Method | Path                                                          | Permission                       |
| ------ | ------------------------------------------------------------- | -------------------------------- |
| GET    | `/restaurants/:rid/payment-methods`                           | any role at one of its locations |
| POST   | `/locations/:lid/orders/:orderId/payments`                    | `payments.create`                |
| POST   | `/locations/:lid/orders/:orderId/payments/:paymentId/refunds` | `payments.refund`                |

- **Charge** takes `{ id, shiftId, paymentMethodId, amount, tendered?, reference? }`. The `id`
  is a client-generated UUID and the idempotency key: a resend (including a concurrent one)
  returns the order with the original payment. The order row is locked (`SELECT … FOR UPDATE`)
  for the whole charge, so two terminals can never over-pay the same balance.
- **An open shift is required** (`SHIFT_NOT_FOUND` / `409 SHIFT_NOT_OPEN`); every payment and
  refund records the shift whose drawer it touched.
- **Split payments** are several charges. `amount` must be `1 … balanceDue`
  (`422 PAYMENT_FAILED`, `reason: INVALID_AMOUNT | ALREADY_PAID`). Orders can be paid in
  `PLACED` … `READY` (`reason: NOT_PAYABLE` otherwise).
- **Cash** may be over-tendered: `change = tendered − amount` (`INSUFFICIENT_TENDERED` when
  short). When the location has `cashRoundingIncrement` set (off by default) the payment that
  settles the balance in cash is rounded; the difference is stored as `roundingAdjustment` and
  never changes the order total.
- **Card** is an externally approved payment (standalone terminal): `reference` is the approval
  code, max 64 chars. Anything that looks like a card number (13–19 digits) is rejected
  (`422 VALIDATION_FAILED`, `reason: LOOKS_LIKE_CARD_NUMBER`) and never stored. `tendered` is
  rejected for non-cash methods.
- **Online** methods go through the provider registry; until a gateway is configured they fail
  with `reason: PROVIDER_NOT_CONFIGURED`.
- **Refund** takes `{ id, shiftId, amount, reason }` against one charge: at most what is left of
  it (`422 REFUND_NOT_ALLOWED`, `reason: EXCEEDS_REFUNDABLE | REASON_REQUIRED`). Cash refunds are
  paid out of the given shift's drawer. When a completed order is fully refunded it moves
  `COMPLETED → REFUNDED` as a system transition.
- Payment rows are append-only; `paymentStatus` (`UNPAID` … `REFUNDED`) is derived from them on
  every change. Orders also expose `payments[]`, `paidTotal`, `refundedTotal` and `balanceDue`.
- Order guards that involve money: cancelling with money held answers
  `409 INVALID_ORDER_STATE` (`reason: REFUND_FIRST`); an edit that would push the total below what
  is held answers `reason: BELOW_PAID`.
- **Audit:** `payment.captured`, `payment.refunded` (references only, never card data).

## Shifts and cash drawer (Phase 3)

| Method | Path                                                  | Permission      |
| ------ | ----------------------------------------------------- | --------------- |
| GET    | `/locations/:lid/cash-registers`                      | `shifts.manage` |
| GET    | `/locations/:lid/shifts?status=OPEN&limit=`           | `shifts.manage` |
| GET    | `/locations/:lid/shifts/:shiftId`                     | `shifts.manage` |
| POST   | `/locations/:lid/shifts`                              | `shifts.manage` |
| POST   | `/locations/:lid/shifts/:shiftId/cash-movements`      | `cash.manage`   |
| POST   | `/locations/:lid/shifts/:shiftId/close`               | `shifts.manage` |
| GET    | `/locations/:lid/reports/daily-summary?businessDate=` | `shifts.manage` |

- **Open** takes `{ id, cashRegisterId, openingFloat }` (idempotent by `id`). One open shift per
  drawer is enforced by a unique column (`409 SHIFT_ALREADY_OPEN`).
- **Cash movements** take `{ id, type: PAY_IN|PAY_OUT, amount, reason }`.
- **Close** takes `{ countedCash, notes? }` and stores `expectedCash` (float + cash sales − cash
  refunds + pay-ins − pay-outs, rounding included), `countedCash` and `cashDifference`
  (negative = short).
- A shift response carries a live `summary` (cash breakdown, totals per payment method, order
  count) and its cash transactions.
- The **daily summary** covers one business date in the location's timezone: order counts, sales
  (subtotal, discounts, tax, total), per-channel totals, per-method payments and net collected.
- **Audit:** `shift.opened`, `shift.closed`, `cash.pay_in`, `cash.pay_out`.

## Kitchen (Phase 4)

| Method | Path                                                           | Permission       |
| ------ | -------------------------------------------------------------- | ---------------- |
| GET    | `/locations/:lid/kitchen/settings`                             | `kitchen.view`   |
| GET    | `/locations/:lid/kitchen/tickets?stationIds=&view=&limit=`     | `kitchen.view`   |
| GET    | `/locations/:lid/kitchen/tickets/:ticketId`                    | `kitchen.view`   |
| POST   | `/locations/:lid/kitchen/tickets/:ticketId/transitions`        | `kitchen.update` |
| POST   | `/locations/:lid/kitchen/tickets/:ticketId/priority`           | `kitchen.update` |
| POST   | `/locations/:lid/kitchen/tickets/:ticketId/items/:itemId/done` | `kitchen.update` |
| POST   | `/locations/:lid/kitchen/tickets/:ticketId/dismiss`            | `kitchen.update` |
| POST   | `/locations/:lid/orders/:orderId/kitchen-priority`             | `orders.update`  |

- **Routing:** when an order becomes `CONFIRMED`, it gets one ticket per station. Each line goes
  to every station of its product (snapshot `stationIds`); lines without a station are not sent.
  Edits before the kitchen starts rewrite NEW tickets (their `revision` goes up only when what
  the cook sees changes), open tickets for new stations, and cancel tickets whose station lost
  all its items. Cancelling the order cancels its live tickets; completing it bumps READY ones.
- **Settings** returns the restaurant's stations and the location's `warnMinutes`/`lateMinutes`
  (`Location.kdsWarnMinutes`/`kdsLateMinutes`, editable through `PATCH /locations/:lid`; late
  must be above warn).
- **List:** `view=active` (default) returns NEW/PREPARING/READY tickets plus cancelled ones not yet
  dismissed, rush first then oldest; `view=completed` returns tickets bumped in the last 12 hours,
  newest first. `stationIds` is a comma-separated filter (omitted = every station).
- **Transitions** take `{ to: PREPARING|READY|COMPLETED, version }`: start, ready (also straight
  from NEW), bump, undo-ready (READY → PREPARING) and recall (COMPLETED → READY). Errors:
  `409 INVALID_TICKET_STATE` (`reason: NOT_ALLOWED | SYSTEM_ONLY | ORDER_CLOSED`) and
  `409 CONFLICT` (`reason: STALE_VERSION`) when another screen acted first. The order row is
  locked for every ticket change, so the order moves CONFIRMED → PREPARING (first start),
  → READY (all live tickets ready) and back READY → PREPARING (undo) exactly once, recorded as
  system transitions with the KDS as source.
- **Priority** `{ priority: NORMAL|RUSH, version }` per ticket, or for every live ticket of an order
  from the POS. **Item done** `{ done }` strikes a line. **Dismiss** `{ version }` acknowledges a
  cancelled ticket.
- Orders expose `tickets[]` (`stationId`, station names, `status`, `priority`) for the POS.
- **Audit:** `kitchen.ticket_recalled`, `kitchen.priority_changed`, and `order.status_changed`
  with `trigger: KITCHEN` for derived order statuses.

## Realtime (Phase 4)

`GET /api/v1/realtime` upgrades to a WebSocket; see [events.md](events.md) for the protocol and
event list.

## Security headers and limits

- `@fastify/helmet` defaults, CORS allowlist from `CORS_ORIGINS` (credentials enabled), a 1 MB
  body limit.
- A global rate limit of `RATE_LIMIT_PER_MINUTE` per IP, plus the separate auth budget above.

## Observability

Structured JSON logs (pino) include `reqId`, `userId`, `restaurantId` and `locationId`.
Authorization headers, cookies, passwords, tokens, PINs and card fields are redacted. Audit
entries record actor, source, request id and redacted metadata for: login, failed login, logout,
refresh-token reuse, restaurant/location changes, and (Phase 1) catalog changes including price
changes.
