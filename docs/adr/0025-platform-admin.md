# ADR 0025: The platform admin is a separate identity; tenants are suspended by status; repairs are previewed, confirmed and audited

- Status: Accepted (2026-10-28)

## Context

MADAR's operators need their own console (Phase M9 of the [migration plan](../madar/migration-plan.md)):
provision a business, suspend or reactivate it, see its locations, staff, devices and versions,
configure its modules, verify its domains, look at its payment setup, watch the health of every
location's hub, read audit logs, and repair the occasional broken record. Four things needed a
decision beyond "add screens":

1. **Who is an operator?** Tenant staff have roles per tenant and location. A platform permission
   granted through the same identity would make every tenant administrator one bug away from
   every other tenant.
2. **What does suspension do?** The tenant `status` (ADR 0017) existed but nothing read it, and a
   suspended business still has hubs that push sales and a website that takes orders.
3. **How do operators fix data without a database console?** Support work is where silent damage
   happens: a typo in a hand-written UPDATE changes money.
4. **Where do operators see failures?** Hubs report their outboxes (ADR 0012), the cloud keeps
   refused operations (ADR 0014), but server errors exist only in logs.

## Decision

### A separate identity

- **`PlatformUser`** (cloud-only): e-mail, argon2id hash, display name, role
  `OWNER|OPERATOR|SUPPORT|VIEWER`, locale, active flag, a failed-sign-in counter and lock. It has
  no tenant and no relation to `User`; **a tenant user can never hold a platform permission** and
  a platform user is never a member of a tenant.
- **Tokens:** audience `madar-platform`, issuer `madar-api`, signed with `PLATFORM_JWT_SECRET`
  (derived from `JWT_ACCESS_SECRET` with HMAC when unset, so the two keys always differ). The
  staff guard refuses a platform token on its signature before reading the audience, and the
  platform guard refuses a staff token the same way.
- **Refresh:** `PlatformRefreshToken` (hash only, families, reuse detection, as for staff), a day
  at most, in the httpOnly SameSite=strict cookie `madar_prt` scoped to `/api/v1/platform/auth`
  with the same `Origin` check. Browser only: there is no native platform client.
- **Sign-in** is rate-limited per address (the transport's auth budget) and per account (five
  wrong passwords lock the account for fifteen minutes). Every sign-in, failure, lock, reuse and
  sign-out is in the platform audit log; an unknown e-mail costs the same time as a wrong password.
- **No sign-up.** `pnpm platform:create-owner` creates the first owner (and, until a user screen
  exists, other operators: `--role`), with the password from `PLATFORM_USER_PASSWORD`, never the
  command line.
- **A second factor** (TOTP or WebAuthn for every platform account) is the documented follow-up;
  it is the main remaining weakness of an identity that opens every tenant.

### Permissions and the `platform` route class

- **The catalog** (`PLATFORM_PERMISSIONS`, `@pos/shared-types`): `tenants.view`,
  `tenants.provision`, `tenants.status`, `tenants.configure`, `tenants.payments.view`,
  `health.view`, `audit.view`, `support.find`, `support.repair`. It is a different type from the
  tenant catalog. Roles are fixed in code: OWNER and OPERATOR hold everything, SUPPORT reads and
  finds, VIEWER only reads.
- **`@RequirePlatformPermissions([...])`** marks a platform route. The global staff guards let it
  through; the controller's **`PlatformGuard`** authenticates the operator (loaded fresh, so a
  deactivated account stops at once), checks the permissions, and for a `:tenantId` route answers
  `404 TENANT_NOT_FOUND` or scopes the request to that tenant, so the tenant-scoped client
  confines every query to it exactly as for its own staff.
- **The route inventory** has a seventh class, `platform`. The start-up check refuses a platform
  route without `PlatformGuard`, one that also asks for tenant permissions or devices, and a public
  route carrying platform permissions. The security tests walk every `/platform` route without a
  token and with a tenant token (`401`), and every staff, hub and device route with a platform
  token (`401`).
- **Attribution:** inside a platform request, tenant audit entries, order status history and
  ledger decisions record the operator: `ActorType.PLATFORM` with the platform user's id and
  `ActionSource.PLATFORM`, which only the platform guard can set. The tenant's own audit log
  therefore shows "platform support" next to its staff.

### Tenant status

