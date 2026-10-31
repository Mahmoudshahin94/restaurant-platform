# ADR 0029: Organizations and accounts

- Status: Accepted (2026-10-31)

## Context

Until E1 a tenant was the top of the hierarchy: one business, its own staff, its own sign-in. An
owner of several brands (say ten burger restaurants and ten pizza restaurants) had to run several
tenants, each with its own login, with no way to move between them and no view across them.

The goal of E1 is that one owner:

- signs in once;
- switches between the brands without signing in again;
- sees one dashboard and the same reports across all brands;
- manages each brand as before, by being in it.

Three things had to stay true. Each brand stays a **full tenant** (its own menu, branding, website,
domains, branches and staff). A person with access to one brand can never see another. A business
outside an organization behaves exactly as before.

Decisions taken with the product owner, recorded in the
[design](../superpowers/specs/2026-10-31-e1-organizations-design.md):

- Currency: one per organization. A brand in another currency cannot join, so totals add up.
- Org-wide access goes to the owner and org staff only. Everyone else is granted per brand or per
  branch, as today.
- No shared management in E1: org staff manage a brand by switching into it.
- The platform admin sets up an organization and its owner; the organization's owner adds and
  removes members.

## Decision

### Account and linked users

- **`Account`** holds the login: e-mail (trimmed, lower case, unique) and the argon2id hash.
  Sign-in looks the account up and then picks one of its users. It also holds `lastTenantId`, the
  brand signed into last.
- **`User`** stays one row per person per brand, with its roles, refresh tokens and employee link,
  now with an `accountId` (`@@unique([tenantId, accountId])`) and **no** password. The access token
  claims (`sub`, `tid`) are unchanged, so every guard, audit entry and hub path works as before.
  `User.email` stays as a display copy, unique per tenant.
- **Sign-in** (`POST /auth/login`, optional `tenantId`) answers `INVALID_CREDENTIALS` with the
  timing-equalized check, then chooses the brand: the requested one, else `lastTenantId`, else the
  account's oldest usable user. A stale choice (a detached brand, a deactivated user) falls back to
  another usable brand.
  - A user is usable when it is active, its tenant is not suspended and, if the organization manages
    it, the organization is active.
  - With no usable brand the answer is `ACCOUNT_DISABLED`, or today's `TENANT_SUSPENDED` when a
    suspended brand is the reason; neither names a brand.
- **The response** gains `tenants` (the brands the account can use: id, names, `logoFileId`,
  `organizationId`) and `organizations` (id, names, the caller's role). `GET /auth/me` and
  `/auth/refresh` carry the same lists. A one-brand person gets one entry and no organizations.
- **Staff users:** creating a user with an e-mail that already has an account links the new user to
  it. The password sent is ignored and the answer is the same either way, so it does not reveal
  whether the e-mail had an account. A brand cannot reset the password of an account that also
  signs into other brands (`409 CONFLICT`, `ACCOUNT_SHARED`).

### Organization and members

- **`Organization`** (`slug`, `nameEn`, `nameAr`, `currencyCode`, `status` `ACTIVE`/`SUSPENDED`) and
  **`OrganizationMember`** (account, role `OWNER`/`MANAGER`/`FINANCE`, `displayName`) are
  **cloud-only**. `Tenant.organizationId` is nullable: null is a standalone business.
- **Currency rule:** `assertOrganizationCurrency` refuses to attach a brand whose currency differs
  (`ORGANIZATION_CURRENCY_MISMATCH`, 409). A brand's currency never changes after provisioning
  (ADR 0002), so a member brand cannot drift either.
- **Linked users.** `OrganizationService` (`apps/api/src/modules/organizations/`) is the only
  writer of the users an organization manages. Each member has one user per brand, tenant-wide,
  with the brand role of the same name (`OWNER`→`Owner`, `MANAGER`→`Manager`, `FINANCE`→`Finance`).
  Each user carries `organizationMemberId`, and its role assignments `grantedByOrganization`.

  | Event                      | Effect in the brands                                                                    |
  | -------------------------- | --------------------------------------------------------------------------------------- |
  | member added, role changed | create the linked user, or replace its organization-granted role                        |
  | member removed             | take the organization's roles away, deactivate a user left with none, revoke its tokens |
  | brand attached             | create linked users for every member                                                    |
  | brand detached             | deactivate its linked users, revoke their tokens, clear `organizationMemberId`          |

  Rulings that refine the design:
  - A person who already has a normal user in a brand keeps it: the organization's role is added
    to it, and removing the member removes only that role. The user is still active afterwards.
  - Linking never reactivates a user the brand deactivated. That brand's user stays inactive and
    unlinked, the skip is audited (`user.organization_link_skipped`) and reported in the response
    (`skippedTenantIds`, `skippedMemberIds`).
  - Detaching clears the marker on every user of the brand, so the brand owns them again and can
    edit or reactivate them. Removing a member keeps it (the brand is still in the organization).
  - The platform's detach is refused when the brand would have no active Owner of its own
    (`409 CONFLICT`, reason `LAST_OWNER`, the brand-level code; the organization's own rule is
    `ORGANIZATION_LAST_OWNER`).
  - A suspended organization does not delete anything. Its organization pages answer not found,
    and users that exist only because of the organization are refused like inactive ones on sign-in,
    on refresh and on every request. A normal brand user keeps their access.

- **Brand staff APIs** refuse to edit, deactivate or change the roles of a linked user
  (`USER_MANAGED_BY_ORGANIZATION`, 409); the staff list shows an "Organization" badge.
- **Last owner:** the last `OWNER` of an organization cannot be removed or demoted
  (`ORGANIZATION_LAST_OWNER`, 409).

### Switching

`POST /auth/switch { tenantId, refreshToken? }`, for any signed-in person, in the same access
class as `GET /auth/me`:

- It needs the caller's **own live refresh token** (the cookie for a browser, the body for a native
  client), like `/auth/refresh`: an access token alone never starts a long-lived session.
