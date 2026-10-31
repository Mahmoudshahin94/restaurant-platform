# E1 Enterprise Organizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One person signs in once, switches between the brands (tenants) of their organization, and sees an
organization dashboard and reports across brands.

**Architecture:** A shared login `Account` holds e-mail and password; each brand keeps its own `User` linked to
it (approach A). `Organization` (cloud-only) groups tenants of one currency; `OrganizationMember` gives an
account an org role, and `OrganizationService` keeps one linked user per member per brand. Org pages run under a
new read-only `organization` scope of `TenantContext`, behind `OrganizationGuard`.

**Tech Stack:** NestJS 11, Prisma 6 (PostgreSQL cloud, SQLite hub), Zod, React 19 + Vite + Tailwind v4,
TanStack Query, Radix, Recharts (new, admin only), Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-31-e1-organizations-design.md](../specs/2026-10-31-e1-organizations-design.md)
— read it with this plan; section numbers below (§) refer to it. Design system: [ADR 0028](../../adr/0028-enterprise-design-system.md),
[docs/madar/design-system.md](../../madar/design-system.md).

## Global Constraints

- Development only: migrate freely, no backward-compat shims or aliases; re-seed demo data.
- Every new tenant-owned table has `tenantId` and goes through `scopeToTenant`; `runUnscoped` only in files on
  the `eslint.config.js` allowlist, with a string-literal reason.
- Cloud-only models/enums carry `/// @cloud-only`; run `npx prisma format` on the cloud schema before
  `pnpm --filter @pos/database hub:schema`.
- Every new route: an access class in the route inventory and Zod validation of body/query/params.
- Money is integer minor units; one currency per organization.
- All strings in EN and AR (`packages/i18n/src/locales/{en,ar}/*.json`); RTL via logical classes only.
- The brand name never appears as a word in code or translations (`tools/brand/brand.test.mjs`).
- Lint forbids raw colours (`pos-local/no-raw-colors`); use tokens.
- Error codes: `ORGANIZATION_NOT_FOUND` 404, `ORGANIZATION_CURRENCY_MISMATCH` 409, `ORGANIZATION_LAST_OWNER`
  409, `USER_MANAGED_BY_ORGANIZATION` 409, `ORGANIZATION_SLUG_TAKEN` 409.
- Org role → brand role: `OWNER`→`Owner`, `MANAGER`→`Manager`, `FINANCE`→`Finance`; Finance permissions
  `reports.view`, `locations.view`.
- Snapshot format 8 → 9.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test commands: `pnpm --filter <pkg> test -- <file>`; API integration tests need Postgres running
  (see memory `local-dev-environment`) and use `TEST_DATABASE_URL`.

## Review Focus

1. **Account with no usable brand**: every user deactivated, or every tenant suspended → sign-in answers
   `ACCOUNT_DISABLED` (as today), never a 500, and never reveals which brands exist. (Task 3)
2. **Stale `lastTenantId`**: the brand was detached or the user deactivated → sign-in falls back to another
   usable brand instead of failing. (Task 3)
3. **Removed while signed in**: after a member is removed, `/auth/switch` into another brand answers 404 and
   `/auth/refresh` answers `ACCOUNT_DISABLED`, without waiting for anything. (Task 6)
4. **Existing user then org member then removed**: a person who was a normal Cashier in Burger House, added to
   the org as Finance and later removed, is still an active Cashier there. (Task 6)
5. **E-mail case and whitespace**: ` Owner@Demo.Local` signs in and is matched to the same account when added
   as a member; two accounts can never differ only by case. (Tasks 3 and 6)

---

### Task 1: Schema, migration and hub schema

**Files:**

- Modify: `packages/database/prisma/schema.prisma` (Tenant ~202, User 319-341, new models after `PlatformUser` block)
- Create: `packages/database/prisma/migrations/20261101090000_organizations_accounts/migration.sql`
- Modify: `packages/database/scripts/hub-schema.mjs:41-44` (strip forward relations)
- Modify: `packages/database/src/hub-schema.contract.test.ts:13-42`
- Modify: `packages/database/src/provisioning.ts` (Finance system role; `provisionOwner` creates/links an `Account`)
- Generated: `packages/database/prisma/hub/schema.prisma` (via `hub:schema`)
- Modify (keep the repo compiling): `packages/server/src/modules/auth/auth.service.ts:34-56`,
  `apps/api/src/modules/admin/staff/users.service.ts:75-90,188-193`,
  `apps/api/src/modules/platform/platform-directory.service.ts:162` — read/write the hash through `account`

**Interfaces:**

- Produces: Prisma models `Organization`, `OrganizationMember`, `Account`, enums `OrganizationStatus`,
  `OrganizationRole`; `Tenant.organizationId`; `User.accountId`, `User.organizationMemberId`; no
  `User.passwordHash`; `@@unique([tenantId, email])`, `@@unique([tenantId, accountId])` on `User`.
- Produces: `FINANCE_ROLE: RoleSpec` exported from `provisioning.ts` next to `OWNER_ROLE`, and
  `provisionOwner` signature unchanged but writing `Account` (`passwordHash` there) + `User.accountId`.

