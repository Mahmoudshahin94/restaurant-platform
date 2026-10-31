# E1: Enterprise organizations — design

- Phase: E1 of the enterprise expansion ([brief](../../madar/enterprise-prompt.md)); ADR to be written: 0029.
- Status: design approved in conversation 2026-10-31; this spec is for review.
- Branch: `claude/enterprise-e1-organizations` (cut from `main` at ad8d77f).

## 1. Goal

One owner runs several brands — e.g. 10 burger restaurants and 10 pizza restaurants — each a full MADAR
business (tenant) with its own menu, branding, website, domains and branches. The owner signs in once,
switches between brands without signing in again, and sees one dashboard and reports across all brands.

**Done means:** an organization owner signs in once, sees both brands' numbers together, switches into either
brand and manages it; a person with access to one brand only can never see the other; nothing changes for a
business that is not in an organization.

### Decisions taken with the user

| Topic                  | Decision                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Model                  | `Organization` above `Tenant`; each brand stays a full tenant                               |
| Who sees across brands | the owner plus org-wide staff; everyone else is granted per brand or per branch, as today   |
| Currency               | one currency per organization; a brand in another currency cannot join                      |
| Shared management      | none in E1: org staff manage a brand by switching into it                                   |
| One login              | **approach A**: a shared login `Account`, one `User` per brand linked to it                 |
| Who adds org staff     | the platform admin (sets up the org and its owner) and the org owner (adds/removes members) |

### Out of scope

Shared menus or menu copy between brands; access that spans branches of different brands without an org-wide
role; e-mail invites and password reset (E2 covers account security); editing an org member's per-brand role;
organization branding; cross-currency reporting.

## 2. Data model

All changes in `packages/database/prisma/schema.prisma`, one migration.

### 2.1 New models

```prisma
/// @cloud-only
model Organization {
  id           String             @id @default(uuid(7)) @db.Uuid
  slug         String             @unique
  nameEn       String             @map("name_en")
  nameAr       String             @map("name_ar")
  /// Every brand of the organization uses this currency (ISO 4217).
  currencyCode String             @map("currency_code")
  status       OrganizationStatus @default(ACTIVE)
  createdAt    DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)
  tenants      Tenant[]
  members      OrganizationMember[]
  @@map("organizations")
}

enum OrganizationStatus { ACTIVE SUSPENDED }      // cloud-only enum
enum OrganizationRole   { OWNER MANAGER FINANCE } // cloud-only enum

/// @cloud-only
model OrganizationMember {
  id             String           @id @default(uuid(7)) @db.Uuid
  organizationId String           @map("organization_id") @db.Uuid
  accountId      String           @map("account_id") @db.Uuid
  role           OrganizationRole
  createdAt      DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  account        Account          @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@unique([organizationId, accountId])
  @@map("organization_members")
}

/// The login: one per person. Synced to the hub with the brand's users.
model Account {
  id           String   @id @default(uuid(7)) @db.Uuid
  email        String   @unique
  passwordHash String   @map("password_hash")
  /// The brand signed into last; sign-in returns to it.
  lastTenantId String?  @map("last_tenant_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  users        User[]
  memberships  OrganizationMember[]   // stripped on the hub
  @@map("accounts")
}
```

`Account` has no `tenantId`, so the scoped client treats it as global; it is read only by the auth and
organization services (both allowlisted for `runUnscoped`).

### 2.2 Changed models

- **`Tenant`**: `organizationId String? @db.Uuid` + `organization Organization? @relation(...)`. Null = a
  standalone business, exactly as today.
- **`User`**:
  - add `accountId String @db.Uuid` + relation; `@@unique([tenantId, accountId])` (one user per brand per person);
  - remove `passwordHash` (moves to `Account`);
  - `email` stays as a display copy, kept equal to `account.email` by the services; its unique index becomes
    `@@unique([tenantId, email])`;
  - add `organizationMemberId String? @db.Uuid` (cloud value; plain column on the hub): set on users the
    organization manages ("linked users", §3.3).