- The target must be a usable user of the **same account**. Anything else, including a brand the
  account has no user in, is `404 TENANT_NOT_FOUND`, exactly as a foreign tenant answers.
- The old refresh-token family is revoked in one atomic claim (two switches with one token cannot
  both win), a new session starts, `lastTenantId` moves, and `auth.switch` is audited in both
  brands. The second entry is written outside any tenant scope with an explicit tenant, because a
  request never works in two tenants.
- Switching to the current brand starts a new session. The hub answers 404: it holds one brand.
- A removed member is cut off at once: `/auth/switch` into another brand answers 404 and
  `/auth/refresh` answers `ACCOUNT_DISABLED`, without waiting for token expiry.

### Organization scope, guard and access class

- **A fourth `TenantContext` scope kind, `organization { organizationId, tenantIds }`.** Under it
  the scoped client adds `tenantId IN (tenantIds)` to every read of a tenant-keyed model and
  **refuses every write**, for any model (`TenantScopeError`), including child rows, accounts and
  members. Reads of child models and raw SQL are not filtered: the report and dashboard code binds
  `tenantIds` itself.
- **`OrganizationGuard`** on every `/organizations/:organizationId/*` route: the caller's account
  must be a member of an `ACTIVE` organization, whichever brand they are signed into. A stranger, a
  brand-only user and a suspended organization all get `404 ORGANIZATION_NOT_FOUND`, so
  organizations are not disclosed; a member whose role the route does not allow gets `403`. A
  handler then runs in the organization scope (`OrganizationScopeInterceptor`).
- **The route inventory** has an eighth class, `organization`
  (`@OrganizationRoute(roles)`). The start-up check refuses an organization route that is public,
  without roles, without the guard, or also asking for staff permissions or devices. The security
  tests walk every such route: `401` without a token, `404` for a non-member, `403` for a role not
  allowed.

### Organization dashboard and reports

- `GET /organizations/:id` returns the organization and its brands with branches (read by every
  role). `GET /organizations/:id/dashboard` returns today, the last 7 and the last 30 days as sales,
  orders and average ticket, plus per brand, per branch (with hub online or offline) and a daily
  series. Each branch's periods end on its own business day (ADR 0015). The per-brand and per-branch
  splits and the series cover the **last 30 days**, matching the series.
- Seven reports under `/organizations/:id/reports/{daily-sales,brands,locations,channels,payments,
products,categories}` take `from`, `to` (at most 366 days), `tenantIds`, `locationIds`, `channels`.
  They reuse the SQL and views of the brand reports with `tenant_id = ANY(tenantIds)` and a brand
  dimension; products, categories and payment rows carry `tenantId`. Every amount is in the
  organization's currency, so totals add up; a test asserts the organization's totals equal the sum
  of the brands' own reports.

### Platform admin

- `GET/POST /platform/organizations`, `GET/PATCH /platform/organizations/:id`, attach and detach
  brands, and the same member actions as the owner, behind the `platform` route class with the new
  permissions `organizations.view` (every platform role) and `organizations.manage` (OWNER and
  OPERATOR). Every change is in the `PlatformAuditLog` (`organization.*`), and brands' users in the
  brand's own log.
- Provisioning a brand can name an organization. Its members are then the brand's owners, so no
  owner e-mail is given. If linking fails after the brand was created, the answer is `409 CONFLICT`
  with `details.reason = ORGANIZATION_LINK_FAILED` and the brand's `tenantId`; the provisioning is
  already audited, and the operator attaches the brand again.
- Tenants list: an Organization column and filter.

### Hub and sync

- `Organization`, `OrganizationMember` and their enums are `/// @cloud-only`. `Account` goes to the
  hub: the hub signs in by e-mail against its synced copy, and the PIN sign-in is unchanged.