- [ ] **Step 1: Write the failing contract test** — in `hub-schema.contract.test.ts` add `Organization`,
      `OrganizationMember` to `CLOUD_ONLY_MODELS`, `OrganizationStatus`, `OrganizationRole` to `CLOUD_ONLY_ENUMS`,
      and a test `"the hub has accounts and tenants without organization relations"` asserting the hub DMMF has
      model `Account` with fields `email`, `passwordHash`, `lastTenantId`, `Tenant` has scalar `organizationId`
      and no field `organization`, and `Account` has no field `memberships`.
- [ ] **Step 2: Run** `pnpm --filter @pos/database test -- hub-schema.contract` → FAIL (models missing).
- [ ] **Step 3: Edit the schema** exactly as spec §2.1–2.2 (field names, maps, `@db.Uuid`, `@@map`s); `User.email`
      comment becomes "Display copy of the account's e-mail; unique per tenant."
- [ ] **Step 4: Fix `hub-schema.mjs`** so, for each removed model `X`, it also removes lines
      `\n  <field> +X\??( +@relation\([^)]*\))?(?= *\n)` (forward relations) before the existing back-relation pass.
- [ ] **Step 5: Write the migration** (hand-written SQL, then `prisma migrate diff` to confirm no drift):
      create enums/tables; `INSERT INTO accounts (id, email, password_hash, last_tenant_id, created_at, updated_at)
SELECT gen_random_uuid(), email, password_hash, tenant_id, created_at, now() FROM users`; set
      `users.account_id` by e-mail; `NOT NULL`; drop `users_email_key`, add the two unique indexes; drop
      `users.password_hash`; add `tenants.organization_id` FK `ON DELETE SET NULL`.
- [ ] **Step 6: Provisioning** — add `FINANCE_ROLE = { name: 'Finance', isSystem: true, permissions:
['reports.view', 'locations.view'] }` to every provisioned tenant; `provisionOwner` upserts the `Account` by
      lowercase e-mail (refusing with `OwnerEmailTakenError` when it exists, unchanged behaviour) and creates the
      `User` with `accountId`.
- [ ] **Step 7: Keep it compiling** — the three readers above use `include: { account: true }` /
      `account.passwordHash` (login still finds the user by e-mail; Task 3 replaces that lookup).
- [ ] **Step 8: Run** `npx prisma format` (cloud), `pnpm --filter @pos/database hub:schema`,
      `pnpm --filter @pos/database exec prisma migrate deploy` on the test DB, then the contract test → PASS;
      `pnpm --filter @pos/database test`, `pnpm typecheck`, `pnpm --filter @pos/api test -- auth` → PASS.
- [ ] **Step 9: Commit** `feat(db): organizations, members and accounts (E1)`.

### Task 2: Domain rules and error codes

**Files:**

- Create: `packages/domain/src/organizations/organizations.ts`, `packages/domain/src/organizations/organizations.test.ts`
- Modify: `packages/domain/src/index.ts`, `packages/shared-types/src/errors.ts`, `packages/shared-types/src/enums.ts`
  (`OrganizationRole`, `OrganizationStatus` const objects), `packages/server/src/common/errors/http-status.ts`,
  `packages/i18n/src/locales/{en,ar}/errors.json`

**Interfaces:**

- Produces (from `@pos/domain`):
  - `brandRoleFor(role: OrganizationRole): 'Owner' | 'Manager' | 'Finance'`
  - `assertOrganizationCurrency(organizationCurrency: string, tenantCurrency: string): void` — throws
    `DomainError('ORGANIZATION_CURRENCY_MISMATCH')`
  - `assertOwnersRemain(members: { id: string; role: OrganizationRole }[], change: { memberId: string; role: OrganizationRole | null }): void`
    — `null` = removal; throws `DomainError('ORGANIZATION_LAST_OWNER')` when no OWNER would remain
  - `ORGANIZATION_ROUTE_ROLES = { read: ['OWNER','MANAGER','FINANCE'], manageMembers: ['OWNER'] } as const`

- [ ] **Step 1: Write failing tests**: `brandRoleFor` maps all three; currency `'ILS','ILS'` passes, `'ILS','SAR'`
      throws code `ORGANIZATION_CURRENCY_MISMATCH`; `assertOwnersRemain` throws when removing or demoting the only
      OWNER, passes with two OWNERs or when changing a MANAGER.
- [ ] **Step 2: Run** `pnpm --filter @pos/domain test -- organizations` → FAIL.
- [ ] **Step 3: Implement**; add the five error codes with statuses (404/409) and EN/AR messages.
- [ ] **Step 4: Run** domain tests and `pnpm --filter @pos/i18n test` (resources parity) → PASS.
- [ ] **Step 5: Commit** `feat(domain): organization roles, currency and owner rules`.

### Task 3: Sign-in through accounts, brand list in the session

**Files:**

- Modify: `packages/server/src/modules/auth/auth.service.ts` (`login`, `completeLogin`, `buildResponse`),
  `packages/server/src/modules/auth/access.service.ts` (`loadAuthUser`), `packages/server/src/modules/auth/auth.controller.ts`
  (login body `tenantId?`)
