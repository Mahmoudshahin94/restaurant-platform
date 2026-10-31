# Cloud API

Base path `/api/v1`. Health endpoints are unversioned: `GET /health` (liveness; answers
`{ "status": "ok", "version": "1.0.0" }`, the MADAR version the server runs, ADR 0026) and
`GET /ready` (checks the database). The location hub answers both the same way.

## Conventions

- **Contracts:** every request body, param and query is validated with a Zod schema from
  `@pos/validation`. Response types are inferred from the same schemas and used by
  `@pos/api-client`, which can also validate responses at runtime.
- **IDs** are UUIDs (v7 for new rows). Malformed ids answer `404`, the same as unknown ones.
- **Money** is integer minor units of the tenant currency (`1850` = ₪18.50).
- **Timestamps** are ISO-8601 UTC strings.
- **Request ids:** send `x-request-id` (8–128 chars `[A-Za-z0-9._-]`) to correlate; otherwise
  one is generated. It is always echoed in the `x-request-id` response header and the error
  body.
- **Client source:** send `x-client-source: POS | KDS | WEBSITE | ADMIN` so audit entries
  record where an action came from (default `ADMIN`). `HUB` is honoured only from a paired hub
  (device credential) and `SYSTEM` never (Phase 10); other values fall back to `ADMIN`.