- The hub-schema generator now also strips forward relation fields that point at cloud-only models
  (`Tenant.organization`) and back-relations (`Account.memberships`), and its contract test checks
  them. `Tenant.organizationId` and `User.organizationMemberId` are plain columns on the hub.
- **Snapshot format 8 → 9** adds `accounts`, the logins of the snapshot's users, applied before the
  users that name them. `lastTenantId` never leaves the cloud. A hub paired earlier holds accounts
  its migration backfilled under random ids, and the first format 9 snapshot replaces them by
  e-mail, moving their users over.
- A trigger on `accounts` records a `CONFIG` change for every tenant where the account has a user,
  so a password reset reaches the hubs of all those brands. Sign-ins only move `last_tenant_id` and
  do not.

### Admin UI

- A brand switcher at the top of the sidebar: the organization name, "Organization overview", and
  each brand, the current one checked. Choosing one calls `/auth/switch`, replaces the session,
  clears query caches and applies that brand's branding and chosen branch. A one-brand person sees
  the brand's name, no menu.
- Organization pages (`/org/:organizationId`, `/reports/:kind`, `/members`) render in MADAR's
  neutral look with no tenant branding. Members is Owner only: add, change role, remove behind a
  confirm dialog, with toasts.
- Language and theme moved into a user menu, and the brand dashboard lost its stale copy. With the
  organization dashboard these fix design findings A1 and A2, and with the shared components L1,
  X2 and X4.
- The page shell, stat card, data table, chart, dropdown menu, confirm dialog and toast from ADR
  0028 were built for this. Corner radii derive from one radius, 8 px unbranded (`--radius: 0.5rem`),
  matching the tenant default, so nothing shifts when branding loads.

### Demo data

The seed creates **Demo Foods Group** (ILS, `Asia/Hebron`) with the brands **Burger House** (three
branches) and **Pizza Point** (two), each with a small menu. Members come from `SEED_ORG_OWNER_*`
(OWNER) and `SEED_ORG_FINANCE_*` (FINANCE). `SEED_DEMO_ORDERS=1` adds 30 days of deterministic paid
orders across the five branches. The four existing demo businesses stay standalone.

### Errors

`ORGANIZATION_NOT_FOUND` (404), `ORGANIZATION_CURRENCY_MISMATCH` (409), `ORGANIZATION_LAST_OWNER`
(409), `USER_MANAGED_BY_ORGANIZATION` (409) and `ORGANIZATION_SLUG_TAKEN` (409), in English and
Arabic. Conflicts that need a reason (`ALREADY_MEMBER`, `TENANT_IN_ORGANIZATION`, `LAST_OWNER`,
`ACCOUNT_SHARED`) use `409 CONFLICT` with `details.reason`.

## Consequences

- One migration moves every existing user's e-mail and password onto an `accounts` row; existing
  sign-ins keep working. A paired development hub gets accounts through its own migration and the
  first format 9 snapshot.
- Every brand keeps its own `User`, so tenant isolation, permissions, audit and the hub work
  unchanged. The price is rows: an organization with N members and B brands holds N × B linked
  users, kept in step by one service.
- The organization scope is read-only, so an organization page can never change a brand's data. Org
  staff manage a brand by switching into it.
- Reads through the organization scope filter tenant-keyed models only. New organization code that
  reads child tables or raw SQL must bind the brands itself, as the reports do.
- Access that spans branches of several brands without an organization role, and editing a member's
  per-brand role, are not possible: a member is tenant-wide in every brand.

### Known limits

- The switcher shows each brand's initials, not its logo, although the list carries `logoFileId`.
- No organization branding, no e-mail invites and no password reset (E2 covers account security).
- A suspended organization is not blocked from platform attach, provisioning or member changes.
- Reports across currencies are not supported by design.

## Alternatives considered

The design chose between three ways to give one person one sign-in over several tenants.

- **A (chosen): a shared `Account`, one `User` per brand linked to it.** The token, the guards,
  audit, roles, employees and the hub keep working per tenant. Costs: linked rows to keep in step,
  and an `accounts` table that now reaches the hub.
- **B: one global user with a role assignment per tenant** (the person is one row, roles name the
  tenant). Fewest rows, but `User.tenantId` is on every token, audit entry, employee link, refresh
  token and hub path, so each would change to "user in tenant". Isolation by construction (the
  scoped client keys on `tenantId`) would have had to be redesigned, for no behaviour users can see.
- **C: organization staff as a separate principal with no per-brand user.** No linked rows, but
  every permission check, audit write, PIN path and hub sync would need a second principal kind that
  works across tenants, and brand-level role management would have to know about it. It would also
  make the organization an exception to deny-by-default per tenant.

Rejected for scope, not for merit: shared menus across brands (each brand is a full tenant),
cross-currency reporting, and organization-level editing of a brand's data (organization scope
refuses writes).
