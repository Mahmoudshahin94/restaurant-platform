import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient, verifySecret } from '@pos/database';
import { newId } from '@pos/domain';
import { PrismaService, TenantContext, type TenantScope } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import type { AuthUser, LinkedMemberDto, MemberDto, TokenResponse } from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type OrganizationActor,
  OrganizationService,
} from '../src/modules/organizations/organization.service';
import {
  type OrganizationFixture,
  PASSWORD,
  bearer,
  createOrganization,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';

/**
 * Organizations (E1): members and their linked users in every brand, the organization guard and
 * scope, and the rules that keep a person's own brand access apart from the organization's.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let service: OrganizationService;
let org: OrganizationFixture;
let ownerHeaders: Record<string, string>;
const operator: OrganizationActor = { kind: 'platform', platformUserId: newId() };

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  service = app.get(OrganizationService);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  org = await createOrganization(app, prisma, { brands: 2 });
  ownerHeaders = bearer(await login(app, org.owner.email));
});

const members = () => `/api/v1/organizations/${org.organizationId}/members`;
const brandIds = () => org.brands.map((b) => b.tenantId);

async function addMember(
  payload: Record<string, unknown>,
  headers = ownerHeaders,
): Promise<{ status: number; body: MemberDto & ApiErrorBody }> {
  const res = await app.inject({ method: 'POST', url: members(), headers, payload });
  return { status: res.statusCode, body: res.json() };
}

async function signIn(
  email: string,
  tenantId?: string,
): Promise<{ status: number; body: TokenResponse & ApiErrorBody }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD, client: 'native', ...(tenantId ? { tenantId } : {}) },
  });
  return { status: res.statusCode, body: res.json() };
}

const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

const me = (accessToken: string) =>
  app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(accessToken) });

/** The account's users in the organization's brands, by tenant. */
async function usersOf(email: string) {
  const rows = await prisma.user.findMany({
    where: { account: { email }, tenantId: { in: brandIds() } },
    include: { roles: { include: { role: true } } },
  });
  return new Map(rows.map((u) => [u.tenantId, u]));
}

describe('members', () => {
  it('members get a linked user in every brand', async () => {
    const added = await addMember({
      email: 'finance@test.local',
      displayName: 'Finance Person',
      role: 'FINANCE',
      password: PASSWORD,
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      email: 'finance@test.local',
      displayName: 'Finance Person',
      role: 'FINANCE',
    });

    const users = await usersOf('finance@test.local');
    expect([...users.keys()].sort()).toEqual([...brandIds()].sort());
    for (const user of users.values()) {
      expect(user.organizationMemberId).toBe(added.body.id);
      expect(user.isActive).toBe(true);
      expect(user.displayName).toBe('Finance Person');
      expect(user.roles.map((r) => [r.role.name, r.locationId, r.grantedByOrganization])).toEqual([
        ['Finance', null, true],
      ]);
    }

    const session = await signIn('finance@test.local');
    expect(session.status).toBe(200);
    const profile = (await me(session.body.accessToken)).json<AuthUser>();
    expect(profile.tenants.map((t) => t.id).sort()).toEqual([...brandIds()].sort());
    expect(profile.organizations).toEqual([
      expect.objectContaining({ id: org.organizationId, role: 'FINANCE' }),
    ]);

    const list = await app.inject({ method: 'GET', url: members(), headers: ownerHeaders });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json<MemberDto[]>()
        .map((m) => [m.email, m.role])
        .sort(),
    ).toEqual([
      ['finance@test.local', 'FINANCE'],
      [org.owner.email, 'OWNER'],
    ]);
    // The same member twice is a conflict; a new account needs a starting password.
    expect(
      (await addMember({ email: 'finance@test.local', displayName: 'Again', role: 'MANAGER' }))
        .status,
    ).toBe(409);
    expect(
      (await addMember({ email: 'nobody@test.local', displayName: 'No Password', role: 'MANAGER' }))
        .body.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('a manager gets the brand Manager role, created where the brand has none', async () => {
    const added = await addMember({
      email: 'manager@test.local',
      displayName: 'Manager',
      role: 'MANAGER',
      password: PASSWORD,
    });
    expect(added.status).toBe(201);
    for (const user of (await usersOf('manager@test.local')).values()) {
      expect(user.roles.map((r) => r.role.name)).toEqual(['Manager']);
    }
    const changed = await app.inject({
      method: 'PATCH',
      url: `${members()}/${added.body.id}`,
      headers: ownerHeaders,
      payload: { role: 'FINANCE' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<MemberDto>().role).toBe('FINANCE');
    for (const user of (await usersOf('manager@test.local')).values()) {
      expect(user.roles.map((r) => r.role.name)).toEqual(['Finance']);
    }
  });

  it('adding a member by e-mail matches the existing account regardless of case', async () => {
    const cashier = org.brands[1]!.cashier;
    const added = await addMember({
      email: `  ${cashier.email.toUpperCase()} `,
      displayName: 'Brand B cashier',
      role: 'FINANCE',
      password: 'Another-Password-1',
    });
    expect(added.status).toBe(201);
    const accounts = await prisma.account.findMany({
      where: { email: { equals: cashier.email, mode: 'insensitive' } },
    });
    expect(accounts).toHaveLength(1);
    expect(added.body.accountId).toBe(accounts[0]!.id);
    expect(added.body.email).toBe(cashier.email);
    // The person keeps their own password.
    expect(await verifySecret(accounts[0]!.passwordHash, PASSWORD)).toBe(true);
    expect((await signIn(` ${cashier.email.toUpperCase()}`)).status).toBe(200);
  });

  it('an owner adds only people who already work in its brands; others answer as taken', async () => {
    const outsider = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    const shape = (b: ApiErrorBody) => ({ code: b.code, message: b.message, details: b.details });
    // Without a password, someone who works elsewhere answers like a new e-mail: no signal that
    // the e-mail has an account.
    const asNew = await addMember({
      email: 'nobody@test.local',
      displayName: 'X',
      role: 'MANAGER',
    });
    const asOutsider = await addMember({
      email: ` ${outsider.owner.email.toUpperCase()}`,
      displayName: 'X',
      role: 'MANAGER',
    });
    expect(asNew.status).toBe(400);
    expect(asOutsider.status).toBe(asNew.status);
    expect(shape(asOutsider.body)).toEqual(shape(asNew.body));
    // With one, like an e-mail already taken.
    const withPassword = await addMember({
      email: outsider.owner.email,
      displayName: 'X',
      role: 'MANAGER',
      password: 'An-owner-chosen-password',
    });
    expect(withPassword).toMatchObject({
      status: 409,
      body: { code: 'CONFLICT', details: { reason: 'EMAIL_TAKEN' } },
    });
    // Nothing changed.
    expect(
      await prisma.organizationMember.count({
        where: { account: { email: outsider.owner.email } },
      }),
    ).toBe(0);
    expect((await usersOf(outsider.owner.email)).size).toBe(0);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: outsider.owner.email },
    });
    expect(await verifySecret(account.passwordHash, PASSWORD)).toBe(true);
    expect(await prisma.account.count({ where: { email: 'nobody@test.local' } })).toBe(0);

    // A platform operator can add them; they keep their own password.
    const added = await service.addMember(
      org.organizationId,
      { email: outsider.owner.email, displayName: 'Outsider', role: 'MANAGER' },
      operator,
    );
    expect(added.accountId).toBe(account.id);
    expect((await usersOf(outsider.owner.email)).size).toBe(2);
    expect((await signIn(outsider.owner.email, org.brands[0]!.tenantId)).status).toBe(200);
  });

  it('the last owner cannot be removed or demoted', async () => {
    const demote = await app.inject({
      method: 'PATCH',
      url: `${members()}/${org.owner.memberId}`,
      headers: ownerHeaders,
      payload: { role: 'FINANCE' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json<ApiErrorBody>().code).toBe('ORGANIZATION_LAST_OWNER');
    const remove = await app.inject({
      method: 'DELETE',
      url: `${members()}/${org.owner.memberId}`,
      headers: ownerHeaders,
    });
    expect(remove.statusCode).toBe(409);
    expect(remove.json<ApiErrorBody>().code).toBe('ORGANIZATION_LAST_OWNER');

    // With a second owner, the first can step down.
    expect(
      (
        await addMember({
          email: 'second-owner@test.local',
          displayName: 'Second Owner',
          role: 'OWNER',
          password: PASSWORD,
        })
      ).status,
    ).toBe(201);
    const stepDown = await app.inject({
      method: 'PATCH',
      url: `${members()}/${org.owner.memberId}`,
      headers: ownerHeaders,
      payload: { role: 'MANAGER' },
    });
    expect(stepDown.statusCode).toBe(200);
    // An unknown member is not found.
    const unknown = await app.inject({
      method: 'DELETE',
      url: `${members()}/${newId()}`,
      headers: bearer(await login(app, 'second-owner@test.local')),
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('leaving the organization', () => {
  it('a removed member cannot switch or refresh', async () => {
    // A cashier of brand A (their own user) is added as FINANCE: kept in A, linked in B.
    const cashier = org.brands[0]!.cashier;
    const added = await addMember({
      email: cashier.email,
      displayName: 'Cashier',
      role: 'FINANCE',
    });
    expect(added.status).toBe(201);
    const inA = await signIn(cashier.email, org.brands[0]!.tenantId);
    const inB = await signIn(cashier.email, org.brands[1]!.tenantId);
    expect(inB.body.user.tenantId).toBe(org.brands[1]!.tenantId);

    const removed = await app.inject({
      method: 'DELETE',
      url: `${members()}/${added.body.id}`,
      headers: ownerHeaders,
    });
    expect(removed.statusCode).toBe(204);

    // At once: the session in B ends, and B can no longer be switched into.
    const refreshed = await refresh(inB.body.refreshToken!);
    expect(refreshed.statusCode).toBe(403);
    expect(refreshed.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
    expect((await me(inB.body.accessToken)).json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
    const switched = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch',
      headers: bearer(inA.body.accessToken),
      payload: { tenantId: org.brands[1]!.tenantId, refreshToken: inA.body.refreshToken },
    });
    expect(switched.statusCode).toBe(404);
    expect(switched.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
    const revoked = await prisma.refreshToken.count({
      where: { userId: inB.body.user.id, revokedAt: null },
    });
    expect(revoked).toBe(0);
    // The organization is gone from their profile.
    expect((await me(inA.body.accessToken)).json<AuthUser>().organizations).toEqual([]);
  });

  it('an existing brand user keeps their own role after leaving the organization', async () => {
    const [brandA, brandB] = org.brands as [(typeof org.brands)[0], (typeof org.brands)[0]];
    const added = await addMember({
      email: brandA.cashier.email,
      displayName: 'Cashier',
      role: 'FINANCE',
    });
    let users = await usersOf(brandA.cashier.email);
    const kept = users.get(brandA.tenantId)!;
    expect(kept.id).toBe(brandA.cashier.id);
    expect(kept.organizationMemberId).toBe(added.body.id);
    expect(kept.roles.map((r) => [r.role.name, r.grantedByOrganization]).sort()).toEqual([
      ['Cashier', false],
      ['Finance', true],
    ]);

    // Brand B's own owner joins as an OWNER: they already hold Owner there, so nothing is added.
    const ownerB = await addMember({ email: brandB.owner.email, displayName: 'B', role: 'OWNER' });
    const ownerBUser = (await usersOf(brandB.owner.email)).get(brandB.tenantId)!;
    expect(ownerBUser.roles.map((r) => [r.role.name, r.grantedByOrganization])).toEqual([
      ['Owner', false],
    ]);

    for (const memberId of [added.body.id, ownerB.body.id]) {
      const res = await app.inject({
        method: 'DELETE',
        url: `${members()}/${memberId}`,
        headers: ownerHeaders,
      });
      expect(res.statusCode).toBe(204);
    }

    users = await usersOf(brandA.cashier.email);
    const cashierA = users.get(brandA.tenantId)!;
    expect(cashierA.isActive).toBe(true);
    expect(cashierA.organizationMemberId).toBeNull();
    expect(cashierA.roles.map((r) => [r.role.name, r.locationId])).toEqual([
      ['Cashier', brandA.locationA],
    ]);
    expect(users.get(brandB.tenantId)?.isActive).toBe(false);
    expect(users.get(brandB.tenantId)?.roles).toEqual([]);

    const ownerBAfter = (await usersOf(brandB.owner.email)).get(brandB.tenantId)!;
    expect(ownerBAfter.isActive).toBe(true);
    expect(ownerBAfter.organizationMemberId).toBeNull();
    expect(ownerBAfter.roles.map((r) => r.role.name)).toEqual(['Owner']);
    expect((await usersOf(brandB.owner.email)).get(brandA.tenantId)?.isActive).toBe(false);

    const session = await signIn(brandA.cashier.email);
    expect(session.status).toBe(200);
    expect(session.body.user.tenantId).toBe(brandA.tenantId);
    expect(session.body.user.tenants.map((t) => t.id)).toEqual([brandA.tenantId]);
    expect(session.body.user.roles.map((r) => r.roleName)).toEqual(['Cashier']);
    expect((await signIn(brandB.owner.email)).body.user.tenantId).toBe(brandB.tenantId);
  });

  it('attaching a brand creates linked users; detaching deactivates them and revokes sessions', async () => {
    const finance = await addMember({
      email: 'finance@test.local',
      displayName: 'Finance',
      role: 'FINANCE',
      password: PASSWORD,
    });
    const brandC = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    await service.attachTenant(org.organizationId, brandC.tenantId, operator);
    // Idempotent.
    await service.attachTenant(org.organizationId, brandC.tenantId, operator);

    const linked = await prisma.user.findMany({
      where: { tenantId: brandC.tenantId, organizationMemberId: { not: null } },
      include: { roles: { include: { role: true } }, account: true },
    });
    expect(linked.map((u) => [u.account.email, u.roles.map((r) => r.role.name)]).sort()).toEqual([
      ['finance@test.local', ['Finance']],
      [org.owner.email, ['Owner']],
    ]);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: brandC.tenantId } })).organizationId,
    ).toBe(org.organizationId);

    const inC = await signIn('finance@test.local', brandC.tenantId);
    expect(inC.body.user.tenantId).toBe(brandC.tenantId);
    expect(inC.body.user.id).toBe(
      linked.find((u) => u.organizationMemberId === finance.body.id)?.id,
    );

    await service.detachTenant(org.organizationId, brandC.tenantId, operator);
    const after = await prisma.user.findMany({
      where: { id: { in: linked.map((u) => u.id) } },
      include: { roles: true },
    });
    for (const user of after) {
      expect(user.isActive).toBe(false);
      // The brand owns them again.
      expect(user.organizationMemberId).toBeNull();
      expect(user.roles).toEqual([]);
    }
    expect(
      await prisma.refreshToken.count({ where: { userId: inC.body.user.id, revokedAt: null } }),
    ).toBe(0);
    const refreshed = await refresh(inC.body.refreshToken!);
    expect(refreshed.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: brandC.tenantId } })).organizationId,
    ).toBeNull();
    // Brand C's own owner is untouched; the member's other brands stay.
    expect((await signIn(brandC.owner.email)).status).toBe(200);
    const financeNow = await signIn('finance@test.local');
    expect(financeNow.body.user.tenants.map((t) => t.id).sort()).toEqual([...brandIds()].sort());
    // Its admin can reactivate the former linked user; the organization's role is gone.
    const reactivated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${brandC.tenantId}/users/${inC.body.user.id}`,
      headers: bearer(await login(app, brandC.owner.email)),
      payload: { isActive: true },
    });
    expect(reactivated.statusCode).toBe(200);
    expect(
      reactivated.json<{ isActive: boolean; roles: unknown[]; managedByOrganization: boolean }>(),
    ).toMatchObject({ isActive: true, roles: [], managedByOrganization: false });
    // Detaching a brand that is not the organization's is not found.
    await expect(
      service.detachTenant(org.organizationId, brandC.tenantId, operator),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('linking never reactivates a user the brand deactivated', async () => {
    const [brandA, brandB] = org.brands as [(typeof org.brands)[0], (typeof org.brands)[0]];
    const ownerA = bearer(await login(app, brandA.owner.email));
    // Brand A's admin deactivates its cashier, who is then added to the organization as FINANCE.
    const off = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${brandA.tenantId}/users/${brandA.cashier.id}`,
      headers: ownerA,
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    const added = await addMember({
      email: brandA.cashier.email,
      displayName: 'Cashier',
      role: 'FINANCE',
    });
    expect(added.status).toBe(201);
    expect((added.body as unknown as LinkedMemberDto).skippedTenantIds).toEqual([brandA.tenantId]);

    let users = await usersOf(brandA.cashier.email);
    const inA = users.get(brandA.tenantId)!;
    expect(inA.isActive).toBe(false);
    expect(inA.organizationMemberId).toBeNull();
    expect(inA.roles.map((r) => r.role.name)).toEqual(['Cashier']);
    expect(users.get(brandB.tenantId)).toMatchObject({
      isActive: true,
      organizationMemberId: added.body.id,
    });
    const skipped = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.organization_link_skipped', tenantId: brandA.tenantId },
    });
    expect(skipped.entityId).toBe(inA.id);
    expect(skipped.metadata).toMatchObject({
      organizationId: org.organizationId,
      reason: 'USER_DEACTIVATED',
    });

    // They sign into B only; A is not theirs to use.
    const session = await signIn(brandA.cashier.email, brandA.tenantId);
    expect(session.status).toBe(200);
    expect(session.body.user.tenantId).toBe(brandB.tenantId);
    expect(session.body.user.tenants.map((t) => t.id)).toEqual([brandB.tenantId]);
    expect((await service.syncLinkedUsers(org.organizationId)).skipped).toEqual([
      { memberId: added.body.id, tenantId: brandA.tenantId },
    ]);

    // Once brand A reactivates the user, a sync links them.
    const on = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${brandA.tenantId}/users/${brandA.cashier.id}`,
      headers: ownerA,
      payload: { isActive: true },
    });
    expect(on.statusCode).toBe(200);
    expect((await service.syncLinkedUsers(org.organizationId)).skipped).toEqual([]);
    users = await usersOf(brandA.cashier.email);
    expect(users.get(brandA.tenantId)).toMatchObject({
      isActive: true,
      organizationMemberId: added.body.id,
    });
    expect(
      users
        .get(brandA.tenantId)!
        .roles.map((r) => r.role.name)
        .sort(),
    ).toEqual(['Cashier', 'Finance']);
  });

  it('a member removed and added again gets the users the organization deactivated back', async () => {
    const first = await addMember({
      email: 'finance@test.local',
      displayName: 'Finance',
      role: 'FINANCE',
      password: PASSWORD,
    });
    await app.inject({
      method: 'DELETE',
      url: `${members()}/${first.body.id}`,
      headers: ownerHeaders,
    });
    expect([...(await usersOf('finance@test.local')).values()].every((u) => !u.isActive)).toBe(
      true,
    );
    const again = await addMember({
      email: 'finance@test.local',
      displayName: 'Finance',
      role: 'MANAGER',
    });
    expect((again.body as unknown as LinkedMemberDto).skippedTenantIds).toEqual([]);
    for (const user of (await usersOf('finance@test.local')).values()) {
      expect(user).toMatchObject({ isActive: true, organizationMemberId: again.body.id });
      expect(user.roles.map((r) => r.role.name)).toEqual(['Manager']);
    }
  });

  it('syncing the linked users is idempotent and repairs them', async () => {
    await addMember({
      email: 'finance@test.local',
      displayName: 'Finance',
      role: 'FINANCE',
      password: PASSWORD,
    });
    const before = await prisma.userRole.count();
    await service.syncLinkedUsers(org.organizationId);
    await service.syncLinkedUsers(org.organizationId);
    expect(await prisma.userRole.count()).toBe(before);
    // A linked user deactivated behind the service's back is brought back.
    const user = (await usersOf('finance@test.local')).get(org.brands[1]!.tenantId)!;
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await service.syncLinkedUsers(org.organizationId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(true);
  });
});

describe('the organization guard', () => {
  it('organization routes are 404 for non-members and brand-only users, 403 for FINANCE on members', async () => {
    const outsider = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    const expectNotFound = async (headers: Record<string, string>, url = members()) => {
      const res = await app.inject({ method: 'GET', url, headers });
      expect(res.statusCode).toBe(404);
      expect(res.json<ApiErrorBody>().code).toBe('ORGANIZATION_NOT_FOUND');
    };
    await expectNotFound(bearer(await login(app, outsider.owner.email)));
    // A user of one of its brands who is not a member.
    await expectNotFound(bearer(await login(app, org.brands[0]!.cashier.email)));
    // Unknown and malformed organization ids.
    await expectNotFound(ownerHeaders, `/api/v1/organizations/${newId()}/members`);
    await expectNotFound(ownerHeaders, '/api/v1/organizations/not-an-id/members');

    await addMember({
      email: 'finance@test.local',
      displayName: 'Finance',
      role: 'FINANCE',
      password: PASSWORD,
    });
    const finance = bearer(await login(app, 'finance@test.local'));
    const forbidden = await app.inject({ method: 'GET', url: members(), headers: finance });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json<ApiErrorBody>().code).toBe('INSUFFICIENT_PERMISSION');
    const anonymous = await app.inject({ method: 'GET', url: members() });
    expect(anonymous.statusCode).toBe(401);
  });

  it("runs the handler in the organization's read-only scope", async () => {
    const scoped = app.get(PrismaService);
    let scope: TenantScope | undefined;
    let tenants: string[] = [];
    let write: unknown;
    const spy = vi.spyOn(service, 'listMembers').mockImplementation(async () => {
      scope = TenantContext.current();
      tenants = (await scoped.tenant.findMany({ select: { id: true } })).map((t) => t.id);
      write = await scoped.tenant
        .update({ where: { id: brandIds()[0]! }, data: { nameEn: 'Renamed' } })
        .catch((error: unknown) => error);
      return [];
    });
    try {
      await createTenant(prisma); // another business, outside the organization
      const res = await app.inject({ method: 'GET', url: members(), headers: ownerHeaders });
      expect(res.statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(scope).toEqual({
      kind: 'organization',
      organizationId: org.organizationId,
      tenantIds: brandIds(),
    });
    expect(tenants.sort()).toEqual([...brandIds()].sort());
    expect(write).toMatchObject({
      name: 'TenantScopeError',
      message: 'Organization scope is read-only',
    });
  });

  it('validates the member bodies', async () => {
    expect(
      (
        await addMember({
          email: 'x@test.local',
          displayName: 'X',
          role: 'ADMIN',
          password: PASSWORD,
        })
      ).status,
    ).toBe(400);
    const res = await app.inject({
      method: 'PATCH',
      url: `${members()}/${org.owner.memberId}`,
      headers: ownerHeaders,
      payload: { role: 'NOPE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('a suspended organization', () => {
  it("a suspended organization hides its pages and its members' linked brands", async () => {
    const [brandA, brandB] = org.brands as [(typeof org.brands)[0], (typeof org.brands)[0]];
    await addMember({
      email: 'finance@test.local',
      displayName: 'Finance',
      role: 'FINANCE',
      password: PASSWORD,
    });
    // A brand cashier who is also a member keeps their own role through a suspension.
    await addMember({ email: brandA.cashier.email, displayName: 'Cashier', role: 'MANAGER' });
    const finance = await signIn('finance@test.local');
    const ownerInA = await signIn(org.owner.email, brandA.tenantId);
    await prisma.organization.update({
      where: { id: org.organizationId },
      data: { status: 'SUSPENDED' },
    });

    const page = await app.inject({ method: 'GET', url: members(), headers: ownerHeaders });
    expect(page.statusCode).toBe(404);
    expect(page.json<ApiErrorBody>().code).toBe('ORGANIZATION_NOT_FOUND');

    // The owner's own user in A stays; their linked user in B is gone from the switcher.
    const profile = (await me(ownerInA.body.accessToken)).json<AuthUser>();
    expect(profile.tenants.map((t) => t.id)).toEqual([brandA.tenantId]);
    expect(profile.organizations).toEqual([]);
    const switched = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch',
      headers: bearer(ownerInA.body.accessToken),
      payload: { tenantId: brandB.tenantId, refreshToken: ownerInA.body.refreshToken },
    });
    expect(switched.statusCode).toBe(404);

    // A member with nothing but the organization's roles is disabled, like a deactivated user.
    expect((await me(finance.body.accessToken)).json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
    expect((await refresh(finance.body.refreshToken!)).json<ApiErrorBody>().code).toBe(
      'ACCOUNT_DISABLED',
    );
    expect((await signIn('finance@test.local')).body.code).toBe('ACCOUNT_DISABLED');

    const cashier = await signIn(brandA.cashier.email);
    expect(cashier.status).toBe(200);
    expect(cashier.body.user.roles.map((r) => r.roleName)).toEqual(['Cashier']);

    // Reactivated, everything is back.
    await prisma.organization.update({
      where: { id: org.organizationId },
      data: { status: 'ACTIVE' },
    });
    expect((await signIn('finance@test.local')).status).toBe(200);
  });
});

describe('currency', () => {
  it('a brand with another currency cannot be attached', async () => {
    const sar = await createTenant(prisma);
    await expect(
      service.attachTenant(org.organizationId, sar.tenantId, operator),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_CURRENCY_MISMATCH' });
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: sar.tenantId } })).organizationId,
    ).toBeNull();
    expect(await prisma.user.count({ where: { tenantId: sar.tenantId } })).toBe(2);

    // A brand in another organization is a conflict, an unknown one not found.
    const other = await createOrganization(app, prisma, { brands: 1 });
    await expect(
      service.attachTenant(org.organizationId, other.brands[0]!.tenantId, operator),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.attachTenant(org.organizationId, newId(), operator)).rejects.toMatchObject(
      { code: 'TENANT_NOT_FOUND' },
    );
  });

  it("a member brand's currency cannot change", async () => {
    // The currency is fixed for a tenant's lifetime (ADR 0002): no API takes it, so a member brand
    // can never drift from its organization's currency.
    const brandA = org.brands[0]!;
    const base = `/api/v1/tenants/${brandA.tenantId}`;
    const ownerA = bearer(await login(app, brandA.owner.email));
    const localization = await app.inject({
      method: 'PUT',
      url: `${base}/localization`,
      headers: ownerA,
      payload: {
        defaultLocale: 'en',
        supportedLocales: ['en', 'ar'],
        digits: null,
        currencySymbol: null,
        currencyDisplay: null,
        currencyFormatLocale: null,
        currencyCode: 'SAR',
      },
    });
    expect(localization.statusCode).toBe(400);
    const profile = await app.inject({
      method: 'PATCH',
      url: base,
      headers: ownerA,
      payload: { currencyCode: 'SAR' },
    });
    expect(profile.statusCode).toBe(400);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: brandA.tenantId } })).currencyCode,
    ).toBe('ILS');
  });
});