- Create: `packages/server/src/modules/auth/account-directory.ts`
- Modify: `packages/validation/src/auth.ts` (`loginSchema` gains `tenantId: idSchema.optional()`; `authUserSchema`
  gains `accountId`, `tenants`, `organizations`)
- Create: `apps/api/src/modules/organizations/cloud-account-directory.ts`; hub: `apps/gateway/src/hub-account-directory.ts`;
  register in `apps/api/src/app.module.ts` / `apps/gateway/src/hub.module.ts`
- Modify: `apps/api/src/modules/admin/staff/users.service.ts:75-90,188-193` (password on `Account`)
- Test: `apps/api/test/auth.test.ts`, `apps/gateway/test/hub.test.ts`, `packages/server/src/modules/auth/*.test.ts` as present

**Interfaces:**

- Produces:
  - `export const ACCOUNT_DIRECTORY = Symbol('ACCOUNT_DIRECTORY')`
  - `interface AccountDirectory { brandsFor(accountId: string): Promise<AuthBrand[]>; organizationsFor(accountId: string): Promise<AuthOrganization[]> }`
  - `AuthBrand = { id; nameEn; nameAr; logoFileId: string | null; organizationId: string | null }`,
    `AuthOrganization = { id; nameEn; nameAr; role: OrganizationRole }` (Zod in `@pos/validation`)
  - `AuthUser` = existing fields + `accountId`, `tenants: AuthBrand[]`, `organizations: AuthOrganization[]`
  - `AuthService.login(email: string, password: string, tenantId?: string): Promise<IssuedSession>`
  - `AuthService.usableUserFor(accountId: string, tenantId: string): Promise<{ id; tenantId } | null>` (used by Task 4)
- Hub directory returns its one tenant and `[]`; cloud directory reads users of the account (active user,
  active tenant, and for org-linked users an active organization) and memberships.

- [ ] **Step 1: Write failing integration tests** in `apps/api/test/auth.test.ts`:
  - `"login returns the account's brands"` — a person with users in tenants A and B (helper creates the second
    user on the same account) gets `user.tenants` with both ids and `organizations: []`;
  - `"login honours tenantId, then the last brand"` — login with `tenantId: B` → token `tid` B; next login
    without `tenantId` → B again;
  - `"a stale last brand falls back"` — deactivate the B user → login → `tid` A (Review Focus 2);
  - `"no usable brand is ACCOUNT_DISABLED"` — deactivate both → 403 `ACCOUNT_DISABLED`; suspend both tenants →
    the existing suspended response (Review Focus 1);
  - `"e-mail is trimmed and case-insensitive"` — `'  Owner@Demo.Local '` signs in (Review Focus 5);
  - `"a login for another tenant id is ignored, not an error"` — `tenantId` of a foreign tenant → signs into
    the account's own brand.
- [ ] **Step 2: Run** `pnpm --filter @pos/api test -- auth` → FAIL.
- [ ] **Step 3: Implement**: `login` finds `Account` by normalized e-mail inside the existing `runUnscoped`
      (reason unchanged), verifies `account.passwordHash` (timing dummy kept), selects the user by the order
      requested → `lastTenantId` → oldest `createdAt`, writes `lastTenantId`, then `completeLogin` in that tenant
      (audit unchanged); `loadAuthUser` adds the three new fields via `ACCOUNT_DIRECTORY`; staff password set/reset
      writes `Account.passwordHash`.
- [ ] **Step 4: Hub** — `apps/gateway/test/hub.test.ts` `"e-mail sign-in uses the synced account"` passes with
      the hub directory (accounts reach the hub in Task 5; until then the hub test seeds an `Account` row directly).
- [ ] **Step 5: Run** `pnpm --filter @pos/api test -- auth tenant-isolation security` and
      `pnpm --filter @pos/gateway test` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(auth): sign in through accounts and list the account's brands`.

### Task 4: Switching brands

**Files:**

- Modify: `packages/server/src/modules/auth/auth.controller.ts` (new `POST /auth/switch`), `auth.service.ts`
  (`switchTenant`), `packages/validation/src/auth.ts` (`switchSchema = z.object({ tenantId: idSchema })`)
- Modify: `eslint.config.js:81-100` only if the lookup lives outside `auth.service.ts` (it should not)
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**

- Consumes: `usableUserFor` (Task 3).
- Produces: `AuthService.switchTenant(principal: Principal, tenantId: string, currentRefresh: string | undefined): Promise<IssuedSession>`;
  route `POST /auth/switch` with the same guard and inventory class as `GET /auth/me`; cookie handling as
  `/auth/refresh` (web) / body `refreshToken` (native). On the hub the service throws `TENANT_NOT_FOUND`
  (mode `HUB`).