- **`assertTenantAccess(status, read|write)`** (`@pos/domain`): ACTIVE allows everything,
  SUSPENDED nothing (`403 TENANT_SUSPENDED`), ARCHIVED reading only (`403 TENANT_ARCHIVED` for
  any other method). It is applied to:
  - **staff:** every request (`AccessService.loadPrincipal`, so the realtime socket too), sign-in
    and refresh. Refresh tokens are not revoked: the session continues after reactivation;
  - **hubs:** the cloud's device guard, on pull and push. The hub keeps serving its LAN from its
    last snapshot, as when the cloud is unreachable, and keeps its outbox: it treats the refusal
    as "cloud unavailable" (backoff), not as a rejected credential, so **no sale is lost** and
    everything arrives once the tenant is reactivated. A suspended hub is still marked as seen,
    so the health board shows it online;
  - **the website:** `HostTenantGuard`, before the route's modules are checked.
- The platform's own routes ignore the status: operators must reach a suspended tenant. The
  platform's configuration changes and repairs are refused for an archived tenant too.
- **Transitions** (`TENANT_STATUS_TRANSITIONS`): ACTIVE → SUSPENDED or ARCHIVED, SUSPENDED →
  ACTIVE or ARCHIVED, ARCHIVED → ACTIVE (restore). Each needs a reason and is written to both
  audit logs.

### Provisioning

`POST /platform/tenants` provisions through `provisionTenant` (`@pos/database`, ADR 0017), in one
transaction: the tenant (currency ILS by default), its first location, the system Owner role,
its owner account, its entitlements and its `<slug>.<PLATFORM_WEB_DOMAIN>` subdomain (verified,
primary, ADR 0023). `provisionTenant` gained `owner` (created with the Owner role tenant-wide;
an e-mail of another tenant's account is refused) and `entitlements` (written for a new tenant
only). Without explicit entitlements the business type's default modules are entitled and the
others are not: **a business type is now a plan**. A slug or e-mail in use is `409 CONFLICT`
(`SLUG_TAKEN`/`EMAIL_TAKEN`) rather than merged into the existing tenant, unlike the idempotent
seed. The owner's password is a generated one-time password, returned once and never stored or
audited; the owner signs in with it and an administrator can reset it.

### Support tools: preview → confirm → execute

- **A catalog, not an editor** (`SupportOperationKey`): `sync.retry`, `sync.reprocess`,
  `order.correct_status`, `order_item.correct_product`, `order.recalculate_totals`,
  `entity.restore`. Each names its parameters (validated as a discriminated union) and the roles
  that may run it (`SUPPORT_OPERATION_ROLES`). **There is no SQL console and no free-form edit.**
- **Preview** (`support.repair`) reads the record inside the tenant's scope and answers the
  tenant, the record, its state before, the state after, the changed fields, whether it can be
  executed and, if not, why (`blockedReason`). It changes nothing.
- **Confirmation:** an executable preview carries a token: an HMAC (key derived from the platform
  key) over the operation, tenant, a hash of the parameters, the operator and **a hash of the
  canonical before-state**, valid for five minutes. Executing recomputes the before-state and
  needs the token back: another operator's token, other parameters or a forged token are
  `422 SUPPORT_CONFIRMATION_INVALID`; an expired one or a record that changed since is
  `409 SUPPORT_PREVIEW_STALE`, and the operator looks again instead of overwriting what changed.
  Stateless: nothing to clean up, and a token cannot be replayed once the record moved on.
- **Execute** also needs a reason (5–500 characters) and runs through the same rules and services
  as the tenant's own changes. It writes **a platform audit entry and a tenant audit entry**
  (`support.repair_executed`), both with the operation, parameters, reason, before, after and the
  changed fields.