- **Built-in role "Finance"** added to every tenant's system roles (`provisioning.ts`), permissions:
  `reports.view` and `locations.view` only (reports and the brand dashboard; the plan confirms the dashboard
  needs nothing more).

### 2.3 Migration and rules

- SQL backfill: one `accounts` row per existing user (same e-mail and hash), `users.account_id` set, then
  `password_hash` dropped from `users`. Existing logins keep working.
- **Currency rule** (domain function `assertOrganizationCurrency`): attaching a tenant whose `currencyCode`
  differs from the organization's is refused (`ORGANIZATION_CURRENCY_MISMATCH`, 409); changing the currency of
  a tenant that belongs to an organization is refused with the same code.
- **Status:** a `SUSPENDED` organization blocks its organization pages and org switching into its brands as
  an org member; each brand keeps its own `Tenant.status`.

## 3. Sign-in, switching and linked users

### 3.1 Sign-in (`packages/server/src/modules/auth/auth.service.ts`)

`POST /auth/login {email, password, tenantId?}`:

1. find the `Account` by e-mail (inside the existing allowlisted `runUnscoped`); verify `passwordHash`
   (timing-dummy hash kept for unknown e-mails);
2. list its active users whose tenants are active (and, for linked users, whose organization is active);
3. pick `tenantId` if given and present, else `lastTenantId` if still usable, else the oldest user;
4. issue tokens for that user exactly as today (`{tid, sub}` claims unchanged) and set `lastTenantId`.

The response adds two lists (also on `GET /auth/me` and `/auth/refresh`):
`tenants: [{ id, nameEn, nameAr, logoFileId, organizationId }]` and
`organizations: [{ id, nameEn, nameAr, role }]`. A one-brand person gets one entry and no organizations.

The hub (`apps/gateway`) signs in the same way against its local copy (§6); the PIN sign-in is unchanged.

### 3.2 Switching

`POST /auth/switch {tenantId}` (authenticated by the access token, in the same access class as
`GET /auth/me`):

- finds an active user of the **same account** in that tenant (allowlisted `runUnscoped`, reason
  "switching brands looks up the account's user in another tenant");
- 404 `TENANT_NOT_FOUND` when there is none, exactly as a foreign tenant answers today;
- revokes the current refresh-token family, issues an access token and refresh cookie for the target user,
  updates `lastTenantId`, writes an audit entry `auth.switch` in **both** tenants;
- cloud only: the hub answers 404 (it holds one tenant).

### 3.3 Linked users (one organization service owns them)

`OrganizationService` (`apps/api/src/modules/organizations/`) is the only writer of linked users:

| Event                           | Effect in every brand of the organization                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| member added (role R)           | create a `User` for the account with the brand role for R (OWNER→Owner, MANAGER→Manager, FINANCE→Finance), tenant-wide, `organizationMemberId` set |
| member role changed             | replace the linked user's role                                                                                                                     |
| member removed                  | deactivate the linked users, revoke their refresh tokens                                                                                           |
| brand attached                  | create linked users for every member                                                                                                               |
| brand detached                  | deactivate that brand's linked users, revoke their tokens                                                                                          |
| account e-mail/password changed | update `Account`; touch the linked users so the change feed carries it to hubs                                                                     |

If the account already has a normal (non-linked) user in a brand, that user is kept and the org role is
added to it (`organizationMemberId` set); removing the member then removes only the added role.

Admin staff APIs (`apps/api/src/modules/admin/staff/users.service.ts`) refuse to edit, deactivate or change
roles of a user with `organizationMemberId` (`USER_MANAGED_BY_ORGANIZATION`, 409); the staff list shows them
with an "Organization" badge. Creating a staff user with an e-mail that already has an `Account` links the new
user to that account (the password given is ignored and the person keeps their own; the response is the
same either way, so it does not reveal whether the e-mail already had an account); otherwise a new account is
created. The person then sees the new brand in their switcher.

### 3.4 Provisioning