- [ ] **Step 1: Write failing tests**:
  - `"switch issues a session for the account's user in the other brand"` — token `tid` B, `user.id` is the B
    user, old refresh token now answers `TOKEN_REUSED`/revoked, audit `auth.switch` exists in A and in B;
  - `"switch to a brand of another account is 404"` → 404 `TENANT_NOT_FOUND`;
  - `"switch to a deactivated user's brand is 404"`;
  - `"switch without a token is 401"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (revoke current family, `issueSession` for target, update
      `lastTenantId`, two audit entries via `runInTenant`-free `audit.record` calls with explicit `tenantId` — the
      lookup of the target user uses `runUnscoped('switching brands: find the account's user in another tenant', …)`).
- [ ] **Step 4: Run** auth + security tests → PASS (security test: the new route is listed with the expected class).
- [ ] **Step 5: Commit** `feat(auth): switch between an account's brands`.

### Task 5: Accounts reach the hub (snapshot 9 and change feed)

**Files:**

- Modify: `apps/api/src/modules/sync/snapshot.service.ts:51-110` (add `accounts`), `packages/validation/src/hub.ts:171`
  (`format: z.literal(9)`, `accounts` array), `apps/gateway/src/snapshot/apply-snapshot.ts` (apply accounts before
  users), the change-feed producer for `user` entries (where `record_config_change('user')` rows are expanded into
  payloads in `apps/api/src/modules/sync/`) to include the user's account row, and the hub's change applier
- Test: `apps/api/test/sync.test.ts`, `apps/gateway/test/hub.test.ts`

**Interfaces:**

- Produces: snapshot `accounts: { id; email; passwordHash; lastTenantId: null }[]` (only accounts of the
  snapshot's users; `lastTenantId` never leaves the cloud); `user` change payload gains `account`.

- [ ] **Step 1: Failing tests** — `sync.test.ts` `"the snapshot carries the users' accounts"` (format 9, account
      ids = users' accountIds, no account of another tenant's user); `hub.test.ts` `"a password change in the cloud
reaches the hub"` (change the password via the staff API → hub sync → hub login with the new password works,
      old fails).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; account password change touches the account's users
      (`updatedAt`) so the existing trigger records `user` changes.
- [ ] **Step 4: Run** `pnpm --filter @pos/api test -- sync` and `pnpm --filter @pos/gateway test` → PASS.
- [ ] **Step 5: Commit** `feat(sync): accounts in the hub snapshot and change feed (format 9)`.

### Task 6: Organization scope, guard, members and linked users

**Files:**

- Modify: `packages/server/src/common/tenancy/tenant-context.ts` (scope kind `organization`; `runInOrganization`),
  `packages/server/src/common/tenancy/scoped-prisma.ts` (`scopeArgs` branch), `scoped-prisma.test.ts`
- Modify: `packages/server/src/common/auth/route-inventory.ts` (class `organization`, `ORGANIZATION_ROUTE_KEY`),
  `apps/api/test/security.test.ts`
- Create: `apps/api/src/modules/organizations/organization.guard.ts`, `organization-route.ts` (decorator),
  `organizations.module.ts`, `organization.service.ts`, `members.controller.ts`; register in `app.module.ts`;
  add `organization.service.ts` and `cloud-account-directory.ts` to the `runUnscoped` allowlist
- Modify: `apps/api/src/modules/admin/staff/users.service.ts`, `roles.service.ts`/`staff.controller.ts` (refuse
  linked users; link existing account on create)
- Test: `apps/api/test/organizations.test.ts` (new), `apps/api/test/admin-staff.test.ts`

**Interfaces:**

- Produces:
  - `TenantScope` adds `{ kind: 'organization'; organizationId: string; tenantIds: string[] }`;
    `TenantContext.runInOrganization<T>(organizationId: string, tenantIds: string[], fn): Promise<T>`
  - scoped client under it: reads get `{ [key]: { in: tenantIds } }`; every create/update/upsert/delete throws
    `TenantScopeError('Organization scope is read-only')`
  - `@OrganizationRoute(roles: readonly OrganizationRole[])` — applies `OrganizationGuard`, metadata for the inventory
  - `interface RequestOrganization { id: string; role: OrganizationRole; tenantIds: string[]; currencyCode: string }`
    (in `organization.guard.ts`); `@CurrentOrganization()` param decorator returns it
  - `OrganizationGuard` sets `request.organization: RequestOrganization` and runs the handler
    in `runInOrganization`; non-member/suspended/unknown → 404 `ORGANIZATION_NOT_FOUND`; role not allowed → 403 `FORBIDDEN`
  - `OrganizationService`:
    `addMember(orgId, input: { email; displayName; role; password?: string }, actor): Promise<MemberDto>`,
    `changeRole(orgId, memberId, role, actor)`, `removeMember(orgId, memberId, actor)`,
    `attachTenant(orgId, tenantId, actor)`, `detachTenant(orgId, tenantId, actor)`,
    `syncLinkedUsers(orgId)` (idempotent: brings every member × brand to the §3.3 table)
  - Routes (Owner only): `GET/POST /organizations/:organizationId/members`, `PATCH/DELETE …/members/:memberId`
  - `MemberDto = { id; accountId; email; displayName; role; createdAt }`

- [ ] **Step 1: Failing unit tests** (`scoped-prisma.test.ts`): organization scope adds `tenantId in [a,b]` to
      `findMany`/`count`/`aggregate`, `Tenant` filtered by `id in`, `create` and `update` throw.
- [ ] **Step 2: Failing integration tests** (`organizations.test.ts`, helper `createOrganization({ brands: 2 })`
      creating the org, two ILS tenants with an owner account as OWNER member):
  - `"members get a linked user in every brand"` — add FINANCE → users in both brands with role Finance,
    `organizationMemberId` set; the member's `/auth/me` lists both brands and the org with role FINANCE;
  - `"attaching a brand creates linked users; detaching deactivates them and revokes sessions"`;
  - `"a removed member cannot switch or refresh"` (Review Focus 3);
  - `"an existing brand user keeps their own role after leaving the organization"` (Review Focus 4);
  - `"adding a member by e-mail matches the existing account regardless of case"` (Review Focus 5);
  - `"the last owner cannot be removed or demoted"` → 409 `ORGANIZATION_LAST_OWNER`;
  - `"organization routes are 404 for non-members and brand-only users, 403 for FINANCE on members"`;
  - `"a suspended organization hides its pages and its members' linked brands"` — org pages 404, the
    member's `/auth/me` no longer lists the org's brands, switching into them → 404;
  - `"a brand with another currency cannot be attached"` → 409 `ORGANIZATION_CURRENCY_MISMATCH`; changing a
    member brand's currency → same 409 (localization settings path);
  - `admin-staff.test.ts` `"the staff API refuses to edit a user managed by the organization"` → 409
    `USER_MANAGED_BY_ORGANIZATION`, and `"creating staff with an existing account's e-mail links it"` (same
    response shape either way; the account's password unchanged).
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement**; security test asserts every `organization` route answers 401
      without token, 404 for a non-member owner of another tenant, 403 for a FINANCE member where not allowed.
- [ ] **Step 5: Run** `pnpm --filter @pos/server test`, `pnpm --filter @pos/api test -- organizations admin-staff
security tenant-isolation` → PASS; `pnpm lint` → PASS (allowlist).
- [ ] **Step 6: Commit** `feat(organizations): org scope, guard, members and linked users`.

### Task 7: Organization dashboard and reports

**Files:**

- Modify: `apps/api/src/modules/reports/report-context.ts` (`ReportContext.tenantId` → `tenantIds: string[]`;
  `reportFilter` uses `tenant_id = ANY(${ctx.tenantIds}::uuid[])`), `sales-reports.service.ts`,
  `operations-reports.service.ts` (update callers; products/categories also group by `tenant_id`)
- Create: `apps/api/src/modules/organizations/org-report-context.ts`, `org-reports.controller.ts`,
  `org-dashboard.service.ts`, `org-reports.service.ts` (brands + locations reports only; the rest reuse
  `SalesReportsService`/`OperationsReportsService`)
- Modify: `packages/validation/src/reports.ts` (or where `reportQuerySchema` lives: add `orgReportQuerySchema`
  with `tenantIds`), shared report DTO types (add `tenantId` on product/category rows)
- Test: `apps/api/test/org-reports.test.ts` (new), existing `apps/api/test/reports.test.ts`

**Interfaces:**

- Consumes: `OrganizationGuard` request data (Task 6).
- Produces:
  - `OrgReportContextResolver.resolve(org: RequestOrganization, q: OrgReportQueryInput): Promise<ReportContext>`
    (tenantIds narrowed by `q.tenantIds`, locations of those tenants narrowed by `q.locationIds` — any foreign id
    → 404 `TENANT_NOT_FOUND`/`LOCATION_NOT_FOUND`; header currency = organization currency)
  - `GET /organizations/:organizationId` → `{ organization, brands: [{ id, nameEn, nameAr, logoFileId, locations: [{ id, code, nameEn, nameAr, timezone }] }] }`
  - `GET /organizations/:organizationId/dashboard` → `OrgDashboard = { currencyCode; periods: { today; last7; last30 } each { salesTotal; orderCount; averageTicket }; byBrand: { tenantId; salesTotal; orderCount }[]; byLocation: { tenantId; locationId; salesTotal; orderCount; hubOnline: boolean }[]; daily: { date; byTenant: Record<string, number> }[] }`
  - `GET /organizations/:organizationId/reports/{daily-sales,brands,locations,channels,payments,products,categories}`

- [ ] **Step 1: Failing tests** (`org-reports.test.ts`, fixture: org with two brands and identical orders from
      `report-fixture.ts` in each):
  - `"organization totals equal the sum of the brands' reports"` — for each of daily-sales, channels, payments:
    org total = brand A total + brand B total (from the brand endpoints);
  - `"brands and locations reports split by brand and branch"`;
  - `"filters by brand and branch; a foreign id is 404"`;
  - `"the dashboard counts each branch's business day in its own timezone"` — one branch in `Asia/Hebron`, one
    in `UTC`, an order at 23:30 UTC lands on the right day per branch;
  - existing `reports.test.ts` still passes unchanged in behaviour.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter @pos/api test -- reports
org-reports` → PASS.
- [ ] **Step 5: Commit** `feat(organizations): organization dashboard and reports`.

### Task 8: Platform admin API for organizations

**Files:**

- Modify: `packages/shared-types/src/platform.ts:26-76` (`organizations.view`, `organizations.manage`, assigned
  to roles like `tenants.view`/`tenants.manage`)
- Create: `apps/api/src/modules/platform/organizations/platform-organizations.service.ts`,
  `platform-organizations.controller.ts`; register in `platform.module.ts`
- Modify: `apps/api/src/modules/platform/platform-directory.service.ts:63-117` (tenant list: `organizationId`
  filter, organization name in rows), `:124-185` (provision with `organizationId`), `packages/database/src/provisioning.ts`
  (`provisionTenant` input `organizationId?`)
- Test: `apps/api/test/platform.test.ts`

**Interfaces:**

- Consumes: `OrganizationService` (Task 6) for members and attach/detach.
- Produces routes (`@RequirePlatformPermissions`): `GET /platform/organizations` (search, status, page),
  `POST /platform/organizations` `{ slug; nameEn; nameAr; currencyCode; owner: { email; displayName; password? } }`,
  `GET /platform/organizations/:organizationId`, `PATCH …/:organizationId` (names, status),
  `POST …/:organizationId/tenants` `{ tenantId }`, `DELETE …/:organizationId/tenants/:tenantId`,
  `GET/POST/PATCH/DELETE …/:organizationId/members[/:memberId]`; provision body gains `organizationId?`.
  Every write → `PlatformAuditLog` (`organization.create|update|attach|detach|member_add|member_role|member_remove`).

- [ ] **Step 1: Failing tests** in `platform.test.ts`: create (slug taken → 409 `ORGANIZATION_SLUG_TAKEN`), attach
      (currency mismatch → 409), provision a brand into the organization (members get linked users, no owner e-mail
      needed), tenant list filter `organizationId`, VIEWER cannot create (403), audit entries written.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter @pos/api test -- platform security` → PASS.
- [ ] **Step 5: Commit** `feat(platform): manage organizations`.

### Task 9: Demo organization and demo orders

**Files:**

- Create: `packages/database/seed/organizations/01-demo-foods.json` (organization, two brands with menus — reuse
  the shape of `seed/tenants/*.json` — and members by env prefix)
- Create: `packages/database/src/seed-orders.ts` (deterministic 30 days of paid orders per branch)
- Modify: `packages/database/src/seed.ts:491-515` (organizations after tenants; orders when `SEED_DEMO_ORDERS=1`),
  `infrastructure/.env.example:69-84` (`SEED_ORG_OWNER_EMAIL/_PASSWORD`, `SEED_ORG_FINANCE_EMAIL/_PASSWORD`,
  `SEED_DEMO_ORDERS`), `tools/e2e/prepare-db.mjs` (sets `SEED_DEMO_ORDERS=1` and the org variables)

**Interfaces:**

- Produces: organization slug `demo-foods`, brands `burger-house` (locations `BH1`,`BH2`,`BH3`) and `pizza-point`
  (`PP1`,`PP2`), all ILS, `Asia/Hebron`; seed is re-runnable (upserts, no duplicate orders: orders keyed by a
  deterministic id from `(locationCode, day, n)`).

- [ ] **Step 1: Failing test** `packages/database/src/seed.test.ts` (or the existing seed test file)
      `"seeding twice yields one organization, two brands, five branches and the same order count"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; run `pnpm db:seed` against a fresh
      check DB with `SEED_DEMO_ORDERS=1` and confirm the org dashboard endpoint returns non-zero `last30.salesTotal`.
- [ ] **Step 5: Commit** `feat(seed): demo organization with two brands and demo orders`.

### Task 10: Design-system foundations (tokens and overlay components)

**Files:**

- Modify: `packages/ui/src/styles/theme.css` (spec §5 / design-system §4: surfaces, `border-strong`,
  `primary-subtle`/`-hover`, status `-subtle`, `info`, shadows 1–4, z-index scale, motion durations/easings,
  type scale, `data-profile` blocks; radii derived from `--radius` as sm .6r / md r / lg 1.4r / xl 2r)
- Modify: `packages/app-kit/src/theme/apply-tenant-theme.ts` (write `--color-primary-hover`, `--color-primary-subtle`
  from the tenant primary), `packages/domain/src/branding/contrast.ts` + `theme-tokens.ts` (check `primary-subtle`)
- Modify: `packages/ui/src/components/button.tsx` (variants `primary` (rename of `default`), sizes `sm md lg xl 2xl`
  (`touch` → `xl`), `loading` prop, neutral disabled) and every caller (rename in one change)
- Modify: `packages/ui/src/components/spinner.tsx` (`motion-safe:`)
- Create: `packages/ui/src/components/dropdown-menu.tsx`, `alert-dialog.tsx` (replaces
  `apps/admin/src/components/confirm-dialog.tsx`), `toast.tsx` (+ `useToast`, `Toaster`); export from `packages/ui/src/index.ts`
- Deps: `@radix-ui/react-dropdown-menu`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-toast` in `packages/ui`
- Test: `packages/ui/src/components/*.test.tsx`

**Interfaces:**

- Produces: `Button` props `variant: 'primary'|'secondary'|'outline'|'ghost'|'destructive'|'link'`,
  `size: 'sm'|'md'|'lg'|'xl'|'2xl'|'icon-sm'|'icon-md'|'icon-lg'|'icon-xl'`, `loading?: boolean`;
  `DropdownMenu*` (Radix re-exports styled); `AlertDialog({ title, description, confirmLabel, destructive?, onConfirm, trigger })`;
  `toast({ title, description?, variant?: 'default'|'success'|'destructive' })`, `<Toaster />`.

- [ ] **Step 1: Failing tests**: Button `loading` sets `aria-busy="true"`, disables, keeps text; AlertDialog
      calls `onConfirm` only on confirm and closes on Escape; toast renders in a `role="status"` region and
      disappears after 4 s (fake timers); Spinner has `motion-safe:animate-spin`.
- [ ] **Step 2: Run** `pnpm --filter @pos/ui test` → FAIL. **Step 3: Implement + rename callers**
      (`grep -rn "variant=\"default\"\|size=\"touch\"" apps packages`).
- [ ] **Step 4: Run** `pnpm --filter @pos/ui test`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (all app
      component tests) → PASS.
- [ ] **Step 5: Commit** `feat(ui): design tokens, button spec, menu, confirm dialog and toast (ADR 0028)`.

### Task 11: Data components: PageShell, StatCard, DataTable, Chart

**Files:**

- Create: `packages/ui/src/components/stat-card.tsx`, `data-table.tsx`, `packages/app-kit/src/components/page-shell.tsx`;
  `apps/admin/src/components/chart.tsx` (Recharts lives in admin only; add `recharts` to `apps/admin`)
- Test: matching `*.test.tsx`

**Interfaces:**

- Produces:
  - `StatCard({ label, value, hint?, trend?: { value: number; label: string } })`
  - `DataTable<T>({ columns: { id; header; cell(row: T); align?: 'start'|'end'; sortValue?(row: T): string|number }[]; rows: T[]; rowKey(row: T): string; empty?: ReactNode; density?: 'compact'|'comfortable' })`
    — click header sorts, `aria-sort` set, sticky header, `end` columns use `tabular-nums`
  - `PageShell({ brand: ReactNode /* switcher slot */, nav: { label; items: { to; label; icon }[] }[], header: ReactNode, children })`
    — collapsible groups (state in localStorage, try/catch), active item, skip link to `#main`
  - `Chart({ data, series: { key; label }[], x: string, kind: 'bar'|'line', ariaLabel })` with a visually
    hidden data table fallback

- [ ] **Step 1: Failing tests**: DataTable sorts numeric column ascending then descending with `aria-sort`;
      PageShell renders skip link and collapses a group; Chart renders the fallback table with every value.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** package tests + `pnpm --filter @pos/admin build` → PASS.
- [ ] **Step 5: Commit** `feat(ui): page shell, stat card, data table and chart`.

### Task 12: API client

**Files:**

- Modify: `packages/api-client/src/client.ts` / `admin.ts` (`auth.switch`, `organizations.{get,dashboard,reports.*,members.*}`),
  `packages/api-client/src/platform.ts` (`organizations.*`, provision `organizationId`)
- Test: `packages/api-client/src/http.test.ts` (one test per new path builder)

**Interfaces:**

- Produces: `api.auth.switch(tenantId: string): Promise<TokenResponse>`; `api.organizations.get(id)`,
  `.dashboard(id)`, `.reports[kind](id, q: OrgReportQuery)`, `.members.list/add/changeRole/remove`;
  `platformApi.organizations.list/create/get/update/attach/detach/members.*`.

- [ ] **Step 1–4:** failing path tests → implement → `pnpm --filter @pos/api-client test` PASS.
- [ ] **Step 5: Commit** `feat(api-client): organizations and brand switching`.

### Task 13: Admin — shell, switcher, organization pages

**Files:**

- Modify: `apps/admin/src/components/app-shell.tsx` (adopt `PageShell`; `BrandSwitcher` in the brand slot;
  `LocationPicker` under it; user menu with language, theme, sign-out), `apps/admin/src/app-routes.tsx` (org routes),
  `packages/app-kit/src/session.ts` (`replaceSession(tokenResponse)` used by the switcher)
- Create: `apps/admin/src/components/brand-switcher.tsx`, `apps/admin/src/routes/organization/org-dashboard-page.tsx`,
  `org-reports-page.tsx`, `org-members-page.tsx`, `apps/admin/src/routes/organization/org-scope.tsx` (neutral theme,
  no `TenantProvider` branding)
- Modify: `apps/admin/src/routes/dashboard-page.tsx` (remove "Full reports come later"), `apps/admin/src/routes/staff/users-page.tsx`
  (Organization badge, no edit actions for linked users), `packages/i18n/src/locales/{en,ar}/admin.json`
- Test: `apps/admin/src/components/brand-switcher.test.tsx`, `apps/admin/src/routes/organization/*.test.tsx`

**Interfaces:**

- Consumes: Tasks 10–12.
- Routes: `/org/:organizationId`, `/org/:organizationId/reports/:kind`, `/org/:organizationId/members`
  (members only when the session's org role is OWNER; others get the not-found page).

- [ ] **Step 1: Failing component tests**:
  - switcher lists org overview + both brands, checks the current one; choosing Pizza Point calls
    `api.auth.switch('<id>')`, replaces the session, clears the query cache and navigates to `/`;
  - a one-brand session shows the brand name and no menu;
  - org dashboard renders stat cards and the by-brand table from a mocked `OrgDashboard`;
  - members page: add dialog validates e-mail; remove asks for confirmation; last-owner 409 shows the error toast
    text from `errors.ORGANIZATION_LAST_OWNER`;
  - users page shows the Organization badge and no edit button for a linked user.
- [ ] **Step 2: Run** `pnpm --filter @pos/admin test` → FAIL. **Step 3: Implement.** **Step 4: Run** admin tests,
      `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5: Commit** `feat(admin): brand switcher and organization pages`.

### Task 14: Platform admin — organizations UI

**Files:**

- Create: `apps/platform-admin/src/routes/organizations-page.tsx`, `organization/organization-detail-page.tsx`
  (tabs Brands, Members), `organization/create-organization-dialog.tsx`
- Modify: `apps/platform-admin/src/components/app-shell.tsx:22-28,52` (nav entry; **fix the logo**: render the
  mark at its 132×32 aspect with `h-7 w-auto` and an inline-SVG/`currentColor`-safe variant, design finding L1),
  `apps/platform-admin/src/app-routes.tsx:42-48`, `routes/tenants-page.tsx` (Organization column + filter),
  `routes/provision-dialog.tsx` (optional organization select), `packages/i18n/src/locales/{en,ar}/platform.json`
- Test: `apps/platform-admin/src/routes/organizations-page.test.tsx`, `organization-detail-page.test.tsx`

- [ ] **Step 1: Failing tests**: list renders rows and filters by status; create dialog posts the body of Task 8;
      attach shows the currency-mismatch error; VIEWER sees no create button; logo `img` is not square-constrained.
- [ ] **Step 2–4:** run FAIL → implement → `pnpm --filter @pos/platform-admin test` PASS.
- [ ] **Step 5: Commit** `feat(platform-admin): organizations`.

### Task 15: End-to-end scenarios 35 and 36

**Files:**

- Create: `apps/admin/e2e/organizations.spec.ts`; Modify: `apps/platform-admin/e2e/platform-admin.spec.ts`
- Modify: `docs/testing.md` (rows 35 and 36 in the critical-scenario matrix; `tools/e2e/coverage.test.mjs` checks them)

- [ ] **Step 1: Write the tests**:
  - 35 `"an organization owner sees both brands and switches to one"` — sign in as `SEED_ORG_OWNER_EMAIL`, org
    dashboard shows "Burger House" and "Pizza Point" rows with non-zero sales, switch to Pizza Point, Products page
    lists a Pizza Point product and no Burger House product, then the same in Arabic for the dashboard heading;
  - 36 `"an operator creates an organization and attaches a brand"` — create "E2E Group" (ILS), attach
    `ramallah-roasters`, see it in the tenants list's Organization column.
- [ ] **Step 2: Run** `pnpm --filter @pos/admin test:e2e` and `pnpm --filter @pos/platform-admin test:e2e` → PASS;
      `pnpm test:tools` → PASS (matrix 1–36).
- [ ] **Step 3: Commit** `test(e2e): organization owner and operator scenarios (35, 36)`.

### Task 16: Docs, full gate and manual check

**Files:**

- Create: `docs/adr/0029-organizations-and-accounts.md`
- Modify: `docs/domain-model.md`, `docs/api.md` (login response, `/auth/switch`, `/organizations/*`,
  `/platform/organizations/*`), `docs/architecture.md` (scope kinds, access class `organization`, ADR list item 27,
  remove/adjust statements contradicted by E1, §Known gaps: add "access spanning branches of several brands
  without an org role", "org branding", "e-mail invites"), `docs/sync.md` (format 9, accounts),
  `docs/configuration.md` (seed variables), `docs/testing.md`, `CHANGELOG.md` (Unreleased → Added),
  `docs/madar/design-system.md` §2 (mark A1, A2, L1, X2, X4 fixed)

- [ ] **Step 1:** write the docs. **Step 2:** run the gate: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
      `pnpm test`, `pnpm test:tools`, `pnpm version:check`, `pnpm e2e` — all green, output kept.
- [ ] **Step 3:** manual check on a fresh `pos_kds_e1_check` DB seeded with `SEED_DEMO_ORDERS=1`: org owner
      sign-in, dashboard, reports, members add/remove, switch both ways, brand-only user cannot open `/org/...`,
      platform organizations; dark + light, EN + AR; screenshots in the session notes.
- [ ] **Step 4: Commit** `docs: organizations and accounts (E1, ADR 0029)`.