- **Client version** (MADAR M10, [ADR 0026](adr/0026-versions-and-releases.md)): every MADAR app
  and hub sends `x-madar-client-version: <its MADAR version>` (a semantic version; anything else
  is ignored). Devices have it recorded as their version. An app older than the cloud serves gets
  `426 CLIENT_UPGRADE_REQUIRED` on every route, before anything else answers, with
  `details: { minimumVersion, version }`; a hub gets `426 HUB_UPGRADE_REQUIRED` on `/sync/*`
  (also when it sends no version once a hub minimum exists). The platform's routes and callers
  that send no version are never refused for it.

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
developers and may change. A route whose module is off for the tenant or location answers
`403 FEATURE_DISABLED` with `details.feature` ([ADR 0018](adr/0018-feature-modules.md)).
Validation failures (`400 VALIDATION_FAILED`) list
`details.issues[] = { path, code, message }`. Unexpected failures return
`500 INTERNAL_ERROR` without internals; the stack is logged server-side with the request id
(for database errors only their kind and code, never the query's arguments). `GET /ready` answers
`503 SERVICE_UNAVAILABLE` when the database cannot be reached.

## Authentication

| Method | Path            | Auth                   | Notes                                                                                                  |
| ------ | --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/login`   | public, rate-limited   | `{ email, password, tenantId?, client?: 'web' \| 'native' }` → `TokenResponse`                         |
| POST   | `/auth/refresh` | public, rate-limited   | Native: `{ refreshToken }`. Web: httpOnly cookie `pos_rt` + allowed `Origin`                           |
| POST   | `/auth/switch`  | bearer + refresh token | `{ tenantId, refreshToken? }` → `TokenResponse` for the same account's user in that brand (cloud only) |
| POST   | `/auth/logout`  | public                 | Revokes the refresh-token family; clears the cookie                                                    |
| GET    | `/auth/me`      | bearer                 | Current user with role assignments, brands and organizations                                           |

- **Accounts and brands** (E1, [ADR 0029](adr/0029-organizations-and-accounts.md)): the e-mail and
  password belong to an account, which has one user per brand. `tenantId` on login names the brand to
  sign into; without it, or when that brand is not usable for the account, sign-in uses the brand
  signed into last, else the oldest. The e-mail is trimmed and lower-cased (` Owner@Demo.Local` is
  `owner@demo.local`). `TokenResponse.user` (also `GET /auth/me`) carries `accountId`, `tenantId` (the
  brand of this session), `tenants` (`[{ id, nameEn, nameAr, logoFileId, organizationId }]`, one per
  usable brand of the account) and `organizations` (`[{ id, nameEn, nameAr, role }]`, empty for a
  person who is in none). A person with no usable brand gets `403 ACCOUNT_DISABLED` (or
  `TENANT_SUSPENDED` when a suspended brand is the reason); neither names a brand.
- **`POST /auth/switch`** moves a signed-in person to another brand of their account without a
  password. It needs the caller's own live refresh token (cookie or body, as `/auth/refresh`; an
  access token alone is not enough, `401 UNAUTHENTICATED`), revokes that token's session family and
  starts a new one for the account's user in `tenantId`, returned as login does (the cookie for web,
  `refreshToken` for native). A brand the account has no usable user in answers `404 TENANT_NOT_FOUND`,
  as a foreign tenant does; the hub answers `404`. Switching to the current brand starts a new
  session. `auth.switch` is audited in both brands. A person removed from an organization is
  refused at once: `/auth/switch` into another brand answers `404` and `/auth/refresh`
  `ACCOUNT_DISABLED`.
- Access token: HS256 JWT (`iss=pos-kds-api`, `aud=pos-kds`, `sub=userId`, `tid=tenantId`),
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
- **Tenant status** (MADAR M9, ADR 0025): a suspended tenant's staff get `403 TENANT_SUSPENDED` on
  sign-in, refresh and every request (and the realtime socket); an archived tenant's may sign in
  and read, and get `403 TENANT_ARCHIVED` on anything else. Platform tokens are refused here
  (`401`): they are for `/platform/*` only.

## Authorization

- **Deny by default.** A non-public route without `@RequirePermissions(...)` (or
  `@DeviceRoute(...)` or `@HostRoute()`, below) is rejected, at start-up already.
- **Website routes** (MADAR M7, [ADR 0023](adr/0023-multi-tenant-website.md)) take no credential:
  their tenant is the one whose **verified** domain the request's host names (`HostTenantGuard`;
  `X-Forwarded-Host` only behind `TRUST_PROXY`). An unknown, pending, failed or disabled host
  answers `404 SITE_NOT_FOUND`; a `:locationId` (or a body's `locationId`) of another tenant
  `404 LOCATION_NOT_FOUND`. Tenant ids, slugs and headers sent by the browser are ignored.
- **Device routes** (MADAR M6, [ADR 0022](adr/0022-self-service-kiosk.md)) serve paired terminals
  only: `Authorization: Device <deviceId>.<secret>` of an `ACTIVE` terminal of the route's types.
  A staff token there answers `401`, as does a device credential on any staff route. The route's
  `:locationId` must be the device's own (`404 LOCATION_NOT_FOUND`), and modules resolve with the
  device's layer. Requests may send `x-madar-client-version`, recorded as the device's version.
- **Organization routes** (E1) take a staff token and name an `:organizationId`. The caller's
  account must be a member of that `ACTIVE` organization, whichever brand they are signed into: a
  stranger, a person with access to one brand only and a suspended organization all answer
  `404 ORGANIZATION_NOT_FOUND`; a member whose organization role the route does not allow answers
  `403 INSUFFICIENT_PERMISSION` (`details.role`). Handlers read the organization's brands and write
  nothing. The route inventory lists these routes as `organization`.
- Permissions are re-read from the database on every request, never trusted from the token, so
  revocations apply immediately.
- `:tenantId` must be the caller's tenant, otherwise `404 TENANT_NOT_FOUND`.
  `:locationId` must belong to it and be reachable through the caller's roles, otherwise
  `404 LOCATION_NOT_FOUND`.
- Scope: with `:locationId`, location-scoped and tenant-wide roles both count. Without it,
  only tenant-wide roles count, so a branch manager cannot change tenant-wide settings.
  List endpoints marked `any-location` filter results to the caller's locations.
- **Inside a handler** every query is limited to the caller's tenant by the tenant-scoped database
  client ([ADR 0017](adr/0017-tenant-root-and-isolation.md)): an id of another tenant's row, also in
  a body or under the caller's own `:locationId`, is simply not found. A `tenantId` sent in a body
  is ignored.

## Tenancy endpoints

| Method | Path                           | Permission                                               |
| ------ | ------------------------------ | -------------------------------------------------------- |
| GET    | `/tenants/:tenantId`           | any member                                               |
| PATCH  | `/tenants/:tenantId`           | `settings.manage` (tenant-wide). Currency cannot change. |
| GET    | `/tenants/:tenantId/context`   | any member (cloud and hub)                               |
| GET    | `/tenants/:tenantId/locations` | `locations.view` (any location; filtered)                |
| POST   | `/tenants/:tenantId/locations` | `settings.manage` (tenant-wide)                          |
| GET    | `/locations/:locationId`       | `locations.view`                                         |
| PATCH  | `/locations/:locationId`       | `settings.manage`                                        |

A tenant answers its profile too: `legalName`, `businessType` (`RESTAURANT`, `COFFEE_SHOP`,
`SUPERMARKET`, `GROCERY`, `CLOTHING`, `RETAIL`, `OTHER`), `status` and `supportedLocales`. `PATCH`
accepts the names, `legalName` and `timezone` only, strictly: the business type and status are
the platform operator's, the currency is fixed (ADR 0002) and the languages have their own
endpoint (below), so sending any of them answers `400 VALIDATION_FAILED`.

Tenants are provisioned by the seed (development, through `provisionTenant`) or the platform
operator (Phase M9). There is no self-service signup.

`GET /tenants/:tenantId/context?locationId=&surface=` is what every app renders from
([ADR 0018](adr/0018-feature-modules.md)): `tenant` (id, slug, names, business type, status,
time zone), `branding` (resolved for `surface`, see below), `currency`, `locales`,
`locationId` and `features`. `currency` ([ADR 0020](adr/0020-currency-and-localization.md)) is
`{ code, decimalPlaces, symbol, display, formatLocale, sources }`; `locales` is
`{ default, supported, digits, sources }`. `features` holds every module, resolved for the
location (or the tenant):

- `{ feature, enabled, source, entitled, configurable }`;
- `source` is the deciding layer: `PLATFORM`, `BUSINESS_TYPE`, `TENANT`, `SURFACE`, `LOCATION`
  or `DEVICE`.

`branding` ([ADR 0019](adr/0019-branding-and-theme.md)) is the tenant's branding resolved for
`surface` (`login`, `pos`, `kds`, `kiosk`, `website`; none: the tenant's defaults): display
names, `logoFileId`, `faviconFileId`, `primaryColor`/`secondaryColor`/`accentColor` (`#rrggbb`
or null for the theme's own), `fontFamily`, `logoSize`, `themeMode`, `surfaceStyle`,
`borderRadius`, `surface`, and `sources` (the layer of each value: `PLATFORM`, `TENANT` or
`SURFACE`). The device's own light/dark choice is applied by the app.

A location of another tenant answers `404 LOCATION_NOT_FOUND`.

## Language and currency (Phase M4)

[ADR 0020](adr/0020-currency-and-localization.md).

| Method | Path                                            | Permission                      |
| ------ | ----------------------------------------------- | ------------------------------- |
| GET    | `/tenants/:tid/localization`                    | `settings.manage` (tenant-wide) |
| PUT    | `/tenants/:tid/localization` (cloud; hub `403`) | `settings.manage` (tenant-wide) |
| GET    | `/hub/locales` (hub only)                       | public                          |

- **GET** answers `{ settings, currency, locales, updatedAt }`: the tenant's own values
  (`defaultLocale`, `supportedLocales`, and `digits`, `currencySymbol`, `currencyDisplay`,
  `currencyFormatLocale`, each null to inherit MADAR's) and what its screens get, as in the
  context.
- **PUT** replaces all six settings. The body is strict: `currencyCode` or `decimalPlaces` (or
  any unknown field) answers `400 VALIDATION_FAILED`, as do an empty or repeated locale list, a
  default locale outside the supported ones (`path: supportedLocales`), a symbol longer than 8
  characters or containing digits or control marks, a display other than `narrowSymbol`,
  `symbol`, `code`, a format locale outside `FORMAT_LOCALES` and digits other than `latn`,
  `arab`. Audit: `localization.updated` (with the values before).
- **`/hub/locales`** gives the POS and KDS sign-in screens their business's languages
  (`{ default, supported, digits, sources }`) from the hub's snapshot; `503 HUB_NOT_PROVISIONED`
  before the first one.
- `GET /public/site` carries the same `currency` and `locales` for the website.

## Modules (Phase M2)

| Method | Path                                                 | Permission                      |
| ------ | ---------------------------------------------------- | ------------------------------- |
| GET    | `/tenants/:tid/features?locationId=&deviceId=`       | `settings.manage` (tenant-wide) |
| PUT    | `/tenants/:tid/features/:feature` (cloud; hub `403`) | `settings.manage` (tenant-wide) |

- **List** returns every module for the scope (the tenant, a location or a device) with
  `inherited: { enabled, source }` (what the scope gets without its own override) and
  `override` (`true`/`false`/`null`).
- **Set** takes `{ locationId?, deviceId?, enabled: boolean | null }`; `null` removes the
  override. A device's location is its own. It answers the refreshed list. A module outside the
  tenant's plan or managed by the platform answers `403 FEATURE_NOT_CONFIGURABLE`
  (`reason: NOT_ENTITLED | PLATFORM_MANAGED`). Audit: `feature.override_changed`.
- Entitlements have no tenant API: the platform operator sets them (Phase M9).

## Branding and tenant files (Phase M3)

[ADR 0019](adr/0019-branding-and-theme.md).

| Method | Path                                                                                      | Permission                      |
| ------ | ----------------------------------------------------------------------------------------- | ------------------------------- |
| GET    | `/tenants/:tid/branding`                                                                  | `settings.manage` (tenant-wide) |
| PUT    | `/tenants/:tid/branding` (cloud; hub `403`)                                               | `settings.manage` (tenant-wide) |
| POST   | `/tenants/:tid/files?kind=LOGO\|FAVICON\|PRODUCT_IMAGE\|WEBSITE_IMAGE` (cloud; hub `403`) | `settings.manage` (tenant-wide) |
| GET    | `/tenants/:tid/files`                                                                     | `settings.manage` (tenant-wide) |
| GET    | `/tenants/:tid/files/:fileId/content`                                                     | any member (cloud and hub)      |
| GET    | `/public/site/files/:fileId` (the host's tenant, M7)                                      | website (`ONLINE_ORDERING`)     |
| GET    | `/hub/branding?surface=` (hub only, default `login`)                                      | public                          |
| GET    | `/hub/branding/files/:fileId` (hub only)                                                  | public                          |

- **Branding** `GET` answers `{ tenant, surfaces, resolved, files, updatedAt }`: the tenant's own
  values (null: inherited), the per-surface overrides, the tenant's defaults resolved, and the
  files referred to. `PUT` replaces all of it: every value of the tenant layer (null to inherit)
  and `surfaces` (`{ pos: { themeMode: 'LIGHT' }, … }`; unknown surfaces or settings are
  `400`). Colours are `#rrggbb` (`#rgb` is expanded). A colour that would be unreadable answers
  `422 BRANDING_UNREADABLE` with `details.issues: [{ path, colour, against: FOREGROUND | DARK |
LIGHT, ratio, required }]`. A file that is not the tenant's answers `404 FILE_NOT_FOUND`; a
  favicon used as a logo, `415 FILE_TYPE_NOT_ALLOWED`. Audit: `branding.updated`.
- **Uploads** send the image itself as the body, its type as `Content-Type`: PNG, JPEG or WebP
  logos up to 512 KB, the same or ICO (`image/x-icon`, `image/vnd.microsoft.icon`) favicons up
  to 128 KB. The bytes must be what the type says: an SVG or anything else answers
  `415 FILE_TYPE_NOT_ALLOWED`; a file too large, `413 FILE_TOO_LARGE`. The answer is the file
  (`id`, `kind`, `contentType`, `sizeBytes`, `sha256`, `createdAt`). Audit:
  `tenant_file.uploaded`. Files are immutable.
- **Content** is served with its verified type, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox` and an `ETag` (the SHA-256). Another
  tenant's file is not found.
- **Public files**: only the files the tenant's branding refers to (logo, favicon, on any
  surface) and its website pictures (`WEBSITE_IMAGE`, M7), for its website
  (`/public/site/files/:id` on its own host, `Cross-Origin-Resource-Policy: cross-origin`), and
  the branding files for the hub's sign-in screens (`/hub/branding/files/:id`). Other uploads
  answer `404`. `GET /public/site` carries the `website` branding; `GET /hub/branding` the
  paired tenant's (`503 HUB_NOT_PROVISIONED` before its first snapshot).

## Menu endpoints (Phase 1)

Catalog definitions are tenant-level. Availability ("86") and price overrides are
per location. Rows are **archived, never deleted**, because historical orders and sync
operations reference them.

| Method         | Path                                                              | Permission                            |
| -------------- | ----------------------------------------------------------------- | ------------------------------------- |
| GET            | `/tenants/:tid/categories?includeArchived=true`                   | `products.view` (any location)        |
| POST           | `/tenants/:tid/categories`                                        | `products.create`                     |
| PATCH          | `/tenants/:tid/categories/:categoryId`                            | `products.update`                     |
| POST           | `/tenants/:tid/categories/:categoryId/archive` · `/restore`       | `products.delete` · `products.update` |
| GET/POST/PATCH | `/tenants/:tid/kitchen-stations[/:stationId]` (+ archive/restore) | same pattern                          |
| GET/POST/PATCH | `/tenants/:tid/modifier-groups[/:groupId]` (+ archive/restore)    | same pattern                          |
| GET            | `/tenants/:tid/products?categoryId=&search=&includeArchived=`     | `products.view` (any location)        |
| GET/POST/PATCH | `/tenants/:tid/products[/:productId]` (+ archive/restore)         | same pattern                          |
| GET            | `/locations/:locationId/menu`                                     | `products.view` at the location       |
| GET            | `/locations/:locationId/catalog/lookup?code=` (`BARCODE`)         | `products.view` at the location       |
| GET            | `/locations/:locationId/product-settings`                         | `products.view` at the location       |
| PUT            | `/locations/:locationId/products/:productId/settings`             | `products.update` at the location     |

Semantics:

- **Products** take `variants`, `modifierGroups` (`{ modifierGroupId, sortOrder, minSelect?,
maxSelect? }` with optional per-product overrides) and `stationIds`. On `PATCH`, `variants` is
  the complete desired list: entries with an `id` are updated, entries without are created, and
  omitted variants are archived. `modifierGroups` and `stationIds` replace the current links.
- **Modifier groups** use the same full-list semantics for `modifiers`. The resulting group must
  satisfy `0 ≤ minSelect ≤ #modifiers` and `maxSelect ∈ {null, ≥ max(1, minSelect)}`; otherwise
  the answer is `400 VALIDATION_FAILED`. The database enforces the same with CHECK constraints.
- References (category, modifier groups, stations) must belong to the tenant and not be
  archived. Otherwise the answer is the specific `*_NOT_FOUND` code with the offending ids.
- A station `code` taken in the tenant answers `409 CONFLICT`; an SKU another product or live
  variant has answers `409 SKU_TAKEN` (`details.sku`).
- **Retail catalog** ([ADR 0021](adr/0021-retail-catalog-and-barcodes.md)):
  - `options`: `[{ id?, nameEn, nameAr, values: [{ id?, nameEn, nameAr }] }]`, at most 3 options
    of at most 30 values, the complete list (missing ones are deleted). Sent only with
    `variants`, whose `optionValues` is the index of the variant's value in each option of the
    same request. With options, every variant is one combination (no two alike) and is named
    after its values; without, variants need `nameEn`/`nameAr` (`422 INVALID_VARIANT_OPTIONS`,
    `reason`: `WRONG_VALUE_COUNT`, `UNKNOWN_VALUE`, `DUPLICATE_COMBINATION`, `NAME_REQUIRED`,
    `UNKNOWN_OPTION`, `NO_VARIANTS`).
  - Variants also take `sku`, `cost` (minor units, never published), `trackInventory`,
    `barcodes` and `imageFileIds` (absent: an existing variant keeps them).
  - `barcodes`: `[{ code, symbology?, isPrimary? }]` on products without variants and on
    variants; the first is primary unless another is. Without a symbology a GS1 length of digits
    is that GS1 code, anything else `CODE128`. EAN/UPC check digits are verified
    (`400 VALIDATION_FAILED`, message `barcode.CHECK_DIGIT` etc.). A code another item of the
    tenant has answers `409 BARCODE_TAKEN` (`details.code`); a product-level code on a product
    with variants `422 BARCODE_INVALID` (`reason: VARIANT_REQUIRED`). Archived variants free
    their codes.
  - `imageFileIds`: `PRODUCT_IMAGE` tenant files, uploaded with `POST /tenants/:tid/products/images`
    (image bytes as the body, `products.update`, ADR 0027). The first is the cover: the published
    menu's `imageFileId` on the product, and each variant's own first picture as its
    `imageFileId` (null: show the product's).
  - New option axes need `PRODUCT_VARIANTS` and new codes `BARCODE` (`403 FEATURE_DISABLED`);
    stored ones can be sent back unchanged with the module off.
  - The DTO has `options`, `barcodes` (product-level), `imageFileIds`, and on each variant
    `sku`, `cost`, `trackInventory`, `optionValueIds` (in option order), `barcodes` and
    `imageFileIds`. `search` also finds variant SKUs and exact barcodes.
- **Code lookup** (`GET /locations/:id/catalog/lookup?code=`, cloud and hub, `BARCODE`):
  `{ code, matchedBy: BARCODE | SKU, categoryId, product, variantId }`, `product` as in the
  published menu (location price, availability). Barcodes first (a UPC-A also as its 13-digit
  form), then SKUs. Unknown: `404 BARCODE_NOT_FOUND`.
- **Location settings:** `{ isAvailable, priceOverride }`. Price overrides apply only to
  products without variants (`400`, `reason: PRICE_OVERRIDE_WITH_VARIANTS`).
- **Published menu** (`GET /locations/:id/menu`) is built by `resolveLocationMenu()` in
  `@pos/domain`. Archived rows are removed, availability and overrides applied, and min/max
  overrides resolved. Unavailable products stay listed with `isAvailable: false`, so screens can
  show them as sold out. The response carries `version` (a content hash), equal to the `ETag`
  header. Send `If-None-Match` to get `304` when nothing changed. The POS/hub will poll it
  cheaply.
  Where the location's `MODIFIERS` module is off, products have no modifier groups (none shown,
  required or accepted in orders). Products without variants carry `barcodes`, variants `sku`
  and `barcodes` (primary first); none where `BARCODE` is off.
- **Audit:** `category.*`, `kitchen_station.*`, `modifier_group.*`, `product.created/updated/
archived/restored`, `product.price_changed` (base, variant and location override, with
  from/to), `modifier.price_changed`, and `location_product.updated`.

## Pricing configuration (Phase 2)

| Method     | Path                                                              | Permission                      |
| ---------- | ----------------------------------------------------------------- | ------------------------------- |
| GET        | `/tenants/:tid/taxes`                                             | `products.view` (any location)  |
| POST/PATCH | `/tenants/:tid/taxes[/:taxId]`, `…/archive`, `…/restore`          | `settings.manage`               |
| GET        | `/tenants/:tid/discounts`                                         | any member (the POS lists them) |
| POST/PATCH | `/tenants/:tid/discounts[/:discountId]`, `…/archive`, `…/restore` | `settings.manage`               |

Products accept `taxIds`. The published menu includes `taxes` (with `rateBps`) and each
product's `taxIds`. Rate changes are audited as `tax.rate_changed` and affect only orders priced
afterwards.

## Floor plan (Phase 2)

Every floor route needs the `TABLES` module.

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
  included). Channels: `DINE_IN` needs a table of the location where the `TABLES` module is on
  (`400 VALIDATION_FAILED` without one); where it is off, dine-in has no table and naming one
  answers `403 FEATURE_DISABLED`. `PHONE`/`DELIVERY` need a
  customer name or phone; `WEBSITE` (customer API, Phase 7) and `KIOSK` (a paired kiosk, M6) are
  rejected. `CONFIRMED` (what the
  POS sends since Phase 4) accepts the order at once and sends it to the kitchen (only where the
  `KDS` module is on; otherwise it makes no ticket and can be completed directly); `PLACED` waits
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

- **Website orders** (Phase 7) also expose `fulfillmentType`, `deliveryAddress`,
  `customerEmail` and `acceptBy`. While `PLACED` they cannot be edited
  (`409 INVALID_ORDER_STATE`, `reason: AWAITING_ACCEPTANCE`) and cannot be accepted after
  `acceptBy` (`reason: ACCEPTANCE_EXPIRED`). Rejecting one (→ `CANCELLED` with a reason) is allowed
  even when it was paid online: the cloud voids that payment. The decision is made at the
  location's hub: in the cloud, staff transitions of a waiting website order answer
  `reason: DECIDED_AT_LOCATION` (the cloud's only decision is the acceptance timeout).

## Payments (Phase 3)

| Method | Path                                                          | Permission                       |
| ------ | ------------------------------------------------------------- | -------------------------------- |
| GET    | `/tenants/:tid/payment-methods`                               | any role at one of its locations |
| POST   | `/locations/:lid/orders/:orderId/payments`                    | `payments.create`                |
| POST   | `/locations/:lid/orders/:orderId/payments/:paymentId/refunds` | `payments.refund`                |

- **Charge** takes `{ id, shiftId, paymentMethodId, amount, tendered?, reference? }`. The `id`
  is a client-generated UUID and the idempotency key: a resend (including a concurrent one)
  returns the order with the original payment. The order row is locked (`SELECT … FOR UPDATE`)
  for the whole charge, so two terminals can never over-pay the same balance.
- **An open shift is required** (`SHIFT_NOT_FOUND` / `409 SHIFT_NOT_OPEN`); every payment and
  refund records the shift whose drawer it touched. The only payments without a shift are online
  payments (website) and a kiosk's card-terminal payments, which name their device (`deviceId`,
  M6). Refunds go back through the provider that took the charge.
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
- **Providers** (MADAR M8, ADR 0024): each charge goes through the tenant's provider of the
  method at the location (`PaymentProviderFactory`): built-in `cash` and `external-card` for the
  till, unless an account says otherwise. The payment records the provider key (`provider`) and
  the account (`providerAccountId`); a refund goes back through that account.
- **Online** tenders are refused at the till (`reason: PROVIDER_NOT_CONFIGURED`; the POS does not
  offer them). Online card payments happen on the customer website only (below); they carry no
  shift (`shiftId: null`).
- **Refund** takes `{ id, shiftId, amount, reason }` against one charge: at most what is left of
  it (`422 REFUND_NOT_ALLOWED`, `reason: EXCEEDS_REFUNDABLE | REASON_REQUIRED`). Cash refunds are
  paid out of the given shift's drawer. When a completed order is fully refunded it moves
  `COMPLETED → REFUNDED` as a system transition.
- Payment rows are append-only; `paymentStatus` (`UNPAID` … `REFUNDED`) is derived from them on
  every change. Orders also expose `payments[]`, `paidTotal`, `refundedTotal` and `balanceDue`.
- Order guards that involve money: cancelling with money held answers
  `409 INVALID_ORDER_STATE` (`reason: REFUND_FIRST`); an edit that would push the total below what
  is held answers `reason: BELOW_PAID`.
- **Hub-owned orders** (Phase 8, ADR 0014): in the cloud, an order a location hub has synchronized
  belongs to that hub. Charges and refunds of it (and order edits and transitions) answer
  `409 INVALID_ORDER_STATE`, `reason: OWNED_BY_LOCATION`; they are made at the POS. Online card
  charges are refunded from the admin portal instead (below).
- **Audit:** `payment.captured`, `payment.refunded`, `payment.voided` (online voids; references
  only, never card data).

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

Every kitchen route, the POS's kitchen priority included, needs the `KDS` module.

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
- **Settings** returns the tenant's stations and the location's `warnMinutes`/`lateMinutes`
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

## Online ordering (Phase 7, cloud only)

See [ADR 0013](adr/0013-online-ordering.md). Website endpoints need no token; they are rate
limited. Their tenant is the one whose verified domain the request's host names
([ADR 0023](adr/0023-multi-tenant-website.md)), and they work inside that tenant only
([ADR 0017](adr/0017-tenant-root-and-isolation.md)): another tenant's location, order or tracking
token is not found. Every route below needs the `ONLINE_ORDERING` module, checked for the host's
tenant and the location named (`403 FEATURE_DISABLED`, [ADR 0018](adr/0018-feature-modules.md)).

| Method | Path                               | Auth                                           | Notes                                                                                           |
| ------ | ---------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/public/site`                     | website (host)                                 | `PublicSite`: tenant, active locations with ordering status, branding, website (below)          |
| GET    | `/public/site/locations/:lid`      | website (host)                                 | One location (`PublicLocation`)                                                                 |
| GET    | `/public/site/locations/:lid/menu` | website (host)                                 | Published menu, `ETag` / `304` like the staff endpoint                                          |
| POST   | `/orders`                          | website (host), own budget                     | Place a website order (`CreateWebOrderRequest`); the location must be the host's tenant's       |
| GET    | `/orders/track`                    | website (host), `x-tracking-token`, own budget | The customer's view of the order (`PublicOrder`), on its tenant's site only                     |
| GET    | `/locations/:lid/online-ordering`  | `locations.view`                               | Settings plus the live status and hub heartbeat                                                 |
| PUT    | `/locations/:lid/online-ordering`  | `online_ordering.manage`                       | `{ state, openingHours, acceptMinutes, pickupEnabled, deliveryEnabled, deliveryFee }` (partial) |
| GET    | `/sync/orders/:orderId`            | device credential                              | A website order announced on the feed (outbox shape)                                            |

- **Status** (`PublicLocation.status`): `{ state: OPEN|PAUSED|CLOSED|OFFLINE, reason }`, reason
  one of `LOCATION_INACTIVE`, `SETTING_CLOSED`, `SETTING_PAUSED`, `OUTSIDE_HOURS`, `HUB_OFFLINE`,
  or null when open. Opening hours are `[{ day: 0–6 (Sunday = 0), open: "HH:MM", close: "HH:MM" }]`
  in the location timezone; a close at or before the open runs past midnight; no windows = no
  restriction. A hub silent for `HUB_HEARTBEAT_STALE_SECONDS` (180) makes the location `OFFLINE`.
- **Create** `{ id, locationId, fulfillment: PICKUP|DELIVERY, deliveryAddress: { line1, line2?,
city?, notes? } (delivery only), customer: { name, phone, email? }, items[{ id, productId,
variantId, modifierIds, quantity, notes }], notes, payment: { option: PAY_AT_PICKUP |
CASH_ON_DELIVERY | ONLINE_CARD, cardToken (online card only) } }` → `201 { order: PublicOrder,
trackingToken }`. Prices and totals sent by the browser are stripped and never read: the cloud
  re-prices with the domain engine and adds the location's delivery fee. The order is `PLACED`,
  channel `WEBSITE`, numbered `W-NNN` per location and day, with `acceptBy` = now + the location's
  `acceptMinutes`. A resend of the same `id` and phone answers `200` with the same order and
  token; another phone `409 CONFLICT` (`ID_IN_USE`).
- **Errors:** `409 ONLINE_ORDERING_DISABLED` (`details: { state, reason }`, also
  `reason: FULFILLMENT_UNAVAILABLE`), `503 LOCATION_OFFLINE`, `400 VALIDATION_FAILED`
  (`PAYMENT_OPTION_MISMATCH`: pay at pickup goes with pickup, cash on delivery with delivery),
  `422 PRODUCT_UNAVAILABLE` / `INVALID_MODIFIER_SELECTION` / … from the domain,
  `422 PAYMENT_FAILED` (`CARD_DECLINED`, `PROVIDER_SECRET_UNREADABLE`; no order is created),
  `409 ONLINE_PAYMENT_UNAVAILABLE` (the business has no online provider at this location: a
  cash-only business; nothing is charged).
- **Online card** uses the tenant's ONLINE provider account at the location (ADR 0024), recorded
  under the online tender linked to it. The only adapter is the documented mock `mock-online`
  (TEST mode, refused in production; a development default with `DEV_PAYMENT_PROVIDERS`):
  `tok_mock_…` approves, `tok_mock_decline…` declines; card numbers are never accepted. Rejection
  or timeout voids it through the same account as a `REFUND` row (`reason: "VOID: …"`).
  `PublicLocation.onlineCardEnabled` says whether the location offers it.
- **Tracking token:** `<orderId>.<signature>` (HMAC with `TRACKING_TOKEN_SECRET`); unknown, forged
  and missing tokens all answer `404 ORDER_NOT_FOUND`. `PublicOrder` carries status, payment
  status and option, fulfillment and address, items with options, totals, `placedAt`, `acceptBy`,
  `cancelReason` (`TOO_BUSY`, `ITEM_UNAVAILABLE`, `CLOSING_SOON`, `DELIVERY_AREA`,
  `ACCEPTANCE_TIMEOUT`, or `OTHER` for staff free text) and the status `timeline`; no staff,
  device or phone fields.
- **Rate limits:** `WEB_ORDER_RATE_LIMIT_PER_MINUTE` (20) for `POST /orders` and
  `TRACKING_RATE_LIMIT_PER_MINUTE` (120) for `/orders/track`, per client IP, separate from the
  global budget.
- **Timeout:** every `WEB_ORDER_TIMEOUT_SWEEP_SECONDS` (15) the cloud cancels website orders still
  `PLACED` 30 s past `acceptBy` (system transition, reason `ACCEPTANCE_TIMEOUT`) and voids their
  payment.
- **Audit:** `order.created` (actor `CUSTOMER`), `order.cancelled` (actor `SYSTEM` for the
  timeout), `online_ordering.updated`.

## Tenant website and domains (MADAR M7, cloud only)

[ADR 0023](adr/0023-multi-tenant-website.md). Admin routes need `ONLINE_ORDERING` and the
tenant-wide `website.manage` permission.

| Method | Path                                | Access                    | Notes                                                                          |
| ------ | ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/public/site`                      | website (host)            | Published website; the draft with a valid `x-website-preview` token            |
| GET    | `/tenants/:tid/website`             | `website.manage`          | `{ draft, published, version, publishedAt, updatedAt, hasUnpublishedChanges }` |
| PUT    | `/tenants/:tid/website/draft`       | `website.manage`          | The whole `WebsiteConfig`; audit `website.draft_saved`                         |
| POST   | `/tenants/:tid/website/publish`     | `website.manage`          | Draft → published, `version + 1`; audit `website.published`                    |
| POST   | `/tenants/:tid/website/preview`     | `website.manage`          | `{ token, expiresAt, url }`: the primary site with `?preview=` (30 min)        |
| GET    | `/tenants/:tid/domains`             | `website.manage`          | The tenant's domains, primary first                                            |
| POST   | `/tenants/:tid/domains`             | `website.manage`          | `{ domain }` → `201`, PENDING, with the TXT record                             |
| POST   | `/tenants/:tid/domains/:id/verify`  | `website.manage`          | Looks the TXT record up: VERIFIED, or FAILED and `422`                         |
| POST   | `/tenants/:tid/domains/:id/primary` | `website.manage`          | Makes a VERIFIED domain the site's address                                     |
| POST   | `/tenants/:tid/domains/:id/disable` | `website.manage`          | Stops serving a custom domain                                                  |
| GET    | `/internal/domains/check?domain=`   | public, outside `/api/v1` | The proxy's TLS `ask`: `200` for a VERIFIED domain, else `404`                 |

- **`PublicSite`**: `{ id, nameEn, nameAr, currency, locales, timezone, locations, branding,
website, preview, primaryDomain }`. No slug, nothing of another tenant. `website` is the
  published `WebsiteConfig`, MADAR's template for the business type until the first publication,
  or the draft when the request sends a preview token of the same tenant (`preview: true`,
  `Cache-Control: no-store`); a token of another tenant or an expired one is ignored.
- **`WebsiteConfig`**: `{ schemaVersion: 1, navigation: [{ label, href }], social: [{ network,
url }], seo: { title, description, imageFileId }, sections: [...] }`. A section is `{ id, type,
enabled, order, content, appearance: { background: DEFAULT|MUTED|PRIMARY, alignment:
START|CENTER } }`, `type` one of `HERO`, `FEATURED_PRODUCTS`, `CATEGORIES`, `ABOUT`, `GALLERY`,
  `TESTIMONIALS`, `LOCATIONS`, `CONTACT`, `OPENING_HOURS`, `PROMO_BANNER`, `FOOTER`, each with its
  own `content` (`@pos/validation` `websiteSectionSchema`). Texts are `{ en?, ar? }`; links are
  `#section`, `/page` or `https://…`; social URLs `https://` only. Unknown keys answer `400`.
  Pictures must be the tenant's `WEBSITE_IMAGE` files (`404 FILE_NOT_FOUND`,
  `415 FILE_TYPE_NOT_ALLOWED`), products, categories and locations its own (`404 …_NOT_FOUND`).
- **Domains** (`TenantDomainDto`): `{ id, domain, url, kind: SUBDOMAIN|CUSTOM, status:
PENDING|VERIFIED|FAILED|DISABLED, isPrimary, verification: { type: TXT, name, value } | null,
verifiedAt, lastCheckedAt, createdAt }`. Names are normalized (lower case, punycode, no port or
  trailing dot). Errors: `422 DOMAIN_INVALID` (`reason: INVALID|TOO_LONG|IP_ADDRESS|SINGLE_LABEL|
PLATFORM_DOMAIN|TOO_MANY`), `409 DOMAIN_TAKEN` (`ALREADY_ADDED`, `OTHER_TENANT`: verified by
  another tenant), `422 DOMAIN_NOT_VERIFIED` (`details.record`), `409 DOMAIN_LOCKED`
  (`NOT_VERIFIED`, `PLATFORM_ADDRESS`, `PRIMARY`), `404 DOMAIN_NOT_FOUND`. Audit: `domain.added`,
  `domain.verified`, `domain.verification_failed`, `domain.primary_set`, `domain.disabled`.

## Location hub (Phases 5–6)

The hub (`apps/gateway`) serves the same API as the cloud to the POS and KDS on the location LAN
(orders, payments, shifts, kitchen, menu, floor, realtime), from its SQLite database. Differences:

- **Cloud-managed settings are read-only** on the hub: writes to menu, prices, taxes, discounts,
  floor plan, locations and tenant answer `403 MANAGED_IN_CLOUD`; reads work.
- **Until provisioned** (no snapshot yet) every call except `/hub/*` answers
  `503 HUB_NOT_PROVISIONED`.
- **PIN sign-in** `POST /auth/pin` `{ employeeCode, pin, client? }` → same token response as
  `/auth/login`. Five wrong PINs lock the code for 5 minutes (`429 RATE_LIMITED`); the error never
  reveals whether the code exists. The cloud answers 404.

| Method | Path                             | Auth                                                                     |
| ------ | -------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/hub/status`                    | public (no secrets)                                                      |
| POST   | `/hub/sync`                      | `orders.view` — "Sync now": push, then check the feed                    |
| GET    | `/hub/sync/operations`           | `orders.view` — the outbox (`?status=PENDING\|FAILED\|COMPLETED&limit=`) |
| POST   | `/hub/sync/operations/:id/retry` | `sync.view` — put a FAILED operation back in the queue                   |

`HubStatus`: `{ paired, tenantId, locationId, cloud: ONLINE|OFFLINE|UNKNOWN,
state: ONLINE|OFFLINE|SYNCING|SYNC_ERROR, lastSnapshotAt, snapshotVersion, lastError,
pendingOperations, failedOperations, syncedOperations (24 h), lastSyncAt, nextAttemptAt, version,
upgradeRequired: { minimumVersion } | null }`. `version` is the hub's MADAR version;
`upgradeRequired` is set while the cloud refuses it (`426 HUB_UPGRADE_REQUIRED`): the hub keeps
serving its LAN and its outbox until it is updated (ADR 0026).
Clients use it to know they are behind a hub. Outbox rows (`HubSyncOperation`) carry the entity,
a label (the order number), status, retry count, next retry, error code and message.

## Self-service kiosk (MADAR M6, hub only)

See [ADR 0022](adr/0022-self-service-kiosk.md). Served by the location hub to its terminals.

| Method | Path                                             | Auth                                      |
| ------ | ------------------------------------------------ | ----------------------------------------- |
| POST   | `/terminals/pair`                                | public, rate-limited like sign-in         |
| GET    | `/terminals/me`                                  | device: POS, KDS, KIOSK, CUSTOMER_DISPLAY |
| GET    | `/kiosk/context`                                 | device: KIOSK                             |
| GET    | `/locations/:lid/kiosk/menu`                     | device: KIOSK, `SELF_CHECKOUT`            |
| POST   | `/locations/:lid/kiosk/orders`                   | device: KIOSK, `SELF_CHECKOUT`            |
| POST   | `/locations/:lid/kiosk/orders/:orderId/payments` | device: KIOSK, `SELF_CHECKOUT`            |
| POST   | `/locations/:lid/kiosk/orders/:orderId/cancel`   | device: KIOSK, `SELF_CHECKOUT`            |
| POST   | `/kiosk/attendant`                               | device: KIOSK                             |

- **Pair** `{ code }` (spaces, dashes and case ignored) → `{ device: { id, tenantId, locationId,
name, type }, credential }`, once. An unknown, used or expired code answers
  `404 PAIRING_CODE_INVALID`. Works without the cloud (the code came with the snapshot).
- **Context** → `{ device, location: { id, code, nameEn, nameAr, timezone }, context }`, the
  tenant context for the `kiosk` surface with the modules of the location and the kiosk.
- **Menu**: the location's published menu, with `ETag`/`304` like `/locations/:lid/menu`.
- **Order** `{ id, items[{ id, productId, variantId, modifierIds, quantity, notes, barcode }],
payment: TERMINAL|COUNTER, customerName? }` → the order (`201`, or `200` for a resent id),
  `PLACED` and unpaid, channel and source `KIOSK`, priced by the server. No discounts, tables or
  phone numbers. A scanned code must belong to its item (`404 BARCODE_NOT_FOUND`).
- **Pay** `{ id }` (the payment's idempotency key) → `{ payment, order }`: the balance due charged at
  the kiosk's card terminal. Captured and fully paid, the order is `CONFIRMED` (kitchen tickets
  with `KDS`), and `COMPLETED` at once where the location has no kitchen screen. A decline is a
  `FAILED` payment with the order still `PLACED`. `PAYMENT_FAILED` reasons: `ALREADY_PAID`,
  `UNKNOWN_METHOD` (no card method), `BALANCE_CHANGED` (a cashier took the money meanwhile; the
  terminal's charge is voided), `PROVIDER_NOT_CONFIGURED` (the tenant has no `TERMINAL` provider
  at this location, ADR 0024). The payment is recorded under the card tender linked to the
  terminal's account (else the first card tender), with that account.
- **Cancel**: the kiosk's own unpaid order → `CANCELLED` (`KIOSK_CANCELLED`); paid ones are
  refused (`INVALID_ORDER_STATE`, `REFUND_FIRST`).
- Orders and payments of other kiosks (or of the POS) answer `404 ORDER_NOT_FOUND`.
- **Attendant** `{ employeeCode, pin }` → `{ employeeId, displayName }` when the employee has
  `kiosk.attend` at the kiosk's location (`403 INSUFFICIENT_PERMISSION` otherwise); wrong PINs lock
  the code like `/auth/pin`. No session is issued.
- **Audit:** `device.paired` (at the hub), `kiosk.attendant_opened`, and the orders' and
  payments' own entries with the device as actor.

## Devices and hub link (Phases 5–6, cloud)

| Method | Path                                             | Auth              |
| ------ | ------------------------------------------------ | ----------------- |
| GET    | `/locations/:lid/devices`                        | `devices.manage`  |
| GET    | `/sync/resolutions/:operationId`                 | device credential |
| POST   | `/locations/:lid/devices`                        | `devices.manage`  |
| POST   | `/locations/:lid/devices/:deviceId/pairing-code` | `devices.manage`  |
| POST   | `/locations/:lid/devices/:deviceId/disable`      | `devices.manage`  |
| GET    | `/sync/snapshot`                                 | device credential |
| GET    | `/sync/files/:fileId`                            | device credential |
| POST   | `/sync/push`                                     | device credential |
| GET    | `/sync/pull`                                     | device credential |

- **Pairing** `{ name, type: GATEWAY }` returns the device and its credential
  (`<deviceId>.<secret>`) once; only a SHA-256 of the secret is stored. Disabling a device revokes
  it immediately.
- **Terminals** (M6) `{ name, type: POS|KDS|KIOSK|CUSTOMER_DISPLAY }` return the device, `PENDING`,
  with `pairing: { code, expiresAt }` (24 h) instead of a credential: the code is typed on the
  terminal and checked by the location's hub. `…/pairing-code` gives a terminal still `PENDING` a
  new one (`409 CONFLICT`, `NOT_PENDING`, otherwise). Devices carry `pairedAt`, `appVersion`,
  `lastVersionAt` (when that version was first reported, M10) and, while pending,
  `pairingExpiresAt`. A terminal's version is recorded by its hub when it pairs (the pairing
  request's `x-madar-client-version`) and as it works.
- **Device authentication:** `Authorization: Device <deviceId>.<secret>` (staff tokens are refused
  on `/sync/*`). `lastSeenAt` is refreshed at most once a minute; the hub's
  `x-madar-client-version` is recorded on its device as soon as it changes, and a hub below the
  cloud's minimum gets `426 HUB_UPGRADE_REQUIRED` (ADR 0026).
- **Snapshot:** everything the hub's location needs (see `SNAPSHOT_TABLES` in
  `@pos/validation`): tenant, its location, roles and grants, staff of this location (with
  password and PIN hashes), catalog, taxes, discounts, floor, payment methods, drawers. Rows of
  other locations are excluded. `ETag` = content version; `If-None-Match` answers `304`.
- **Push** `{ operations: [≤ 50, each optionally with baseVersion], outbox?: { pending, failed } }`
  (operation types `ORDER_UPSERT`, `SHIFT_UPSERT`, `KITCHEN_TICKET_UPSERT`, since Phase 10
  `AUDIT_LOG_APPEND` (an audit entry written at the location, stored once under the hub's
  location) and since M6 `DEVICE_UPSERT` (a terminal paired at the hub, or its last contact and
  version)) → `{ results: [{ operationId,
status: APPLIED|DUPLICATE|CONFLICT|REJECTED|RETRY, code, message }] }`, one per operation, in
  order. Each operation is applied exactly once (see [sync.md](sync.md#push)); a malformed one is
  `REJECTED` without failing the others. An empty or malformed envelope is `400`.
- **Pull** `?cursor=<seq>&limit=1..500&wait=0..30` → `{ changes: [{ seq, topic: CONFIG|ORDER,
entityId, createdAt }], cursor, hasMore }`; without `cursor`, the head of the feed. With `wait`
  the request is held until a change arrives (long poll). `ORDER` entries name a website order to
  fetch from `/sync/orders/:orderId`.
- **Devices** (list) carry `online` (heard from within `HUB_HEARTBEAT_STALE_SECONDS`) and the
  `outbox` the hub last reported (`pending`, `failed`, `reportedAt`). Disabling an unknown device
  answers `404 DEVICE_NOT_FOUND`.
- **Pull** entries of topic `RESOLUTION` name an operation an administrator settled; the hub reads
  the decision from `/sync/resolutions/:operationId` →
  `{ operationId, entityType, entityId, action: RESEND | ADOPT_CLOUD, order }` (ADR 0014). `404
SYNC_ISSUE_NOT_FOUND` when nothing was decided or the operation is another location's.
- Refused operations and their resolution: see [Synchronization issues](#synchronization-issues-phase-8).
- **Audit:** `device.paired`, `device.created` (a terminal), `device.pairing_code_renewed`,
  `device.disabled`.

## Admin portal (Phase 8, cloud only)

Cloud-only endpoints of the admin portal (`apps/api/src/modules/admin`, ADR 0014). Hubs receive
staff and configuration through the change feed and never serve these routes. Lists that span
locations (`any-location`) return only the locations where the caller holds the permission; with
`locationId` the answer is `404 LOCATION_NOT_FOUND` for a location outside that reach. Paged
lists take `page` (1…) and `pageSize` (1–100, default 25) and answer `{ items, page, pageSize,
total }`.

### Staff (tenant-wide)

| Method | Path                                      | Permission                       |
| ------ | ----------------------------------------- | -------------------------------- |
| GET    | `/tenants/:tid/users`                     | `users.manage`                   |
| POST   | `/tenants/:tid/users`                     | `users.manage`                   |
| PATCH  | `/tenants/:tid/users/:userId`             | `users.manage`                   |
| PUT    | `/tenants/:tid/users/:userId/roles`       | `users.manage`                   |
| POST   | `/tenants/:tid/users/:userId/password`    | `users.manage` (204)             |
| GET    | `/tenants/:tid/roles`                     | `roles.manage` or `users.manage` |
| POST   | `/tenants/:tid/roles`                     | `roles.manage`                   |
| PATCH  | `/tenants/:tid/roles/:roleId`             | `roles.manage`                   |
| DELETE | `/tenants/:tid/roles/:roleId`             | `roles.manage` (204)             |
| GET    | `/tenants/:tid/employees`                 | `users.manage`                   |
| POST   | `/tenants/:tid/employees`                 | `users.manage`                   |
| PATCH  | `/tenants/:tid/employees/:employeeId`     | `users.manage`                   |
| PUT    | `/tenants/:tid/employees/:employeeId/pin` | `users.manage`                   |

- **Users:** create `{ email, displayName, preferredLocale, password (≥ 10), roles: [{ roleId,
locationId | null }] }`; update `{ displayName?, preferredLocale?, isActive? }`; roles are
  replaced with `PUT …/roles { roles }`. Passwords are argon2id hashes of the person's account, never
  returned. Creating a user with an e-mail that already has an account links the user to it: the
  password sent is ignored and the answer is the same either way.
  Deactivating a user or resetting their password revokes their refresh tokens.
- **Roles:** `{ name, description, permissions[] }` from the catalog (`PERMISSIONS`); responses
  carry `isSystem` and `userCount`. Employees: `{ employeeCode, displayName, homeLocationId,
userId, pin? }`; the PIN (4–8 digits) is stored hashed; responses only say `hasPin`.
- **Refusals:** `403 INSUFFICIENT_PERMISSION` with `reason: ESCALATION` and the `missing`
  permissions (granting, removing, editing or deleting a role, or deactivating, resetting or
  linking a user, beyond what the caller holds at that scope); `409 CONFLICT` with `reason`
  `SELF` (own roles or deactivation), `LAST_OWNER` (the last active tenant-wide holder of a
  system role), `SYSTEM_ROLE`, `IN_USE` (deleting a role someone holds), `NAME_TAKEN`,
  `EMAIL_TAKEN`, `CODE_TAKEN`, `USER_LINKED`, `ACCOUNT_SHARED` (a password reset for a person
  who also signs into other brands); `409 USER_MANAGED_BY_ORGANIZATION` (editing, deactivating or
  changing the roles of a user their organization manages); `404 USER_NOT_FOUND`, `ROLE_NOT_FOUND`,
  `EMPLOYEE_NOT_FOUND`.
- **Audit:** `user.created/updated/deactivated/reactivated/roles_changed/password_reset`,
  `role.created/updated/permissions_changed/deleted`,
  `employee.created/updated/user_linked/deactivated/pin_set/pin_reset` (never a password or PIN).

### Payment setup

| Method     | Path                                                            | Permission                         |
| ---------- | --------------------------------------------------------------- | ---------------------------------- |
| GET        | `/tenants/:tid/payment-methods/all`                             | `settings.manage` (incl. archived) |
| POST/PATCH | `/tenants/:tid/payment-methods[/:methodId]`                     | `settings.manage`                  |
| POST       | `/tenants/:tid/payment-methods/:methodId/archive · /restore`    | `settings.manage`                  |
| GET        | `/locations/:lid/cash-registers/all`                            | `settings.manage` at the location  |
| POST/PATCH | `/locations/:lid/cash-registers[/:registerId]`                  | `settings.manage` at the location  |
| POST       | `/locations/:lid/cash-registers/:registerId/archive · /restore` | `settings.manage` at the location  |

A method's `type` cannot change; the last active cash method cannot be archived
(`LAST_CASH_METHOD`), nor a drawer with an open shift (`SHIFT_OPEN`). A method may name the
provider account that processes it (`providerAccountId`): one of the tenant's accounts whose
method records that tender type (`404 PAYMENT_PROVIDER_NOT_FOUND`, `422 PAYMENT_PROVIDER_INVALID`
`WRONG_METHOD`). An update changes only the fields it names. Audit: `payment_method.*`,
`cash_register.*`.

### Payment providers (MADAR M8)

| Method | Path                                         | Permission                    |
| ------ | -------------------------------------------- | ----------------------------- |
| GET    | `/tenants/:tid/payment-providers`            | `settings.manage` tenant-wide |
| POST   | `/tenants/:tid/payment-providers`            | `settings.manage` tenant-wide |
| PATCH  | `/tenants/:tid/payment-providers/:accountId` | `settings.manage` tenant-wide |

See [ADR 0024](adr/0024-payment-configuration.md).

- **GET** → `{ catalog, accounts, effective }`: the providers this installation offers (test
  adapters only outside production) with their modes and form fields; the tenant's accounts; and
  for each active location and method the provider in effect, its mode, account and layer
  (`PLATFORM`, `TENANT`, `LOCATION`).
- **POST** `{ method, providerKey, mode, locationId?, publicConfig?, secrets?, status? }` → `201`
  the account. **PATCH** `{ mode?, publicConfig?, secrets?, status? }`: method, provider and scope
  are fixed; `secrets` replaces the stored set, absent keeps it.
- **Secrets are write-only:** an account carries `secret: { hasSecret, fingerprint, updatedAt }`
  only. The fingerprint is the first 12 hex digits of the SHA-256 of the secrets' canonical JSON.
- **Errors:** `422 PAYMENT_PROVIDER_INVALID` with `reason` `UNKNOWN_PROVIDER`, `BUILT_IN`,
  `WRONG_METHOD`, `MODE_NOT_SUPPORTED`, `INVALID_CONFIG` / `INVALID_SECRETS` (with `issues`:
  path and code, never the value) or `NO_SECRETS`; `409 CONFLICT` `ACTIVE_ACCOUNT_EXISTS` (one
  ACTIVE account per method and scope: disable the other first); `404 PAYMENT_PROVIDER_NOT_FOUND`
  (also another tenant's account); `404 LOCATION_NOT_FOUND`.
- An account for a method the business has no tender for creates one, linked to it.
- Audit: `payment_provider.created`, `payment_provider.updated` (changes, before, fingerprints;
  never secrets).

### Overview and searches

| Method | Path                                          | Permission                             |
| ------ | --------------------------------------------- | -------------------------------------- |
| GET    | `/tenants/:tid/dashboard`                     | `orders.view` (any location)           |
| GET    | `/tenants/:tid/orders`                        | `orders.view` (any location), paged    |
| GET    | `/tenants/:tid/customers?search=`             | `customers.view` (any location), paged |
| GET    | `/tenants/:tid/customers/:customerKey`        | `customers.view` (any location)        |
| GET    | `/tenants/:tid/payments`                      | `payments.view` (any location), paged  |
| POST   | `/locations/:lid/payments/:paymentId/refunds` | `payments.refund` at the location      |
| GET    | `/tenants/:tid/audit-logs`                    | `audit.view` (any location), paged     |

- **Dashboard:** per location, today's business date, orders (count, open, cancelled), sales
  (total of orders not cancelled, money collected), open shifts, online-ordering status, and — with
  `sync.view` there — the hub (`NOT_PAIRED | ONLINE | OFFLINE | DISABLED`, last contact, outbox,
  open issues).
- **Orders:** `locationId`, `from`/`to` (business dates), `status`, `channel`, `paymentStatus`
  (comma-separated), `search` (number, name or phone) → order summaries; details come from
  `GET /locations/:lid/orders/:orderId` (history, payments, tickets).
- **Customers** are grouped by the (trimmed) phone number on orders; `customerKey` is its SHA-256,
  so no phone number travels in a URL. A detail lists the customer's last 100 orders.
- **Payments:** `locationId`, `from`/`to` (the orders' business dates), `type`
  (`CHARGE | REFUND`), `methodType`; each charge carries what is still `refundable`.
- **Refund** `{ id, amount, reason }` (idempotent by `id`): online card charges only, through the
  provider, as an append-only drawer-less `REFUND` row, also for orders a hub owns; the order's
  `version` does not change and an `ORDER` change tells the hub. `422 REFUND_NOT_ALLOWED` with
  `IN_STORE_METHOD` (cash and card are refunded at the POS) or `EXCEEDS_REFUNDABLE`;
  `409 INVALID_ORDER_STATE` (`AWAITING_ACCEPTANCE`). Audit: `payment.refunded`.
- **Audit log:** `action` (exact, or a prefix ending in `.`), `entityType`, `entityId`, `actorId`,
  `locationId`, `source`, `from`/`to` (UTC dates) → entries with the actor's name; tenant-level
  entries need `audit.view` tenant-wide; metadata is redacted again when read.

### Synchronization issues (Phase 8)

| Method | Path                                                    | Permission                   |
| ------ | ------------------------------------------------------- | ---------------------------- |
| GET    | `/locations/:lid/sync/status`                           | `sync.view`                  |
| GET    | `/locations/:lid/sync/issues?state=open\|resolved\|all` | `sync.view`                  |
| GET    | `/locations/:lid/sync/issues/:operationId`              | `sync.view`                  |
| POST   | `/locations/:lid/sync/issues/:operationId/resolve`      | `sync.view` + `sync.resolve` |

- **Status:** the location's hubs (connection, last contact, reported outbox), open issues and the
  last operation received.
- **Issues** are operations the cloud refused from the location's hub (`CONFLICT`/`REJECTED`,
  newest first, up to 200; `open` = not settled), with the error, attempts, the hub's order number,
  and the resolution once settled (`APPLIED_HUB | KEPT_CLOUD`, who, when, note).
- **Detail:** the hub's refused version (stored since Phase 8) and the cloud's current copy, each
  summarised (status, payment status, total, items, payments, paid, version, last change) with the
  full data, and which actions are possible now (`options.applyHub|keepCloud|resend` with a
  blocking `reason`: `ALREADY_RESOLVED`, `NOT_A_CONFLICT`, `NO_HUB_VERSION`, `ORDERS_ONLY`,
  `NOT_IN_CLOUD`, `HUB_HAS_PAYMENTS`, `HUB_DISABLED`).
- **Resolve** `{ action: APPLY_HUB | KEEP_CLOUD | RESEND, note (3–500) }` → the updated detail
  (rules in [ADR 0014](adr/0014-admin-portal-and-conflict-resolution.md)); a blocked action answers
  `409 CONFLICT` with its `reason`; a hub version that cannot be applied (e.g. a clashing order
  number) `409 CONFLICT` `APPLY_FAILED` and the issue stays open. Audit: `sync.issue_resolved`
  (with the cloud's previous copy for `APPLY_HUB`), `sync.resend_requested`.

## Reports (Phase 9, cloud only)

Cloud-only reports (`apps/api/src/modules/reports`, [ADR 0015](adr/0015-reporting.md)) over
PostgreSQL views. Every route needs `reports.view` (at some location) and answers for the
locations where the caller holds it.

| Method | Path                                | Report                                            |
| ------ | ----------------------------------- | ------------------------------------------------- |
| GET    | `/tenants/:tid/reports/daily-sales` | Sales per business date (every day of the period) |
| GET    | `/tenants/:tid/reports/channels`    | Sales per channel with share of net sales         |
| GET    | `/tenants/:tid/reports/payments`    | Money per payment method and per channel          |
| GET    | `/tenants/:tid/reports/products`    | Line sales per product and size                   |
| GET    | `/tenants/:tid/reports/categories`  | Line sales per category                           |
| GET    | `/tenants/:tid/reports/taxes`       | Per tax, rate and price mode, refunds netted      |
| GET    | `/tenants/:tid/reports/discounts`   | Per discount as applied                           |
| GET    | `/tenants/:tid/reports/shifts`      | Shifts opened in the period, cash and tenders     |
| GET    | `/tenants/:tid/reports/prep-times`  | Kitchen prep and wait times per station           |

- **Query:** `from`, `to` (business dates `YYYY-MM-DD`, inclusive, required, at most 366 days),
  `locationIds` (comma-separated; default every permitted location; another location answers
  `404 LOCATION_NOT_FOUND`), `channels` (comma-separated `DINE_IN,TAKEAWAY,PHONE,WEBSITE,DELIVERY`;
  default all; ignored by the shift report). Invalid periods or values answer
  `400 VALIDATION_FAILED`.
- **Every answer** echoes `from`, `to`, `currencyCode`, `locationIds`, `channels` (null = all) and
  `generatedAt`, then `rows` and `totals`. Amounts are integer minor units of the tenant
  currency; shares are basis points; durations are whole seconds.
- **Sales** (daily, channels) are completed orders (`COMPLETED`, or `REFUNDED` afterwards) on their
  business date: `orders`, `grossSales` (Σ subtotal as charged), `discounts`, `netSales`
  (total − tax − fees), `tax`, `fees`, `totalSales`, `averageNetSale`, `refunds`
  (`{ count, amount, tax, fees, netSales }`: refunds of sales made in the period, split in
  proportion to the refunded order), `netSalesAfterRefunds`, `taxAfterRefunds` and
  `cancelledOrders`.
- **Payments:** captured charges and refunds (`charges`, `chargeCount`, `refunds`, `refundCount`,
  `net`, `roundingAdjustment`) per method, plus `byChannel`, on the business day the money moved,
  for every order (also open or cancelled ones).
- **Products / categories:** `quantity`, `orders`, `grossSales`, `discounts` (allocated), `tax`,
  `netSales` (line total − line tax) and `shareBps`, best sellers first; categories add the number
  of distinct `products`.
- **Taxes:** per `taxId`, `rateBps` and `taxInclusive`: `orders`, `taxableAmount` (excluding the
  tax), `tax`, `refundedTax`, `netTax`; totals omit the taxable amount (bases overlap when an order
  carries several taxes).
- **Discounts:** per discount, type and value: `applications`, `orders`, `amount`; totals add
  `grossSales` and `shareOfGrossBps`.
- **Shifts:** per shift (newest first): drawer, status, opened/closed by and at, `openingFloat`,
  `cashSales`, `cashRefunds`, `payIns`, `payOuts`, `expectedCash` (stored at close, live while
  open), `countedCash`, `cashDifference` (negative = short), `charges`, `refunds`,
  `netCollected`, `orders` and `byMethod`.
- **Prep times:** per kitchen station: `tickets` (reached READY), `averagePrepSeconds`,
  `medianPrepSeconds`, `p90PrepSeconds`, `maxPrepSeconds` (created → ready),
  `averageWaitSeconds` (created → started), `lateTickets` (slower than the location's
  `kdsLateMinutes`) and `lateShareBps`.
- The hub keeps its shift-close `GET /locations/:lid/reports/daily-summary` (Phase 3,
  `shifts.manage`); it is not one of these reports.

## Organizations (E1, cloud only)

[ADR 0029](adr/0029-organizations-and-accounts.md). An organization's pages
(`apps/api/src/modules/organizations`) for people with an organization role, in the access class
`organization` (see Authorization). They need the caller's account to be a member of the
organization; roles are `OWNER`, `MANAGER` and `FINANCE`.

| Method | Path                                                 | Organization role | Notes                                                                                                         |
| ------ | ---------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/organizations/:organizationId`                     | any               | `{ organization: { id, slug, nameEn, nameAr, currencyCode, role }, brands[] }`: brands with logo and branches |
| GET    | `/organizations/:organizationId/dashboard`           | any               | Today, last 7 and last 30 days, per brand, per branch, daily series                                           |
| GET    | `/organizations/:organizationId/reports/daily-sales` | any               | `DailySalesReport` over the brands                                                                            |
| GET    | `/organizations/:organizationId/reports/brands`      | any               | Sales per brand, including brands without sales                                                               |
| GET    | `/organizations/:organizationId/reports/locations`   | any               | Sales per branch, with its brand, including branches without sales                                            |
| GET    | `/organizations/:organizationId/reports/channels`    | any               | As the brand report                                                                                           |
| GET    | `/organizations/:organizationId/reports/payments`    | any               | As the brand report                                                                                           |
| GET    | `/organizations/:organizationId/reports/products`    | any               | Rows carry `tenantId`: a product is per brand                                                                 |
| GET    | `/organizations/:organizationId/reports/categories`  | any               | Rows carry `tenantId`                                                                                         |
| GET    | `/organizations/:organizationId/members`             | `OWNER`           | `MemberDto[]`: `{ id, accountId, email, displayName, role, createdAt }`                                       |
| POST   | `/organizations/:organizationId/members`             | `OWNER`           | `{ email, displayName, role, password? }` → member + `skippedTenantIds`                                       |
| PATCH  | `/organizations/:organizationId/members/:memberId`   | `OWNER`           | `{ role }` → member + `skippedTenantIds`                                                                      |
| DELETE | `/organizations/:organizationId/members/:memberId`   | `OWNER`           | 204                                                                                                           |

- **Dashboard:** `{ currencyCode, periods: { today, last7, last30 }, byBrand, byLocation, daily }`.
  Each period is `{ salesTotal, orderCount, averageTicket }` in minor units of the organization's
  currency; each branch's periods end on its own business day (ADR 0015), so `today` is not one
  instant. `byBrand`, `byLocation` (with `hubOnline`) and `daily` (one entry per day, every brand's
  sales, 0 where none) cover the **last 30 days**.
- **Reports:** the same query as the brand reports (`from`, `to`, at most 366 days,
  `locationIds`, `channels`) plus `tenantIds` (comma-separated; default every brand; another
  organization's brand answers `404 TENANT_NOT_FOUND`, an unknown branch `404 LOCATION_NOT_FOUND`). Answers echo the filters like the brand reports and use the
  brand reports' row shapes with a brand dimension. Every amount is in the organization's currency
  (one per organization), so the totals add up and equal the sum of the brands' own reports.
- **Members:** adding a member gives them a linked user in every brand, with the brand role of the
  same name. An e-mail that already has an account is that person: the password is ignored and
  they keep their own; a new e-mail needs `password` (`400 VALIDATION_FAILED`
  otherwise). A brand where the person's own user was deactivated is skipped and listed in
  `skippedTenantIds` (audited as `user.organization_link_skipped`). Refusals: `409 CONFLICT`
  `ALREADY_MEMBER`; `409 ORGANIZATION_LAST_OWNER` (removing or demoting the last owner);
  `404 NOT_FOUND` for another organization's member. Removing a member takes the organization's
  roles away and deactivates their linked users (tokens revoked); a user they had of their own in
  a brand stays active with their own roles.
- **Errors specific to organizations:** `404 ORGANIZATION_NOT_FOUND`, `409
ORGANIZATION_CURRENCY_MISMATCH` (a brand in another currency cannot join),
  `409 ORGANIZATION_LAST_OWNER`, `409 USER_MANAGED_BY_ORGANIZATION` (brand staff routes),
  `409 ORGANIZATION_SLUG_TAKEN`.
- **Audit:** `organization.member_add`, `member_role`, `member_remove`, `brand_attached`,
  `brand_detached`, `user.organization_linked/unlinked/link_skipped` (a brand's own log).

## Platform admin (MADAR M9, cloud only)

MADAR's operators, never a tenant's staff (ADR 0025). Every route below except sign-in needs a
**platform** access token (`aud=madar-platform`, its own key); staff tokens, device credentials and
anonymous calls get `401`, and a platform token gets `401` on every other route. Permissions are
the platform catalog's, by role (OWNER and OPERATOR: everything; SUPPORT: read + `support.find`;
VIEWER: read). A route naming `:tenantId` answers `404 TENANT_NOT_FOUND` for an unknown tenant and
works inside that tenant only; a tenant's status does not restrict the platform.

| Method | Path                                                   | Permission              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/platform/auth/login`                                 | public, rate-limited    | `{ email, password }` → token + platform user; cookie `madar_prt` on `/api/v1/platform/auth`; 5 failures lock 15 min (`429 RATE_LIMITED`)                                                                                                                                                                                                                                                                                                               |
| POST   | `/platform/auth/refresh`                               | public, rate-limited    | Cookie + allowed `Origin`; rotation and reuse detection as for staff                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/platform/auth/logout`                                | public                  | Revokes the family; clears the cookie                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/platform/auth/me`                                    | any platform user       | The operator with role and permissions                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/platform/tenants`                                    | `tenants.view`          | `?search=&status=&businessType=&organizationId=&page=&pageSize=` (name, slug or domain); each row names its `organization` (or null)                                                                                                                                                                                                                                                                                                                    |
| POST   | `/platform/tenants`                                    | `tenants.provision`     | `{ tenant, location, owner, entitlements? }` → detail + the owner's one-time password (shown once); `409 CONFLICT` `SLUG_TAKEN`/`EMAIL_TAKEN`. With `organizationId` instead of `owner` the brand joins that organization (same currency) and its members are the owners (`owner: null` in the answer); if linking the members fails the brand exists and the answer is `409 CONFLICT` `ORGANIZATION_LINK_FAILED` with its `tenantId` (attach it again) |
| GET    | `/platform/tenants/:tenantId`                          | `tenants.view`          | Profile, owners, counts, primary domain, last activity                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/platform/tenants/:tenantId/status`                   | `tenants.status`        | `{ status, reason }`: ACTIVE ↔ SUSPENDED, → ARCHIVED, ARCHIVED → ACTIVE; both audit logs                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/platform/tenants/:tenantId/locations`                | `tenants.view`          |                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/platform/tenants/:tenantId/users`                    | `tenants.view`          | Accounts and roles (no password hashes)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/platform/tenants/:tenantId/devices`                  | `tenants.view`          | Hubs and terminals: online, version, reported outbox                                                                                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/platform/tenants/:tenantId/modules`                  | `tenants.view`          | Entitlement, configurable, explicit, business-type default, enabled                                                                                                                                                                                                                                                                                                                                                                                     |
| PUT    | `/platform/tenants/:tenantId/entitlements`             | `tenants.configure`     | `{ entitlements: [{ feature, entitled, tenantConfigurable }], reason }`                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/platform/tenants/:tenantId/branding`                 | `tenants.view`          | The tenant's branding (read-only)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/platform/tenants/:tenantId/domains`                  | `tenants.view`          |                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/platform/tenants/:tenantId/domains/:domainId/verify` | `tenants.configure`     | Looks the TXT record up again (ADR 0023)                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/platform/tenants/:tenantId/payment-accounts`         | `tenants.payments.view` | Accounts with `secret: { hasSecret, fingerprint, updatedAt }` only                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/platform/tenants/:tenantId/health`                   | `health.view`           | Per location: hubs, terminals online, outbox, open issues, last sync and activity; recent errors                                                                                                                                                                                                                                                                                                                                                        |
| GET    | `/platform/tenants/:tenantId/audit-logs`               | `audit.view`            | The tenant's audit log (`auditLogQuerySchema`), operators named                                                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/platform/health`                                     | `health.view`           | One row per tenant, plus recent server errors                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/platform/errors`                                     | `health.view`           | `?tenantId=&limit=` error events (5xx, redacted, sampled)                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/platform/audit-logs`                                 | `audit.view`            | `?tenantId=&action=&actorId=&page=&pageSize=` the platform's own log                                                                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/platform/support/operations`                         | `support.find`          | The repair catalog with the roles allowed for each                                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/platform/tenants/:tenantId/support/find`             | `support.find`          | `?kind=ORDER\|CUSTOMER\|PRODUCT\|PAYMENT\|SYNC_OPERATION&q=` (at most 20)                                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/platform/tenants/:tenantId/support/preview`          | `support.repair`        | `{ operation, params }` → before, after, changes, `executable`, `blockedReason`, `confirmation`                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/platform/tenants/:tenantId/support/execute`          | `support.repair`        | `{ operation, params, confirmationToken, reason }` → before and after as executed                                                                                                                                                                                                                                                                                                                                                                       |

- **Repairs** (`operation` → `params`): `sync.retry` and `sync.reprocess` → `{ operationId }`
  (ADR 0014's RESEND and APPLY_HUB); `order.correct_status` → `{ orderId, to }` (SYSTEM rules of
  the state machine; `REFUND_FIRST`, `NOT_REFUNDED`, `OWNED_BY_LOCATION` block it);
  `order_item.correct_product` → `{ orderItemId, productId, variantId }` (the line's snapshot
  stays); `order.recalculate_totals` → `{ orderId }` (open orders; `FINALIZED` only reports the
  diff); `entity.restore` → `{ entityType, entityId }` (an archived category, product, modifier
  group, kitchen station, tax, discount, payment method or cash drawer).
- **Executing** needs the preview's confirmation (five minutes, bound to the operation, tenant,
  parameters, operator and the record's state) and a reason (5–500 characters), and the operator's
  role must be allowed for the repair (`403 INSUFFICIENT_PERMISSION`). A confirmation of another
  preview is `422 SUPPORT_CONFIRMATION_INVALID`; an expired one or a record that changed is
  `409 SUPPORT_PREVIEW_STALE` (preview again); a blocked repair is `409 SUPPORT_NOT_EXECUTABLE`.
  An archived tenant is `403 TENANT_ARCHIVED`.
- Hubs of a suspended tenant get `403 TENANT_SUSPENDED` on `/sync/*` (archived: reads only); its
  website gets `403 TENANT_SUSPENDED`.

### Organizations (E1)

[ADR 0029](adr/0029-organizations-and-accounts.md). `organizations.view` is every platform role's;
`organizations.manage` is OWNER's and OPERATOR's. Staff tokens and anonymous callers get `401`.
Every change is in the platform audit log (`organization.create`, `update`, `attach`, `detach`,
`member_add`, `member_role`, `member_remove`).

| Method | Path                                                        | Permission             | Notes                                                                                                                         |
| ------ | ----------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/platform/organizations`                                   | `organizations.view`   | `?search=&status=&page=&pageSize=` → `{ id, slug, nameEn, nameAr, currencyCode, status, createdAt, brandCount, memberCount }` |
| POST   | `/platform/organizations`                                   | `organizations.manage` | `{ slug, nameEn, nameAr, currencyCode, owner: { email, displayName, password? } }` → detail; `409 ORGANIZATION_SLUG_TAKEN`    |
| GET    | `/platform/organizations/:organizationId`                   | `organizations.view`   | The summary plus `brands[]` (id, slug, names, status) and `members[]`                                                         |
| PATCH  | `/platform/organizations/:organizationId`                   | `organizations.manage` | `{ nameEn?, nameAr?, status? }` (ACTIVE or SUSPENDED); slug and currency never change                                         |
| POST   | `/platform/organizations/:organizationId/tenants`           | `organizations.manage` | `{ tenantId }` → detail + `skippedMemberIds`; `409 ORGANIZATION_CURRENCY_MISMATCH`, `409 CONFLICT` `TENANT_IN_ORGANIZATION`   |
| DELETE | `/platform/organizations/:organizationId/tenants/:tenantId` | `organizations.manage` | 204; `409 CONFLICT` `LAST_OWNER` when the brand has no active Owner of its own                                                |
| GET    | `/platform/organizations/:organizationId/members`           | `organizations.view`   | `MemberDto[]`                                                                                                                 |
| POST   | `/platform/organizations/:organizationId/members`           | `organizations.manage` | As the owner's route                                                                                                          |
| PATCH  | `/platform/organizations/:organizationId/members/:memberId` | `organizations.manage` | `{ role }`                                                                                                                    |
| DELETE | `/platform/organizations/:organizationId/members/:memberId` | `organizations.manage` | 204                                                                                                                           |

- A new organization's owner is the first member, with the role `OWNER`. An e-mail that already has
  an account is that person; a new one needs a starting password.
- Attaching creates a linked user for every member in the brand; detaching deactivates them and
  clears the brands' link marker.
- A suspended organization is not blocked here: attaching, provisioning into it and member changes
  still work (see Known gaps in the architecture notes).

### Releases (MADAR M10)

[ADR 0026](adr/0026-versions-and-releases.md). `releases.view` is every platform role's;
`releases.publish` and `releases.rollout` are OWNER's and OPERATOR's. Tenant tokens get `401`.

| Method | Path                                          | Permission         | Notes                                                                                                                                                      |
| ------ | --------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/platform/releases`                          | `releases.view`    | `{ cloudVersion, minimums: { hub, client }, latest: { STABLE, BETA }, releases[] }`, newest version first                                                  |
| POST   | `/platform/releases`                          | `releases.publish` | `{ version, channel, notes?, minSupportedHubVersion?, minSupportedClientVersion? }`; `409 CONFLICT` `VERSION_TAKEN`; a minimum above the version is `400`  |
| PATCH  | `/platform/releases/:releaseId`               | `releases.publish` | `{ channel?, notes?, minSupportedHubVersion?, minSupportedClientVersion? }` (`null` removes a minimum; the version never changes); `404 RELEASE_NOT_FOUND` |
| GET    | `/platform/device-versions`                   | `releases.view`    | `?tenantId=&outdatedOnly=true` → per tenant: channel, pin, target version, outdated and unsupported counts, active devices with version, since and status  |
| GET    | `/platform/tenants/:tenantId/release-channel` | `releases.view`    | `{ channel, pinnedVersion, targetVersion, updatedAt }` (no row: STABLE)                                                                                    |
| PUT    | `/platform/tenants/:tenantId/release-channel` | `releases.rollout` | `{ channel, pinnedVersion?, reason }`; a pin must be a published version (`404 RELEASE_NOT_FOUND`); both audit logs                                        |

- **The minimums the cloud enforces** are the highest declared by the published releases whose
  version is at or below the cloud's own (`cloudVersion`): publishing a newer release changes
  nothing until it is deployed. Every API instance re-reads them within 15 seconds.
- **Device status:** `UNSUPPORTED` (below the cloud's minimum for its kind: hub or app),
  `OUTDATED` (below the tenant's target: its pin, else its channel's newest release; BETA takes
  beta and stable releases), `CURRENT`, `UNKNOWN` (never reported a version).
- `GET /platform/health` rows add `targetVersion`, `outdatedDevices` and `unsupportedDevices`; the
  board adds `cloudVersion` and `minimums`.

## Security headers and limits

- `@fastify/helmet` defaults (HSTS, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, a
  `default-src 'self'` CSP, `Referrer-Policy: no-referrer`), a 1 MB body limit.
- CORS allowlist from `CORS_ORIGINS` (credentials enabled). Entries must be bare origins
  (`https://admin.example.com`, `tauri://localhost`); `*` or a path stops the server at start-up.
- A global rate limit of `RATE_LIMIT_PER_MINUTE` per client IP, plus separate budgets for sign-in
  and refresh (`AUTH_RATE_LIMIT_PER_MINUTE`), website orders and order tracking. Behind a reverse
  proxy or load balancer set `TRUST_PROXY` to the number of proxies, so the client address comes
  from `X-Forwarded-For`; otherwise every client shares the proxy's budget.
- **Every route is protected server-side.** The server refuses to start if a route has neither
  `@Public()` nor `@RequirePermissions` (Phase 10); `apps/api/test/security.test.ts` and
  `apps/gateway/test/security.test.ts` call every route and expect `401` without a token, `403`
  for a member without the permission, `404` for another tenant's ids, and the device credential
  on `/sync/*`. Public routes: `/health`, `/ready`, sign-in (`/auth/login|pin|refresh|logout`),
  the storefront (`/public/*`), website order creation and tracking (`/orders`, `/orders/track`)
  and, on the hub only, `/hub/status`.
- All SQL is parameterized (Prisma queries and tagged `$queryRaw` templates); the only
  `$queryRawUnsafe` interpolates a table name from a fixed union.

## Observability

Structured JSON logs (pino) include `reqId`, `userId`, `tenantId`, `locationId`, `orderId`
(routes naming an order) and `deviceId` (a hub calling `/sync/*`, whose tenant and location
are logged too), also on Fastify's request-completed line. Authorization headers, cookies,
passwords, tokens, PINs, credentials and card fields are redacted, also one level down
(`body.password`); database errors are logged without the query's arguments. The hub logs the
same fields (`service: "hub"`) and serves the same `/health` and `/ready`. Audit
entries record actor, source, request id and redacted metadata for: login, failed login, logout,
refresh-token reuse, tenant/location changes, catalog changes including price changes,
orders (creation, discounts, edits, status changes, cancellations), payments (captures, refunds,
voids), shifts and cash movements, online-ordering settings, devices, staff and permission
changes, payment setup and sync decisions (the admin portal's audit log, `audit.view`). Since Phase 10 the
audit log also holds what happened at the location: the hub uploads its entries (PIN sign-ins,
shifts and cash, payments and refunds at the till, kitchen actions) through the sync outbox.