`provisionTenant` gains `organizationId?`. With an organization: the currency rule is checked, the tenant is
attached, and linked users are created for all members — the members' accounts are the owners, so no separate
owner e-mail is needed. Without one: unchanged (`OwnerEmailTakenError` when the e-mail already has an account).

## 4. Organization scope, dashboard and reports

### 4.1 Guard and scope

- `TenantContext` gains a fourth scope kind `organization { organizationId, tenantIds }`. Under it the scoped
  client adds `tenantId IN (tenantIds)` to every read of a tenant-scoped model and **refuses every write**
  (`TenantScopeError`). Unit-tested like the other kinds (`scoped-prisma.test.ts`).
- `OrganizationGuard` on every `/organizations/:organizationId/*` route: the principal's account must be a
  member of an `ACTIVE` organization, else 404 `ORGANIZATION_NOT_FOUND`; the route declares the org roles it
  allows with `@RequireOrganizationRole(...)`. It then runs the handler in the organization scope.
- The route inventory gets access class `organization`; `assertEveryRouteProtected` accepts it and
  `apps/api/test/security.test.ts` checks every such route answers 401 / 404 for a non-member / 403 for a
  role not allowed.

### 4.2 Endpoints (`apps/api/src/modules/organizations/`)

| Route                                                                                                 | Roles | Purpose                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /organizations/:id`                                                                              | all   | organization, its brands (with logos) and locations                                                                                         |
| `GET /organizations/:id/dashboard`                                                                    | all   | today, last 7 and last 30 days: sales, orders, average ticket, per brand and per branch, daily series; hubs online/offline                  |
| `GET /organizations/:id/reports/{daily-sales,brands,locations,channels,payments,products,categories}` | all   | filters `from`, `to`, `tenantIds`, `locationIds`, `channels`; same 366-day limit                                                            |
| `GET/POST /organizations/:id/members`, `PATCH/DELETE /organizations/:id/members/:memberId`            | OWNER | list, add (e-mail, name, role, starting password when the account is new), change role, remove; the last OWNER cannot be removed or demoted |

Reports reuse the SQL of `apps/api/src/modules/reports/` over the reporting views, with
`tenant_id = ANY($tenantIds)` instead of one tenant and an extra brand dimension; each branch keeps its own
business day (ADR 0015). Every amount is in the organization's currency (§2.3), so totals add up. A test
asserts the organization's totals equal the sum of the brands' own reports.

## 5. Admin UI (`apps/admin`)

- **Switcher** at the top of the sidebar (new shared `DropdownMenu`): the organization name, "Organization
  overview", then each brand with its logo; the current brand is checked. Choosing a brand calls
  `/auth/switch`, replaces the session, clears query caches and re-applies that brand's branding. A
  one-brand person sees today's brand name instead, no menu.
- The branch picker moves under the switcher; language and theme move into a user menu in the header
  (design finding A2).
- **Organization pages**, shown in MADAR's neutral look (no tenant branding):
  - `/org/:organizationId` — dashboard: stat cards, sales trend chart, tables by brand and by branch;
  - `/org/:organizationId/reports/:kind` — the seven reports with the filters above;
  - `/org/:organizationId/members` — Owner only: members table, add dialog, change role, remove with a
    confirm dialog; success and failure toasts.
- Brand dashboard: remove the stale "Full reports come later" copy.
- Session: `AuthUser` gains `tenants` and `organizations`; `useTenantId()` keeps reading the token's tenant.

### Design-system pieces built in E1 (per ADR 0028)

In `packages/ui` / `packages/app-kit`: the §4 token additions to `theme.css` (surfaces, `border-strong`,
`primary-subtle`/`-hover`, status `-subtle`, elevation, z-index, motion, type scale, `data-profile`),
`DropdownMenu`, `PageShell` (grouped collapsible sidebar, switcher slot, skip link), `StatCard`, `DataTable`
(sortable, sticky header, numeric alignment), `Chart` (Recharts, admin only), `AlertDialog`, `Toast`. Admin
adopts `PageShell` and the console profile; other apps are untouched in E1.

## 6. Hub, sync and platform admin

- **Hub schema:** `Organization`, `OrganizationMember` and their enums are `@cloud-only`; `Account` goes to
  the hub. Fix `packages/database/scripts/hub-schema.mjs` to also strip **forward** relation fields (with
  `@relation(...)`) that point at cloud-only models (`Tenant.organization`), and back-relations such as
  `Account.memberships`; extend `hub-schema.contract.test.ts`.
- **Snapshot** (format 8 → 9): adds the `accounts` of the snapshot's users; the hub applies them before users.
  The change feed's `user` entries carry the user's account row, so password changes reach the hub.
- **Platform admin** (`apps/platform-admin`, `apps/api/src/modules/platform/`):
  - new **Organizations** page: list (search, status), create (name, slug, currency, owner e-mail/name/
    password — or an existing account), detail with tabs Brands (attach existing, detach, provision new brand
    into it) and Members (same actions as the org owner);
  - tenants list: Organization column and filter; provision dialog: optional organization;
  - platform permissions `organizations.view`, `organizations.manage`; every change in `PlatformAuditLog`.

## 7. Demo data

- New seed file for **"Demo Foods Group"** (ILS, Asia/Hebron) with brands **"Burger House"** (3 branches)
  and **"Pizza Point"** (2 branches), each with a small menu; org members from `SEED_ORG_OWNER_*` (OWNER) and
  `SEED_ORG_FINANCE_*` (FINANCE), added to `infrastructure/.env.example`.
- `SEED_DEMO_ORDERS=1` adds 30 days of paid orders across the org's branches (deterministic), so the
  dashboard and reports show data. Off by default; the E2E setup uses it.
- The four existing demo businesses stay standalone.

## 8. Errors

New codes in `packages/shared-types` errors (EN + AR messages): `ORGANIZATION_NOT_FOUND` (404),
`ORGANIZATION_CURRENCY_MISMATCH` (409), `ORGANIZATION_LAST_OWNER` (409), `USER_MANAGED_BY_ORGANIZATION`
(409), `ORGANIZATION_SLUG_TAKEN` (409).

## 9. Testing

- **Unit:** role mapping, currency rule, organization scope kind (reads filtered, writes refused), switcher
  and members components, `DataTable`/`Chart`/`AlertDialog`/`Toast`.
- **Integration** (`apps/api/test/organizations.test.ts`, new): login lists brands; switch into own brand
  works and audits both tenants; switch to a foreign brand → 404; org routes: non-member → 404, brand-only
  user → 404, FINANCE on members → 403; linked users created on member add / brand attach and deactivated with
  tokens revoked on remove / detach; staff API refuses editing a linked user; last owner protected; currency
  mismatch refused; org report totals = sum of brand reports. Existing `tenant-isolation`, `tenancy`,
  `security`, `auth`, `reports`, `platform` suites keep passing (updated for `Account`).
- **Hub** (`apps/gateway/test`): e-mail sign-in through the synced account; snapshot format 9; schema
  contract.
- **E2E** (new scenarios after the last numbered one): (1) org owner signs in, sees both brands on the org
  dashboard, switches to Pizza Point and sees its products; (2) platform operator creates an organization
  and attaches a brand.
- **Gate:** `pnpm typecheck`, `lint`, `format:check`, `test`, `test:tools`, `version:check`, `e2e`, plus a
  manual browser check (dark + light, EN + AR) on a freshly seeded check DB with screenshots.

## 10. Docs

ADR 0029 (organizations and accounts); `docs/domain-model.md` (Organization, Account, linked users),
`docs/api.md` (new routes, login response), `docs/architecture.md` (scope kinds, access class, ADR list),
`docs/sync.md` (snapshot 9, accounts), `docs/configuration.md` (new seed variables), `docs/testing.md`,
`CHANGELOG.md`; remove the "no platform-operator UI / tenants by seed only" style statements that this
changes and add any deferred item to §Known gaps.
