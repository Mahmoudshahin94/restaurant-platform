# ADR 0017: The tenant is the root, and tenant isolation is enforced by the database client

- Status: Accepted (2026-10-23)

## Context

MADAR turns the restaurant platform into a multi-tenant commerce platform: one codebase and one
cloud serving many independent businesses (restaurants, coffee shops, supermarkets, clothing and
other stores), see the [migration plan](../madar/migration-plan.md). The data model was already
tenant-shaped: every business row carried `restaurantId` and the guards answered `404` for another
restaurant's `:restaurantId`/`:locationId` ([ADR 0016](0016-hardening.md) walks every route).
Two things did not fit a multi-business platform:

- The root entity was called a restaurant, in the database, the API, the code and the UI.
- Isolation inside a request rested on convention: every service had to remember
  `where: { restaurantId }` on every query, and nothing failed when one did not. A route guard
  cannot see a foreign id passed in a body or nested in a path of the caller's own location.

No deployment held real data (development only), so the rename could be made directly, without a
period of accepting both names.

## Decision

### Restaurant becomes Tenant, everywhere

- A **rename, not a rebuild**: table `restaurants` → `tenants`, every `restaurant_id` →
  `tenant_id` (with its indexes and foreign keys), Prisma `Tenant`/`tenantId`, routes
  `/tenants/:tenantId/*` and `/public/tenants/:slug`, the access token claim `tid`, the request and
  log context field `tenantId`, error codes `TENANT_NOT_FOUND`, and wording in both languages
  (business, store for customers, location for a site and its hub).
  - Error codes that named the restaurant for a _location_ say so: `LOCATION_OFFLINE`,
    `OWNED_BY_LOCATION`, `DECIDED_AT_LOCATION`.
- The cloud migration (`20261023120000_tenant_rename`) renames in place. It also replaces the
  change-feed functions, because they read `restaurant_id` out of row JSON and would otherwise have
  stopped recording changes **without any error**: `change_log_tenant()` replaces
  `change_log_restaurant()`, `record_config_change()` keeps its name so the 23 triggers stay
  attached, and the root table's trigger is attached again with the kind `tenant`. The report
  views are dropped and created again, because a view keeps the output column names it was
  created with.
- The hub migration (`20261023135333_tenant_rename`) is written by hand as SQLite renames instead
  of the table copies Prisma generates, so a paired hub keeps its data. SQLite updates the foreign
  keys that point at a renamed table or column. Indexes cannot be renamed, so they are dropped and
  created again. The hub's pairing record (`hub_state`) is rewritten from `restaurantId` to
  `tenantId` in the same migration. The migrator's upgrade test now starts from a hub holding
  orders, payments, cash and a pairing from before the rename.
- The snapshot's `format` is `2`, because the payload's top-level key changed.
- **Not renamed:** the `@pos/*` package scope (internal, not user-visible), the POS app identifier
  and keychain service (Phase M3, branding), and historical records (migrations, earlier ADRs).

### The tenant's profile

- `legalName`, plus `businessType`: text validated against `BusinessType` in `@pos/shared-types`,
  so a new type is a code change, not a migration. The type only picks default configuration
  (Phase M2); code asks for capabilities, never for the type.
- `status` (`ACTIVE`/`SUSPENDED`/`ARCHIVED`), set by the platform operator (Phase M9 enforces
  `SUSPENDED`).
- `supportedLocales`: JSON, so it works on SQLite too. It always includes the default locale.
- Tenant staff may change the legal name and locales; the business type and status belong to the
  platform. The currency stays fixed after provisioning ([ADR 0002](0002-money-integer-minor-units.md)).

### Tenant context and the tenant-scoped client

- **`TenantContext`** (`@pos/server`, AsyncLocalStorage) says which tenant the current call chain
  works for:
  - The request's tenant comes from the guards: the access token, or a hub's device credential.
  - Work outside a request names its tenant with `runInTenant(tenantId, fn)`.
  - Inside a request belonging to another tenant, `runInTenant` refuses: a handler never switches
    tenants.
  - Both helpers await the callback inside the scope, because Prisma queries are lazy and run only
    when awaited.
