# ADR 0014: Admin portal: staff permissions, cloud changes to hub-owned data, and resolving sync conflicts

- Status: Accepted (2026-10-18)

## Context

Phase 8 completes the admin portal (`apps/admin`): dashboard, restaurant and location settings,
online ordering, users, roles and employees, payment setup, orders, customers, payments, shifts,
devices, synchronization and the audit log. Three questions needed a decision beyond "add a
screen":

1. Changing what people may do is the most sensitive thing the portal does. Who may grant what?
2. The cloud now lets administrators act on orders (refunds). Since ADR 0012 a location hub owns
   the orders it created, and since ADR 0013 also accepted website orders. A cloud change to such
   an order would either be overwritten by the hub's next push or turn it into a conflict.
3. ADR 0012 keeps refused hub changes (`CONFLICT`/`REJECTED`) for administrators but gave them no
   way to settle one. The specification asks that a conflict be resolvable without silently
   overwriting data.

## Decision

### Staff and permissions

- Users, roles and employees are cloud-only admin endpoints (`apps/api/src/modules/admin`),
  restaurant-wide (`users.manage`, `roles.manage`); hubs receive them through the configuration
  change feed, as before.
- **No escalation.** Granting or removing a role at a scope (a location, or restaurant-wide)
  requires holding each of the role's permissions at that scope; creating, widening or narrowing a
  role requires holding the permissions restaurant-wide (`assertCanGrant` in `@pos/domain`).
  Deactivating someone or resetting their password counts as acting on all of their roles.
- **Employees act as their linked user at the POS** (PIN sign-in uses the user's roles, Phase 5).
  Linking a user to an employee, or setting the PIN of a linked employee, therefore requires
  holding that user's permissions: otherwise a staff administrator could give themselves the
  Owner's powers through a PIN.
- **System roles** (Owner) hold every permission, including keys added later
  (`syncPermissionCatalog` grants new keys at start-up), and cannot be edited or deleted. The
  restaurant always keeps an active user with a system role restaurant-wide (`LAST_OWNER`).
  Nobody changes their own roles or deactivates themselves (`SELF`).
- Deactivation and password resets revoke the user's refresh tokens at once; permissions are
  re-read on every request anyway (Phase 0).
- Every change is audited: `user.created`, `user.updated`, `user.deactivated`,
  `user.reactivated`, `user.roles_changed` (assignments before and after), `user.password_reset`,
  `role.created`, `role.updated`, `role.permissions_changed` (added and removed), `role.deleted`,
  `employee.created`, `employee.updated`, `employee.user_linked`, `employee.deactivated`,
  `employee.pin_set`, `employee.pin_reset`. Passwords and PINs never appear (the audit redactor
  would also remove them).
- A new permission, `sync.resolve`, separates resolving sync conflicts from viewing them.

### Cloud changes to orders a hub owns

- An order is **hub-owned** in the cloud once the cloud has applied a change of it pushed by a hub
  (an `APPLIED` ledger row; website orders after the hand-over). The cloud refuses staff edits,
  transitions, charges and refunds of such orders with `409 INVALID_ORDER_STATE`,
  `reason: OWNED_BY_RESTAURANT`: they are made at the POS, which also holds the cash drawer.
- **Online card payments stay with the cloud** (ADR 0013): an administrator can refund an online
  charge from the portal (`POST /locations/:lid/payments/:paymentId/refunds`, `payments.refund`),
  also on a hub-owned order. Like a void, it is an append-only `REFUND` row without a drawer; the
  payment status follows; the order's `version` does not change, so the hub's next push is not a
  conflict; an `ORDER` change tells the hub, which merges online payment rows. A fully refunded
  order stays `COMPLETED` with payment status `REFUNDED` (the order status is the hub's).
  Refunds are refused while a website order still waits for the restaurant (its rejection or the
  timeout voids it).
- Online voids are now audited too (`payment.voided`), so every payment correction is in the
  audit log.

### Resolving refused hub changes

The rule: **a refused change is never applied or dropped without a person deciding, and the
version that loses is kept.**

- The cloud now stores the hub's refused state with the refusal (`processed_operations.payload`,
  cloud-only). The admin portal shows it next to the cloud's current copy (status, payment status,
  totals, lines, payments, version, and the full data).
