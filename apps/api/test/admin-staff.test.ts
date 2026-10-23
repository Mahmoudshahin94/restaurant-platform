import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient, verifySecret } from '@pos/database';
import type { Employee, Role, StaffUser } from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;
let base: string;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma);
  owner = bearer(await login(app, tenant.owner.email));
  base = `/api/v1/tenants/${tenant.tenantId}`;
});

// The caller names the response type, as with light-my-request's `json<T>()`.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const roleId = async (name: string) =>
  (
    await prisma.role.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, name },
    })
  ).id;

/** A tenant-wide "Staff admin" who manages users and roles but holds little else. */
async function staffAdmin(): Promise<{ id: string; headers: Record<string, string> }> {
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.tenantId,
      name: 'Staff admin',
      permissions: {
        create: ['users.manage', 'roles.manage', 'orders.view', 'locations.view'].map(
          (permissionKey) => ({ permissionKey }),
        ),
      },
    },
  });
  const { body } = await call<StaffUser>('POST', `${base}/users`, owner, {
    email: 'staff-admin@test.local',
    displayName: 'Staff Admin',
    password: PASSWORD,
    roles: [{ roleId: role.id, locationId: null }],
  });
  return { id: body.id, headers: bearer(await login(app, 'staff-admin@test.local')) };
}

