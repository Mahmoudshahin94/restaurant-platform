# ADR 0018: Modules are capabilities, resolved in layers and enforced on cloud and hub

- Status: Accepted (2026-10-23)

## Context

After M1 ([ADR 0017](0017-tenant-root-and-isolation.md)) every business is a tenant with a
business type, but every tenant still gets the restaurant: a kitchen screen, a floor plan,
modifier groups, the customer website. A supermarket has no kitchen; a clothing store seats nobody;
a coffee shop has a kitchen screen but no tables. MADAR must serve all of them from one codebase,
configured, never forked ([migration plan](../madar/migration-plan.md),
[configuration](../configuration.md)).

Three things make that harder than a list of flags:

- The type is a starting point, not an identity. A restaurant may go without tables; one branch
  of a chain may have a kitchen screen the others lack. Code that asks "is this a restaurant?"
  is wrong as soon as a tenant differs from its type's default.
- MADAR sells modules. A tenant cannot switch on what its plan does not include, and some modules
  the platform keeps to itself.
- The location hub must enforce the same answer offline: a POS at a location without a kitchen
  screen must not create tickets nobody sees, cloud or no cloud.

## Decision

### A catalog of capabilities

`Feature` in `@pos/shared-types` lists the modules: `POS`, `KDS`, `KITCHEN_PRINTER`,
`ONLINE_ORDERING`, `BARCODE`, `INVENTORY`, `TABLES`, `MODIFIERS`, `PRODUCT_VARIANTS`, `DELIVERY`,
`SELF_CHECKOUT`, `CUSTOMER_DISPLAY`, `LOYALTY`, `ADVANCED_REPORTING`. Modules are stored as text,
so a new one is a code change. Several modules (barcodes, inventory, kiosks, loyalty) belong to
later phases. They are listed now so plans and defaults can name them.

### Resolution in layers, capped by the platform

`resolveLayered` (`@pos/domain`, `config/`) resolves any setting through the layers of
[configuration.md](../configuration.md): platform defaults, then business-type defaults, then the
tenant, a location and a device. The most specific layer that says something wins, and every
result names that layer. `resolveFeatures` uses it for modules:

- **Platform defaults:** the till (`POS`) only.
- **Business-type defaults** (`BUSINESS_TYPE_DEFAULTS`, `features/defaults.ts`):
  - Restaurant: the kitchen (`KDS`, `KITCHEN_PRINTER`), `TABLES`, `MODIFIERS`,
    `PRODUCT_VARIANTS`, `ONLINE_ORDERING` and `DELIVERY`.
  - Coffee shop: `KDS`, `MODIFIERS`, `ONLINE_ORDERING` and `SELF_CHECKOUT`.
  - Supermarket and grocery: barcodes, inventory, self-checkout, customer display, delivery and
    loyalty.
  - Clothing and retail: barcodes, inventory, variants, customer display and loyalty.
  - Other: the platform defaults.
- **Overrides** (`FeatureOverride`) are set by the tenant's administrators, for the whole tenant,
  one location or one device.
- **Entitlements** (`TenantEntitlement`, per tenant and module) are the platform operator's:
  - `entitled`: without it the module is off everywhere, whatever any layer says. The result
    reports `entitled: false` and source `PLATFORM`.
  - `tenantConfigurable`: without it the tenant, location and device layers are ignored, and the
    API refuses to write them (`403 FEATURE_NOT_CONFIGURABLE`, reason `NOT_ENTITLED` or
    `PLATFORM_MANAGED`).
  - A module without a row is entitled and configurable. Until the platform admin sells plans
    (Phase M9), every tenant may use every module.

### Data

- `tenant_entitlements`: the primary key is (tenant, feature). The platform operator writes it
  (seed and tests today, the platform API in Phase M9).
- `feature_overrides`:
  - Columns: tenant, optional location, optional device, feature, enabled.
  - A device's override also names the device's location, so a hub's snapshot finds it by
    location.
  - Uniqueness per scope uses a derived `scope` column (`tenant`, `location:<id>`,
    `device:<id>`). The reason: nullable columns never collide in a unique index on PostgreSQL or
    SQLite. A check constraint in the cloud keeps the column consistent with the ids.
- Both tables are configuration. They get change-feed triggers (`record_config_change('self')`)
  and ride the snapshot, which is now format `3`. The snapshot also carries the location's devices
  (identity only: no credential hash, no last-seen time), because device overrides reference them.
- The hub migration is two plain `CREATE TABLE`s, checked by hand.

### Enforcement