- An administrator with `sync.view` + `sync.resolve` at the location chooses, with a required note
  (`POST /locations/:lid/sync/issues/:operationId/resolve`):
  - **Apply the restaurant's version** (`APPLY_HUB`), for ownership conflicts
    (`CONFLICT`/`SYNC_CONFLICT`) whose state was stored. The cloud's copy is written to the audit
    log first (`sync.issue_resolved` with `cloudBefore`), then the hub's state is applied as a
    push would, without the ownership check: scope, schema and child checks still apply, payments
    stay append-only (a payment that differs from the cloud's still refuses), and a clash with
    another record (e.g. the same order number on the same day) leaves the issue open
    (`APPLY_FAILED`). The payment status is re-derived from every recorded payment; a website
    order the restaurant rejected has its online payment voided. The ledger row becomes `APPLIED`
    with the hub's version, so the hub's later changes follow ordinary ownership.
  - **Keep the cloud's version** (`KEEP_CLOUD`), for orders only, and refused when the cloud has
    no copy (`NOT_IN_CLOUD`: the sale would be lost) or when the hub's copy holds payments the
    cloud has not recorded (`HUB_HAS_PAYMENTS`: money taken at the till must arrive). The ledger
    row keeps the hub's state and records the decision and the cloud version it settled on.
  - **Ask the hub to resend** (`RESEND`), after the cause was fixed elsewhere; the cloud judges the
    resend like any push. Not possible when the hub that sent it was disabled (`HUB_DISABLED`);
    the other two choices still are, so a replaced hub's stored changes can be rescued.
- The decision reaches the hub through the change feed: a `RESOLUTION` entry (entity = operation
  id); the hub fetches `GET /sync/resolutions/:operationId` (device credential):
  - `RESEND` (after `APPLY_HUB` or a resend request): the entity's `FAILED` operations go back to
    the queue; the cloud answers `DUPLICATE` for the one it applied.
  - `ADOPT_CLOUD` (after `KEEP_CLOUD`), with the cloud's order: the hub stores it (the same code
    path as website orders), cancels kitchen tickets if the cloud's order is cancelled, marks its
    unsent changes of the order `COMPLETED` with `SYNC_SUPERSEDED`, and records the cloud version
    as `baseVersion` for its next change. Payments the hub took that the cloud's copy lacks are
    kept and sent with a new change based on that version.
- **The cloud enforces the kept version.** After `KEEP_CLOUD` the ledger's baseline for the order
  is the kept cloud version; a hub change must carry `baseVersion` equal to it, so a change made
  before the hub adopted the cloud's copy is a `CONFLICT` instead of silently overwriting the
  decision. A repeat of the settled operation answers `DUPLICATE` with code `SYNC_SUPERSEDED`.
- Every decision is audited (`sync.issue_resolved`, `sync.resend_requested`) with the note and a
  summary of the hub's version.

### Smaller choices

- **Customers** are grouped from the contact details on orders (phone number, trimmed); there is no
  customer account yet. Their key is a SHA-256 of the phone, so phone numbers never appear in URLs.
- **Searches** (orders, payments, customers, audit log) span the caller's locations: only those
  where they hold the list's permission. Restaurant-level audit entries (staff, roles,
  configuration) need `audit.view` restaurant-wide. Audit metadata is redacted again when read.
- **Dashboard** is deliberately small: per location, today's orders, sales, collected money, open
  shifts, what online customers see, and the hub link (only with `sync.view`). Reports are
  Phase 9.
- **Payment methods** keep their type once created (payments snapshot it), are archived rather
  than deleted, and the last cash method cannot be archived; **cash drawers** with an open shift
  cannot be archived.
- **Devices**: the portal shows the hub's connection (heard from within the 3-minute heartbeat
  window) and its last reported outbox; pairing stays the hub-side command (the credential is
  only ever shown once), with a manual "pair here" for exceptional cases.

## Consequences

- A conflict always ends in an explicit, attributed decision, and neither side's data is lost:
  the hub's version stays in the ledger, the cloud's in the audit log.
- Administrators cannot fix an order-number clash by choosing a version: the number has to change
  first (no screen for that yet). Since Phase 6 the hub continues the cloud's numbering, so such
  clashes only come from data recorded before it.
- `KEEP_CLOUD` exists for orders only; for shifts and kitchen tickets the hub's version is the
  only one that can be applied (the cloud never edits them).
- Cloud staff can no longer change hub-owned orders through the API, which was possible (and
  would have produced conflicts) before.
