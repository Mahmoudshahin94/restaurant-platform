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