- **`FeatureService`** (`@pos/server`) resolves the modules of a scope (tenant, location, device)
  from the same rows on the cloud (PostgreSQL) and on the hub (SQLite, from its snapshot).
  - Results are memoized per request: guards run before the request context exists, so the memo
    lives on the request and is handed to the context.
  - A caller inside a transaction passes its client. This matters on SQLite, which has one writer.
- **`@RequireFeature(Feature.X)`** on a controller or handler, checked by the global
  `FeatureGuard` after authentication and permissions. Gated today:
  - The kitchen routes need `KDS`, including the POS's kitchen priority.
  - The floor routes need `TABLES`.
  - Online-ordering settings, the storefront and website orders need `ONLINE_ORDERING`.
  - A module that is off answers `403 FEATURE_DISABLED` with `details.feature`. The module is
    resolved for the route's `:locationId`, otherwise for the tenant.
- **Public routes** have no tenant until the route finds one. The guard passes their modules on
  through the request context, and `PublicTenantResolver` checks them right after it has found the
  tenant (and location) from the slug, location or tracked order, before anything is read.
- **The route inventory** records each route's modules. The security suite holds the list of gated
  routes, so a new gate is a deliberate change. It calls every one of them with its module off
  (`403 FEATURE_DISABLED`) and again with it on (no `403`).

### Behaviour follows capabilities, never the type

- **Without `KDS`:** a confirmed order creates no kitchen ticket and reopens none, and it can be
  completed without waiting for the kitchen. Tickets made before the module was switched off still
  follow their order.
- **Without `TABLES`:** dine-in needs no table, and no order may name one (`FEATURE_DISABLED`).
  The rule moved from the request schema to the orders service, which knows the location's
  modules.
- **Without `MODIFIERS`:** the published menu has no modifier groups. Nothing is shown, nothing is
  required, and a modifier in an order is refused like any modifier not on the menu. The menu's
  version changes, so screens reload it.
- **The lint rule `pos-local/no-business-type-branching`** reports any comparison, `switch` or
  `.includes` on `businessType` or a `BusinessType.*` value outside `features/defaults.ts`.

### Apps

- `GET /tenants/:tenantId/context?locationId=` answers what every app renders: identity,
  branding (names until M3), currency, locales and the resolved modules. Any member of the tenant
  may read it, and the cloud and the hub both serve it.
- `@pos/app-kit`:
  - `TenantProvider` loads the context and renders its children only once it has it, so no screen
    flashes a module that is off. It refreshes every minute and keeps the previous location's
    context while switching.
  - `useFeature`, `useFeatures` and `<FeatureGate>` read it.
- **POS:**
  - The Tables screen, its navigation item and its shortcut appear only with `TABLES`, and so does
    the cart's table picker. Dine-in then asks for guests only.
  - The options dialog offers modifiers only with `MODIFIERS`.
  - Kitchen progress, rush and the wait for the kitchen appear only with `KDS`.
- **KDS:** without `KDS` for the chosen location, the app says the module is off, offering
  another location or sign-out, instead of calling routes the hub refuses.
- **Admin:**
  - Navigation hides kitchen stations, modifier groups, online ordering and tables when their
    module is off at the location chosen in the header. Their pages say the module is off and
    link to the Modules page.
  - The new Modules page (Settings → Modules, `settings.manage` tenant-wide, EN/AR, RTL) lists
    the modules the tenant may switch. For the whole business or one location, each shows its
    value, the layer it comes from, and a choice of inherit, on or off.
  - The API for this page is `GET`/`PUT /tenants/:tenantId/features`. Each change is audited
    (`feature.override_changed`).

## Consequences

- A business type is a template: after provisioning it decides nothing that a tenant, location or
  device setting cannot change, and code that branches on it fails lint.
- Switching a module off takes effect at once in the cloud. A hub applies it with the next
  snapshot (the change feed signals it), and open apps follow within a minute. Data stays: a floor
  plan, modifier groups or kitchen stations come back with the module.
- The guard protects routes, and the services protect the behaviour behind routes that serve
  every module (orders, menus). Both read the same resolution.
- Device overrides are resolved and enforced wherever a request names its device. Today only hubs
  are devices: staff apps do not identify their terminal, so the Modules page offers the tenant
  and locations, and the API accepts a `deviceId`. Device identity for POS, KDS and kiosks comes
  with Phases M6 and M10.
- The admin's navigation follows the location chosen in its header, which is an approximation for
  tenant-wide pages such as modifier groups when locations differ.