- **`scopeToTenant(client)`** is a Prisma client extension. `PrismaModule` gives it to every
  service as `PrismaService`. For every model that has a `tenantId` (read from the generated
  client's DMMF, so new models are covered automatically), and for `Tenant` by its `id`:
  - Reads, counts, aggregates, updates and deletes get `AND tenantId = <scope>` added to their
    filter. A caller asking for another tenant's rows gets none, because both conditions must
    hold.
  - Creates, upserts and updates that would write another tenant's id, or connect another tenant,
    throw `TenantScopeError`.
  - Tenants themselves are created only outside any tenant (provisioning).
- **Without a tenant in scope:**
  - The cloud holds every tenant, so a tenant query there is a bug and is refused.
  - The location hub's database holds only the tenant it is paired with (see the snapshot below),
    so its background work (sync engine, snapshot) runs as is. Its staff requests are still scoped
    by their token.
- The services' own `where: { tenantId }` filters stay, as defence in depth.
- **Explicitly cross-tenant work** goes through `runUnscoped(reason, fn)`. The lint rule
  `pos-local/no-unscoped-prisma` reports it everywhere except a reviewed allowlist in
  `eslint.config.js`, and there requires a literal reason. The allowlist:
  - Sign-in lookups: an e-mail is unique across tenants, so sign-in needs no tenant selector.
  - The device guard: a credential names a device, and the device names its tenant.
  - The permission catalog at start-up: system roles of every tenant get new permissions.
  - The website-order sweep, which finds due orders across tenants and then cancels each inside
    its own tenant.
  - The storefront's tenant resolution.
- **Public routes** (the customer website) carry no tenant. `PublicTenantResolver` first finds the
  tenant of what the route names (the tenant's slug, a location, a tracked order) and the route
  works inside that tenant only. Browser-supplied ids are looked up, never trusted as a tenant.
  Phase M7 replaces the slug with the verified host name.

### What the client does not cover, and why that is acceptable

- **Raw SQL** is not seen by the extension. Every raw query binds the caller's own location ids or
  record ids:
  - Reports (`apps/api/src/modules/reports`) and the customer search: the caller's permitted
    locations.
  - Row locks (`FOR UPDATE` by order id inside a scoped transaction), counters by location,
    ledger and change-log writes by the device's scope, and the health check.

  New raw SQL must do the same. A report test runs identical orders for two tenants.

- **Nested writes and `include`s** are reached through a scoped parent: an order's lines are
  created with the order and read through it.
- **Row-level security** in PostgreSQL would also cover raw SQL. It is deferred: it needs a
  per-transaction session variable with pooled connections, and has no SQLite counterpart. The
  extension gives the same guarantee to everything that goes through Prisma, on both databases.

### The hub holds one tenant

The hub refuses a snapshot whose tenant, or any row's `tenantId`, is not the tenant it was paired
with, and keeps its last copy. PIN sign-in exists only on the hub (the cloud answers `404`). Should
an employee code ever match staff of two tenants, nobody is signed in, rather than an arbitrary
one.

### Provisioning

`provisionTenant` (`@pos/database`) creates a tenant with its locations and roles, always with a
system Owner role. It is idempotent by slug and never overwrites a tenant's own settings. The
development seed provisions through it: the demo restaurant, plus a coffee shop, a supermarket and
a clothing store (ILS, Asia/Hebron), whose owner accounts are optional `SEED_*` variables. The
platform operator's API (Phase M9) will provision through it as well. The shekel (ILS, 2 decimals)
was added to the supported currencies.

## Consequences

- A forgotten tenant filter can no longer leak or change another tenant's data through Prisma. A
  missing tenant scope in the cloud fails loudly (500, logged) instead of reading every tenant.
- Code running outside a request must name its tenant. Tests calling services directly do the same
  (`TenantContext.runInTenant`).
- `apps/api/test/tenant-isolation.test.ts` covers the cases a route guard cannot see: tenant A
  reaching B's orders, products, categories, staff and audit entries through A's own routes;
  ordering B's products; a forged `tenantId` in a body; reusing B's order id; report SQL over both
  tenants. It also checks the scoped client on PostgreSQL, every change-feed lookup kind after the
  rename, and provisioning. The hub suite checks the scoped client on SQLite and the snapshot and
  PIN rules.
- Isolation of tenant **files** has no storage to test yet. It arrives with tenant branding uploads
  (Phase M3), under the same rule.