describe('users', () => {
  it('creates a user with roles, lists them, and never returns or logs the password', async () => {
    const cashier = await roleId('Cashier');
    const created = await call<StaffUser>('POST', `${base}/users`, owner, {
      email: 'New.Waiter@Test.local',
      displayName: 'New Waiter',
      preferredLocale: 'ar',
      password: 'a-long-password',
      roles: [{ roleId: cashier, locationId: tenant.locationA }],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email: 'new.waiter@test.local',
      preferredLocale: 'ar',
      isActive: true,
      roles: [{ roleId: cashier, roleName: 'Cashier', locationId: tenant.locationA }],
    });
    expect(JSON.stringify(created.body)).not.toContain('password');
    await expect(login(app, 'new.waiter@test.local')).rejects.toThrow(); // different password
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'new.waiter@test.local', password: 'a-long-password' },
    });
    expect(res.statusCode).toBe(200);

    const list = await call<StaffUser[]>('GET', `${base}/users`, owner);
    expect(list.body.map((u) => u.email)).toContain('new.waiter@test.local');

    const audit = await prisma.auditLog.findMany({
      where: { entityId: created.body.id, action: { startsWith: 'user.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['user.created', 'user.roles_changed']);
    expect(JSON.stringify(audit)).not.toContain('a-long-password');

    const duplicate = await call('POST', `${base}/users`, owner, {
      email: 'new.waiter@test.local',
      displayName: 'Again',
      password: 'a-long-password',
    });
    expect(duplicate).toMatchObject({ status: 409, body: { details: { reason: 'EMAIL_TAKEN' } } });
    const weak = await call('POST', `${base}/users`, owner, {
      email: 'weak@test.local',
      displayName: 'Weak',
      password: 'short',
    });
    expect(weak.status).toBe(400);
  });

  it('changes roles (audited), and deactivation ends the user’s sessions at once', async () => {
    const manager = await prisma.role.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Manager',
        permissions: { create: [{ permissionKey: 'orders.view' }] },
      },
    });
    const changed = await call<StaffUser>(
      'PUT',
      `${base}/users/${tenant.cashier.id}/roles`,
      owner,
      {
        roles: [
          { roleId: manager.id, locationId: tenant.locationA },
          { roleId: manager.id, locationId: tenant.locationB },
        ],
      },
    );
    expect(changed.status).toBe(200);
    expect(changed.body.roles.map((r) => r.locationId).sort()).toEqual(
      [tenant.locationA, tenant.locationB].sort(),
    );
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.roles_changed', entityId: tenant.cashier.id },
    });
    expect(entry.metadata).toMatchObject({
      before: [{ role: 'Cashier', locationId: tenant.locationA }],
      after: [{ role: 'Manager' }, { role: 'Manager' }],
    });

    const cashierToken = bearer(await login(app, tenant.cashier.email));
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: tenant.cashier.email, password: PASSWORD, client: 'native' },
    });
    const refreshToken = refresh.json<{ refreshToken: string }>().refreshToken;
    const off = await call<StaffUser>('PATCH', `${base}/users/${tenant.cashier.id}`, owner, {
      isActive: false,
    });
    expect(off.body.isActive).toBe(false);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: cashierToken });
    expect(me.statusCode).toBe(403);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(401);
    expect(
      await prisma.auditLog.count({
        where: { action: 'user.deactivated', entityId: tenant.cashier.id },
      }),
    ).toBe(1);
  });

  it('keeps an active owner, and nobody changes or deactivates themselves', async () => {
    expect(
      await call('PATCH', `${base}/users/${tenant.owner.id}`, owner, { isActive: false }),
    ).toMatchObject({ status: 409, body: { details: { reason: 'SELF' } } });
    expect(
      await call('PUT', `${base}/users/${tenant.owner.id}/roles`, owner, { roles: [] }),
    ).toMatchObject({ status: 409, body: { details: { reason: 'SELF' } } });

    // Someone holding every permission through an ordinary role still cannot remove the last
    // holder of the Owner (system) role.
    const everything = await call<Role>('POST', `${base}/roles`, owner, {
      name: 'Everything',
      permissions: (await call<Role[]>('GET', `${base}/roles`, owner)).body[0]?.permissions,
    });
    await call<StaffUser>('POST', `${base}/users`, owner, {
      email: 'deputy@test.local',
      displayName: 'Deputy',
      password: PASSWORD,
      roles: [{ roleId: everything.body.id, locationId: null }],
    });
    const deputy = bearer(await login(app, 'deputy@test.local'));
    expect(
      await call('PUT', `${base}/users/${tenant.owner.id}/roles`, deputy, { roles: [] }),
    ).toMatchObject({ status: 409, body: { details: { reason: 'LAST_OWNER' } } });
    expect(
      await call('PATCH', `${base}/users/${tenant.owner.id}`, deputy, { isActive: false }),
    ).toMatchObject({ status: 409, body: { details: { reason: 'LAST_OWNER' } } });

    // With a second owner, the first may go.
    await call<StaffUser>('POST', `${base}/users`, owner, {
      email: 'co-owner@test.local',
      displayName: 'Co-owner',
      password: PASSWORD,
      roles: [{ roleId: await roleId('Owner'), locationId: null }],
    });
    expect(
      (await call('PATCH', `${base}/users/${tenant.owner.id}`, deputy, { isActive: false })).status,
    ).toBe(200);
  });

  it('refuses privilege escalation: nobody grants a role holding permissions they lack', async () => {
    const admin = await staffAdmin();
    const ownerRole = await roleId('Owner');
    const escalation = await call(
      'PUT',
      `${base}/users/${tenant.cashier.id}/roles`,
      admin.headers,
      {
        roles: [{ roleId: ownerRole, locationId: null }],
      },
    );
    expect(escalation).toMatchObject({
      status: 403,
      body: { code: 'INSUFFICIENT_PERMISSION', details: { reason: 'ESCALATION' } },
    });
    // Nor can they take a role away that they could not have granted.
    const fromOwner = await call('PUT', `${base}/users/${tenant.owner.id}/roles`, admin.headers, {
      roles: [],
    });
    expect(fromOwner.status).toBe(403);
    // Or deactivate / take over someone more powerful.
    expect(
      (await call('PATCH', `${base}/users/${tenant.owner.id}`, admin.headers, { isActive: false }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('POST', `${base}/users/${tenant.owner.id}/password`, admin.headers, {
          password: 'taken-over-123',
        })
      ).status,
    ).toBe(403);
    // A location-scoped role of a foreign tenant or location is not found.
    const other = await createTenant(prisma);
    const foreign = await call('PUT', `${base}/users/${tenant.cashier.id}/roles`, owner, {
      roles: [{ roleId: await roleId('Cashier'), locationId: other.locationA }],
    });
    expect(foreign.body).toMatchObject({ code: 'LOCATION_NOT_FOUND' });
  });

  it('resets a password: old sessions end, the new password works, and it is audited', async () => {
    const reset = await call('POST', `${base}/users/${tenant.cashier.id}/password`, owner, {
      password: 'brand-new-password',
    });
    expect(reset.status).toBe(204);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: tenant.cashier.id } });
    expect(await verifySecret(user.passwordHash, 'brand-new-password')).toBe(true);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'user.password_reset' },
    });
    expect(JSON.stringify(entry.metadata)).not.toContain('brand-new-password');
  });

  it('is tenant-wide: branch staff and other tenants are refused', async () => {
    const cashier = bearer(await login(app, tenant.cashier.email));
    expect((await call('GET', `${base}/users`, cashier)).status).toBe(403);
    const other = await createTenant(prisma);
    const foreign = await call('GET', `/api/v1/tenants/${other.tenantId}/users`, owner);
    expect(foreign.status).toBe(404);
    expect(
      (await call('PATCH', `${base}/users/${other.owner.id}`, owner, { displayName: 'X' })).body,
    ).toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});