- **The repairs:**
  - **Sync** (ADR 0014): `sync.retry` is `RESEND`, `sync.reprocess` is `APPLY_HUB`, through
    `SyncAdminService.resolve` and its rules (`syncResolutionOptions` decides what is allowed);
    the ledger records the operator as the resolver.
  - **Order status:** `OrdersService.transitionAsSystem` with a support actor: only the
    state machine's SYSTEM rules, with their guards (paid before handing over). On top: nothing
    may be cancelled while money is held (`REFUND_FIRST`), nothing marked REFUNDED unless its
    payments are (`NOT_REFUNDED`), and an order a hub owns is corrected at the location
    (`OWNED_BY_LOCATION`). The kitchen follows as for any transition.
  - **Product mapping:** an order line's `productId`/`variantId` point at another product of the
    tenant; the line's snapshot (names, prices, codes) is untouched, so receipts and money do not
    change, reports group it correctly. Refused for an open order a hub owns.
  - **Totals:** recomputed from the order's own stored lines, discount and tax rows and fees with
    the pricing engine's formula (`totalsFromStoredLines`, ADR 0002), never re-priced from the
    current menu (per-line tax rates are not stored). **An open order** is corrected (version
    bumped, payment status re-derived, change feed). **A finalized order** only gets the diff:
    the preview reports it with `FINALIZED` and no confirmation, and nothing is changed: money
    was taken on those totals.
  - **Restore:** an archived category, product, modifier group, kitchen station, tax, discount,
    payment method or cash drawer of the tenant. A clash with a live record is `409`.
- **Find** (`support.find`): orders by id or number, customers by phone or name, products by id,
  name, SKU or barcode, payments by id, order or provider reference, sync operations by operation
  or entity id. Read-only, at most 20 results, no secrets or hashes.

### Health and errors

- **Per tenant and location:** hubs and terminals heard from within `HUB_HEARTBEAT_STALE_SECONDS`
  with the versions they report (ADR 0022), the hubs' reported outbox (pending, failed), refused
  changes nobody settled, the last sync (the hub's last contact or the last change received), the
  newest order, and recent server errors. The board shows one row per tenant.
- **`PlatformErrorEvent`** (cloud-only): the exception filter hands every 5xx answer to an
  `ErrorEventSink` when the application provides one (the cloud does; the hub does not). It keeps
  the route pattern (never the URL or body), the code, the tenant and location, the request id and
  a message redacted of e-mails, phone and card numbers, bearer and device credentials and long
  tokens, cut at 500 characters. At most `PLATFORM_ERROR_SAMPLE_PER_MINUTE` per route and code are
  stored each minute; the next stored one counts what was dropped. Writing is in the background
  and never fails the answer.

### Audit

- **`PlatformAuditLog`** (cloud-only): actor, the tenant concerned (`subjectTenantId`, not a
  tenant scope), action, entity, redacted metadata, request id. **Append-only by the database**:
  a trigger refuses UPDATE and DELETE.
- Every platform action on a tenant (provisioning, status, entitlements, domain verification,
  repairs) is written to both logs; the platform reads a tenant's log with operator names.

### The app

`apps/platform-admin` (port 5177): the same `@pos/ui`, MADAR's own branding
(`PLATFORM_BRAND.products.platform`), English and Arabic with RTL, light and dark. Sign-in;
tenants (search, filters, provisioning with the owner's one-time password shown once); a tenant's
tabs (overview and status, locations, users, devices and versions, modules, branding, domains,
payments, health, audit); support tools (find, then preview → confirm with a reason →
execute); the health board; the platform audit log. Navigation and actions follow the role; the
server enforces anyway.

## Consequences

- Nothing a tenant administrator can do or be granted reaches the platform, and a stolen staff
  token is worthless on the platform's routes (and the other way round).
- A suspended business stops at once everywhere it is online, loses no data, and resumes where it
  was. Its LAN keeps working offline until its hub's next contact is refused, by design: a till
  in the middle of service is never cut off remotely.
- Repairs are slower than a database console, on purpose: each needs a preview, a reason and a
  fresh confirmation, and leaves a before/after trail in two logs. Anything not in the catalog
  is a code change, reviewed like any other.
- New tables are cloud-only; the hub needed no migration (two enum values are text on SQLite).

### Deferred

- A second factor for platform accounts, and a platform users screen (create, deactivate,
  change role); the CLI covers both meanwhile.
- Plans and billing on top of entitlements; impersonation (deliberately absent: operators act as
  themselves).
- Closing open realtime sockets of a tenant at suspension (they end with their access token, at
  most `JWT_ACCESS_TTL_SECONDS`).
- Error events of the hubs themselves (they have no sink yet) and retention of error events.
- The ledger's `resolvedById` may now name a platform user; the tenant admin shows such a decision
  by its audit entry (actor `PLATFORM`).