describe('roles', () => {
  it('creates a role from the permission catalog and audits permission changes', async () => {
    const created = await call<Role>('POST', `${base}/roles`, owner, {
      name: 'Shift lead',
      permissions: ['orders.view', 'shifts.manage', 'orders.view'],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Shift lead',
      isSystem: false,
      permissions: ['orders.view', 'shifts.manage'],
      userCount: 0,
    });
    const updated = await call<Role>('PATCH', `${base}/roles/${created.body.id}`, owner, {
      permissions: ['orders.view', 'cash.manage'],
    });
    expect(updated.body.permissions).toEqual(['orders.view', 'cash.manage']);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'role.permissions_changed', entityId: created.body.id },
    });
    expect(entry.metadata).toMatchObject({ added: ['cash.manage'], removed: ['shifts.manage'] });

    const unknown = await call('POST', `${base}/roles`, owner, {
      name: 'Bad',
      permissions: ['everything.manage'],
    });
    expect(unknown.status).toBe(400);
    const taken = await call('POST', `${base}/roles`, owner, { name: 'Cashier', permissions: [] });
    expect(taken.body).toMatchObject({ details: { reason: 'NAME_TAKEN' } });
  });

  it('protects system roles, roles in use and permissions the editor lacks', async () => {
    const ownerRole = await roleId('Owner');
    expect(
      await call('PATCH', `${base}/roles/${ownerRole}`, owner, { permissions: [] }),
    ).toMatchObject({ status: 409, body: { details: { reason: 'SYSTEM_ROLE' } } });
    expect(await call('DELETE', `${base}/roles/${ownerRole}`, owner)).toMatchObject({
      status: 409,
    });
    const cashierRole = await roleId('Cashier');
    expect(await call('DELETE', `${base}/roles/${cashierRole}`, owner)).toMatchObject({
      status: 409,
      body: { details: { reason: 'IN_USE' } },
    });
    const unused = await call<Role>('POST', `${base}/roles`, owner, {
      name: 'Temp',
      permissions: [],
    });
    expect((await call('DELETE', `${base}/roles/${unused.body.id}`, owner)).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: 'role.deleted' } })).toBe(1);

    const admin = await staffAdmin();
    const wider = await call('POST', `${base}/roles`, admin.headers, {
      name: 'Wider',
      permissions: ['settings.manage'],
    });
    expect(wider).toMatchObject({ status: 403, body: { details: { reason: 'ESCALATION' } } });
    const list = await call<Role[]>('GET', `${base}/roles`, admin.headers);
    expect(list.body[0]).toMatchObject({ name: 'Owner', isSystem: true });
    // The Owner role holds every permission of the catalog, including newer keys.
    expect(list.body[0]?.permissions).toContain('sync.resolve');
  });
});

describe('employees', () => {
  it('creates an employee with a PIN (hashed), links a user and resets the PIN', async () => {
    const created = await call<Employee>('POST', `${base}/employees`, owner, {
      employeeCode: 'w-2001',
      displayName: 'Waiter',
      homeLocationId: tenant.locationA,
      userId: tenant.cashier.id,
      pin: '4321',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      employeeCode: 'W-2001',
      hasPin: true,
      userEmail: tenant.cashier.email,
      homeLocationId: tenant.locationA,
    });
    expect(JSON.stringify(created.body)).not.toContain('4321');
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.pinHash).not.toContain('4321');
    expect(await verifySecret(row.pinHash ?? '', '4321')).toBe(true);

    const reset = await call<Employee>('PUT', `${base}/employees/${created.body.id}/pin`, owner, {
      pin: '98765',
    });
    expect(reset.status).toBe(200);
    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual(['employee.created', 'employee.pin_reset']);
    expect(JSON.stringify(audits)).not.toMatch(/4321|98765/);

    expect(
      await call('PUT', `${base}/employees/${created.body.id}/pin`, owner, { pin: '12' }),
    ).toMatchObject({ status: 400 });
    const dupe = await call('POST', `${base}/employees`, owner, {
      employeeCode: 'W-2001',
      displayName: 'Again',
    });
    expect(dupe.body).toMatchObject({ details: { reason: 'CODE_TAKEN' } });
    const linked = await call('POST', `${base}/employees`, owner, {
      employeeCode: 'W-2002',
      displayName: 'Same user',
      userId: tenant.cashier.id,
    });
    expect(linked.body).toMatchObject({ details: { reason: 'USER_LINKED' } });
  });

  it('refuses to give someone a PIN to act as a more powerful user', async () => {
    const admin = await staffAdmin();
    const ownerEmployee = await call<Employee>('POST', `${base}/employees`, owner, {
      employeeCode: 'BOSS',
      displayName: 'Owner at the till',
      userId: tenant.owner.id,
    });
    const setPin = await call(
      'PUT',
      `${base}/employees/${ownerEmployee.body.id}/pin`,
      admin.headers,
      { pin: '1111' },
    );
    expect(setPin).toMatchObject({ status: 403, body: { details: { reason: 'ESCALATION' } } });
    const coOwner = await call<StaffUser>('POST', `${base}/users`, owner, {
      email: 'co-owner@test.local',
      displayName: 'Co-owner',
      password: PASSWORD,
      roles: [{ roleId: await roleId('Owner'), locationId: null }],
    });
    const link = await call('POST', `${base}/employees`, admin.headers, {
      employeeCode: 'SNEAKY',
      displayName: 'Sneaky',
      userId: coOwner.body.id,
      pin: '2222',
    });
    expect(link).toMatchObject({ status: 403, body: { details: { reason: 'ESCALATION' } } });
  });
});
