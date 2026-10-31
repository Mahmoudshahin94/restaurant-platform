import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient, hashSecret } from '@pos/database';
import { newId } from '@pos/domain';
import { type RouteEntry, listRoutes } from '@pos/server';
import type { ApiErrorBody, PlatformRole } from '@pos/shared-types';
import type {
  AuditLogEntry,
  Order,
  Paginated,
  PairedDevice,
  PlatformAuditEntry,
  PlatformModule,
  PlatformOrganizationAttached,
  PlatformOrganizationDetail,
  PlatformOrganizationSummary,
  PlatformTenantSummary,
  PlatformTenantDetail,
  PlatformTokenResponse,
  ProvisionedTenantDto,
  SupportExecution,
  SupportPreview,
  TenantHealth,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationService } from '../src/modules/organizations/organization.service';
import { PlatformErrorEventsService } from '../src/modules/platform/health/platform-error-events.service';
import {
  ORIGIN,
  PASSWORD,
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';

/**
 * The platform admin (ADR 0025): a separate identity whose tokens open the platform's routes and
 * nothing else; roles; provisioning; suspension; the support tools' preview → confirm → execute.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let routes: RouteEntry[];

const PLATFORM_PASSWORD = 'Platform-Password-1';
const P = '/api/v1/platform';
const key = (r: RouteEntry) => `${r.method} ${r.path}`;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  routes = listRoutes(app);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let counter = 0;
async function platformUser(role: PlatformRole): Promise<{ id: string; email: string }> {
  counter += 1;
  const user = await prisma.platformUser.create({
    data: {
      email: `${role.toLowerCase()}-${Date.now().toString(36)}${counter}@madar.test`,
      displayName: `Platform ${role}`,
      role,
      passwordHash: await hashSecret(PLATFORM_PASSWORD),
    },
  });
  return { id: user.id, email: user.email };
}

function platformLogin(email: string, password = PLATFORM_PASSWORD) {
  return app.inject({ method: 'POST', url: `${P}/auth/login`, payload: { email, password } });
}

async function tokenOf(role: PlatformRole): Promise<Record<string, string>> {
  const user = await platformUser(role);
  const res = await platformLogin(user.email);
  expect(res.statusCode, res.body).toBe(200);
  return bearer(res.json<PlatformTokenResponse>().accessToken);
}

/** A concrete URL for a route: the given tenant, a fresh id for every other parameter. */
function urlOf(route: RouteEntry, tenantId: string): string {
  const path = route.path.replace(/:(\w+)/g, (_m, name: string) =>
    name === 'tenantId' ? tenantId : newId(),
  );
  return ['/health', '/ready', '/internal/domains/check'].includes(path) ? path : `/api/v1${path}`;
}
const methodOf = (route: RouteEntry) => route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('a separate identity (ADR 0025)', () => {
  let tenant: TenantFixture;
  let staff: Record<string, string>;
  let operator: Record<string, string>;

  beforeAll(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
    staff = bearer(await login(app, tenant.owner.email));
    operator = await tokenOf('OWNER');
  });

  it('lists every platform route as `platform`, behind PlatformGuard, except sign-in', () => {
    const platform = routes.filter((r) => r.path.startsWith('/platform'));
    expect(platform.length).toBeGreaterThan(20);
    const open = platform.filter((r) => r.access !== 'platform').map(key);
    expect(open.sort()).toEqual([
      'POST /platform/auth/login',
      'POST /platform/auth/logout',
      'POST /platform/auth/refresh',
    ]);
    for (const route of platform.filter((r) => r.access === 'platform')) {
      expect(route.guards, key(route)).toContain('PlatformGuard');
      expect(route.permissions, key(route)).toEqual([]);
    }
    expect(
      routes.filter((r) => r.access === 'platform' && !r.path.startsWith('/platform')),
    ).toEqual([]);
  });

  it('refuses anonymous callers and tenant tokens on every platform route', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'platform')) {
      for (const headers of [{}, staff]) {
        const res = await app.inject({
          method: methodOf(route),
          url: urlOf(route, tenant.tenantId),
          headers,
        });
        if (res.statusCode !== 401) failures.push(`${key(route)} → ${String(res.statusCode)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('refuses platform tokens on every tenant, hub and device route', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) =>
      ['permissions', 'guarded', 'device'].includes(r.access),
    )) {
      const res = await app.inject({
        method: methodOf(route),
        url: urlOf(route, tenant.tenantId).replace(
          /locations\/[^/]+/,
          `locations/${tenant.locationA}`,
        ),
        headers: operator,
      });
      if (res.statusCode !== 401) failures.push(`${key(route)} → ${String(res.statusCode)}`);
    }
    expect(failures).toEqual([]);
  });

  it('keeps the two sign-ins apart', async () => {
    const op = await platformUser('OPERATOR');
    const asStaff = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: op.email, password: PLATFORM_PASSWORD },
    });
    expect(asStaff.json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
    const asPlatform = await platformLogin(tenant.owner.email, PASSWORD);
    expect(asPlatform.json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
  });

  it('signs in with a refresh cookie scoped to the platform, rotating it on refresh', async () => {
    const op = await platformUser('VIEWER');
    const res = await platformLogin(op.email);
    expect(res.statusCode).toBe(200);
    const body = res.json<PlatformTokenResponse>();
    expect(body.user).toMatchObject({ email: op.email, role: 'VIEWER' });
    expect(body.user.permissions).not.toContain('support.repair');
    const cookie = res.cookies.find((c) => c.name === 'madar_prt')!;
    expect(cookie).toMatchObject({
      path: '/api/v1/platform/auth',
      httpOnly: true,
      sameSite: 'Strict',
    });
    expect(res.cookies.find((c) => c.name === 'pos_rt')).toBeUndefined();

    const refreshed = await app.inject({
      method: 'POST',
      url: `${P}/auth/refresh`,
      headers: { origin: ORIGIN },
      cookies: { madar_prt: cookie.value },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    // The staff refresh does not know the platform's token.
    const staffRefresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { origin: ORIGIN },
      cookies: { pos_rt: cookie.value },
    });
    expect(staffRefresh.statusCode).toBe(401);
    // A rotated token presented again revokes the session.
    const reused = await app.inject({
      method: 'POST',
      url: `${P}/auth/refresh`,
      headers: { origin: ORIGIN },
      cookies: { madar_prt: cookie.value },
    });
    expect(reused.statusCode).toBe(401);
  });

  it('locks an account after five wrong passwords and audits every attempt', async () => {
    const op = await platformUser('SUPPORT');
    for (let i = 0; i < 5; i += 1) {
      expect((await platformLogin(op.email, 'wrong-password')).statusCode).toBe(401);
    }
    const locked = await platformLogin(op.email);
    expect(locked.statusCode).toBe(429);
    expect(locked.json<ApiErrorBody>().code).toBe('RATE_LIMITED');
    const entries = await prisma.platformAuditLog.findMany({ where: { entityId: op.id } });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'platform_auth.locked',
      ...Array<string>(4).fill('platform_auth.login_failed'),
    ]);
    expect(JSON.stringify(entries)).not.toContain('wrong-password');
  });

  it('refuses a deactivated operator at once', async () => {
    const op = await platformUser('VIEWER');
    const token = bearer((await platformLogin(op.email)).json<PlatformTokenResponse>().accessToken);
    await prisma.platformUser.update({ where: { id: op.id }, data: { isActive: false } });
    const res = await app.inject({ method: 'GET', url: `${P}/tenants`, headers: token });
    expect(res.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
  });
});

describe('roles', () => {
  let tenant: TenantFixture;

  beforeAll(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
  });

  it('lets support find but not repair, and the viewer only read', async () => {
    const support = await tokenOf('SUPPORT');
    const viewer = await tokenOf('VIEWER');
    const find = `${P}/tenants/${tenant.tenantId}/support/find?kind=ORDER&q=A`;
    const preview = {
      method: 'POST' as const,
      url: `${P}/tenants/${tenant.tenantId}/support/preview`,
      payload: { operation: 'order.correct_status', params: { orderId: newId(), to: 'CANCELLED' } },
    };
    expect((await app.inject({ method: 'GET', url: find, headers: support })).statusCode).toBe(200);
    const supportPreview = await app.inject({ ...preview, headers: support });
    expect(supportPreview.statusCode).toBe(403);
    expect(supportPreview.json<ApiErrorBody>().details.missing).toEqual(['support.repair']);

    for (const url of [`${P}/tenants`, `${P}/tenants/${tenant.tenantId}`, `${P}/health`]) {
      expect((await app.inject({ method: 'GET', url, headers: viewer })).statusCode, url).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: find, headers: viewer })).statusCode).toBe(403);
    expect((await app.inject({ ...preview, headers: viewer })).statusCode).toBe(403);
    const status = await app.inject({
      method: 'POST',
      url: `${P}/tenants/${tenant.tenantId}/status`,
      headers: viewer,
      payload: { status: 'SUSPENDED', reason: 'Testing roles' },
    });
    expect(status.statusCode).toBe(403);
    const provision = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: support,
      payload: {},
    });
    expect(provision.statusCode).toBe(403);
  });

  it('answers 404 for an unknown tenant', async () => {
    const viewer = await tokenOf('VIEWER');
    const res = await app.inject({
      method: 'GET',
      url: `${P}/tenants/${newId()}`,
      headers: viewer,
    });
    expect(res.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
  });
});

describe('provisioning', () => {
  let operator: Record<string, string>;
  const slug = () => `cafe-${Date.now().toString(36)}${(counter += 1)}`;
  const request = (s: string, ownerEmail = `${s}@owner.test`) => ({
    tenant: {
      slug: s,
      nameEn: 'Ramallah Roasters',
      nameAr: 'محمصة رام الله',
      businessType: 'COFFEE_SHOP',
      defaultLocale: 'ar',
      timezone: 'Asia/Hebron',
    },
    location: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
    owner: { email: ownerEmail, displayName: 'Owner' },
  });

  beforeAll(async () => {
    await resetDatabase(prisma);
    operator = await tokenOf('OPERATOR');
  });

  it('creates the tenant, its owner, entitlements and subdomain; the owner signs in', async () => {
    const s = slug();
    const res = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: operator,
      payload: request(s),
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<ProvisionedTenantDto>();
    expect(created.tenant.tenant).toMatchObject({
      slug: s,
      businessType: 'COFFEE_SHOP',
      currencyCode: 'ILS',
      status: 'ACTIVE',
    });
    expect(created.tenant.primaryDomain).toBe(`${s}.localhost`);
    expect(created.tenant.owners.map((o) => o.email)).toEqual([`${s}@owner.test`]);
    expect(created.owner!.temporaryPassword).toMatch(/^[\w-]{16}$/);

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${s}@owner.test`, password: created.owner!.temporaryPassword },
    });
    expect(ownerLogin.statusCode).toBe(200);

    // The business type's modules are entitled, the others not (for this plan).
    const modules = (
      await app.inject({
        method: 'GET',
        url: `${P}/tenants/${created.tenant.tenant.id}/modules`,
        headers: operator,
      })
    ).json<PlatformModule[]>();
    const mod = (f: string) => modules.find((m) => m.feature === f)!;
    expect(mod('KDS')).toMatchObject({ entitled: true, explicit: true, enabled: true });
    expect(mod('TABLES')).toMatchObject({ entitled: false, enabled: false });

    // Both audit logs record it; the password is in neither.
    const tenantAudit = await prisma.auditLog.findMany({
      where: { tenantId: created.tenant.tenant.id },
    });
    expect(tenantAudit.find((e) => e.action === 'tenant.provisioned')?.actorType).toBe('PLATFORM');
    const platformAudit = await prisma.platformAuditLog.findMany({
      where: { subjectTenantId: created.tenant.tenant.id },
    });
    expect(platformAudit.map((e) => e.action)).toContain('tenant.provisioned');
    expect(JSON.stringify([tenantAudit, platformAudit])).not.toContain(
      created.owner!.temporaryPassword,
    );
  });

  it('lists only Owner-role holders as owners, not the Finance system role', async () => {
    const s = slug();
    const res = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: operator,
      payload: request(s),
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id: tenantId } = res.json<ProvisionedTenantDto>().tenant.tenant;
    const finance = await prisma.role.findFirstOrThrow({ where: { tenantId, name: 'Finance' } });
    expect(finance.isSystem).toBe(true);
    const email = `${s}@finance.test`;
    const account = await prisma.account.create({
      data: { email, passwordHash: 'x', lastTenantId: tenantId },
    });
    await prisma.user.create({
      data: {
        tenantId,
        accountId: account.id,
        email,
        displayName: 'Finance',
        roles: { create: { roleId: finance.id, locationId: null } },
      },
    });
    const detail = await app.inject({
      method: 'GET',
      url: `${P}/tenants/${tenantId}`,
      headers: operator,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json<PlatformTenantDetail>().owners.map((o) => o.email)).toEqual([
      `${s}@owner.test`,
    ]);
    expect(detail.json<PlatformTenantDetail>().counts.users).toBe(2);
  });

  it('refuses a slug or an owner e-mail already in use', async () => {
    const s = slug();
    const first = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: operator,
      payload: request(s),
    });
    expect(first.statusCode).toBe(201);
    const again = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: operator,
      payload: request(s, 'other@owner.test'),
    });
    expect(again.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'SLUG_TAKEN' },
    });
    const email = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: operator,
      payload: request(slug(), `${s}@owner.test`),
    });
    expect(email.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'EMAIL_TAKEN' },
    });
  });

  it('honours entitlements chosen by the operator', async () => {
    const s = slug();
    const res = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: operator,
      payload: {
        ...request(s),
        entitlements: { TABLES: { entitled: true, tenantConfigurable: false } },
      },
    });
    const tenantId = res.json<ProvisionedTenantDto>().tenant.tenant.id;
    const row = await prisma.tenantEntitlement.findUnique({
      where: { tenantId_feature: { tenantId, feature: 'TABLES' } },
    });
    expect(row).toMatchObject({ entitled: true, tenantConfigurable: false });
  });
});

describe('suspension and archiving', () => {
  let tenant: TenantFixture;
  let operator: Record<string, string>;
  let hub: Record<string, string>;

  const setStatus = (status: string) =>
    app.inject({
      method: 'POST',
      url: `${P}/tenants/${tenant.tenantId}/status`,
      headers: operator,
      payload: { status, reason: 'Unpaid invoices' },
    });

  beforeAll(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
    operator = await tokenOf('OPERATOR');
    const owner = bearer(await login(app, tenant.owner.email));
    const paired = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/devices`,
      headers: owner,
      payload: { name: 'Main hub', type: 'GATEWAY' },
    });
    hub = { authorization: `Device ${paired.json<PairedDevice>().credential}` };
  });

  it('locks a suspended tenant out: staff, sign-in, refresh, hub sync and website', async () => {
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: tenant.owner.email, password: PASSWORD },
    });
    const staff = bearer(signedIn.json<{ accessToken: string }>().accessToken);
    const refreshCookie = signedIn.cookies.find((c) => c.name === 'pos_rt')!.value;

    expect((await setStatus('SUSPENDED')).json<PlatformTenantDetail>().tenant.status).toBe(
      'SUSPENDED',
    );
    const refused = (res: { statusCode: number; body: string }) => {
      expect(res.statusCode).toBe(403);
      expect((JSON.parse(res.body) as ApiErrorBody).code).toBe('TENANT_SUSPENDED');
    };
    refused(
      await app.inject({
        method: 'GET',
        url: `/api/v1/locations/${tenant.locationA}/orders`,
        headers: staff,
      }),
    );
    refused(
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: tenant.owner.email, password: PASSWORD },
      }),
    );
    refused(
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { origin: ORIGIN },
        cookies: { pos_rt: refreshCookie },
      }),
    );
    refused(await app.inject({ method: 'GET', url: '/api/v1/sync/pull?wait=0', headers: hub }));
    refused(
      await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: hub,
        payload: { operations: [], outbox: { pending: 0, failed: 0 } },
      }),
    );
    refused(
      await app.inject({
        method: 'GET',
        url: '/api/v1/public/site',
        headers: { host: tenant.host },
      }),
    );

    // The platform still reaches it, and reactivating lets everybody back in.
    const detail = await app.inject({
      method: 'GET',
      url: `${P}/tenants/${tenant.tenantId}`,
      headers: operator,
    });
    expect(detail.statusCode).toBe(200);
    await setStatus('ACTIVE');
    const back = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: staff,
    });
    expect(back.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/sync/pull?wait=0', headers: hub }))
        .statusCode,
    ).toBe(200);

    const entries = await prisma.auditLog.findMany({
      where: { tenantId: tenant.tenantId, action: 'tenant.status_changed' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.metadata)).toEqual([
      { from: 'ACTIVE', to: 'SUSPENDED', reason: 'Unpaid invoices' },
      { from: 'SUSPENDED', to: 'ACTIVE', reason: 'Unpaid invoices' },
    ]);
    expect(entries.every((e) => e.actorType === 'PLATFORM' && e.source === 'PLATFORM')).toBe(true);
  });

  it('keeps an archived tenant readable but unchangeable', async () => {
    const staff = bearer(await login(app, tenant.owner.email));
    await setStatus('ARCHIVED');
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: staff,
    });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${tenant.tenantId}`,
      headers: staff,
      payload: { nameEn: 'Renamed' },
    });
    expect(write.json<ApiErrorBody>().code).toBe('TENANT_ARCHIVED');
    const push = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: hub,
      payload: { operations: [], outbox: { pending: 0, failed: 0 } },
    });
    expect(push.json<ApiErrorBody>().code).toBe('TENANT_ARCHIVED');
    // An archived tenant cannot be suspended, only restored.
    expect((await setStatus('SUSPENDED')).json<ApiErrorBody>().details.reason).toBe(
      'STATUS_TRANSITION',
    );
    expect((await setStatus('ACTIVE')).statusCode).toBe(200);
  });
});

describe('support tools', () => {
  let tenant: TenantFixture;
  let menu: Awaited<ReturnType<typeof createMenuFixture>>;
  let staff: Record<string, string>;
  let operator: Record<string, string>;
  let operatorId: string;
  const support = (path: string) => `${P}/tenants/${tenant.tenantId}/support/${path}`;

  beforeEach(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
    menu = await createMenuFixture(prisma, tenant);
    staff = bearer(await login(app, tenant.owner.email));
    const op = await platformUser('OPERATOR');
    operatorId = op.id;
    operator = bearer((await platformLogin(op.email)).json<PlatformTokenResponse>().accessToken);
  });

  async function placedOrder(): Promise<Order> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: staff,
      payload: { id: newId(), channel: 'TAKEAWAY', items: [menu.burgerLine()] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Order>();
  }

  const preview = (payload: object, headers = operator) =>
    app.inject({ method: 'POST', url: support('preview'), headers, payload });
  const execute = (payload: object, headers = operator) =>
    app.inject({ method: 'POST', url: support('execute'), headers, payload });

  it('finds an order by its number', async () => {
    const order = await placedOrder();
    const res = await app.inject({
      method: 'GET',
      url: `${support('find')}?kind=ORDER&q=${encodeURIComponent(order.orderNumber)}`,
      headers: operator,
    });
    expect(res.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([order.id]);
  });

  it('corrects an order status as SYSTEM after a preview, with before and after audited', async () => {
    const order = await placedOrder();
    const request = {
      operation: 'order.correct_status',
      params: { orderId: order.id, to: 'CANCELLED' },
    };
    const shown = (await preview(request)).json<SupportPreview>();
    expect(shown).toMatchObject({
      executable: true,
      entity: { type: 'Order', id: order.id, label: order.orderNumber },
    });
    expect(shown.changes).toContainEqual({ field: 'status', before: 'PLACED', after: 'CANCELLED' });
    const token = shown.confirmation!.token;

    // No reason, or no confirmation: refused.
    expect((await execute({ ...request, confirmationToken: token })).statusCode).toBe(400);
    expect((await execute({ ...request, reason: 'Stuck order' })).statusCode).toBe(400);
    // A tampered or borrowed confirmation: refused.
    const tampered = await execute({
      ...request,
      confirmationToken: `${token}x`,
      reason: 'Stuck order',
    });
    expect(tampered.json<ApiErrorBody>().code).toBe('SUPPORT_CONFIRMATION_INVALID');
    const other = await tokenOf('OPERATOR');
    const borrowed = await execute(
      { ...request, confirmationToken: token, reason: 'Stuck order' },
      other,
    );
    expect(borrowed.json<ApiErrorBody>()).toMatchObject({
      code: 'SUPPORT_CONFIRMATION_INVALID',
      details: { reason: 'MISMATCH' },
    });

    const done = await execute({
      ...request,
      confirmationToken: token,
      reason: 'Stuck after a crash',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<SupportExecution>().after).toMatchObject({ status: 'CANCELLED', version: 2 });

    const history = await prisma.orderStatusHistory.findFirst({
      where: { orderId: order.id, toStatus: 'CANCELLED' },
    });
    expect(history).toMatchObject({
      actorType: 'PLATFORM',
      actorId: operatorId,
      source: 'PLATFORM',
    });
    const tenantEntry = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: 'support.repair_executed' },
    });
    expect(tenantEntry).toMatchObject({
      actorType: 'PLATFORM',
      actorId: operatorId,
      entityId: order.id,
    });
    expect(tenantEntry!.metadata).toMatchObject({
      reason: 'Stuck after a crash',
      before: { status: 'PLACED' },
      after: { status: 'CANCELLED' },
    });
    const platformEntry = await prisma.platformAuditLog.findFirst({
      where: { action: 'support.order.correct_status' },
    });
    expect(platformEntry).toMatchObject({ actorId: operatorId, subjectTenantId: tenant.tenantId });
    expect(platformEntry!.metadata).toMatchObject({
      before: { status: 'PLACED' },
      after: { status: 'CANCELLED' },
    });

    // The tenant's audit log, read by the platform, names the operator.
    const log = (
      await app.inject({
        method: 'GET',
        url: `${P}/tenants/${tenant.tenantId}/audit-logs?action=support.`,
        headers: operator,
      })
    ).json<Paginated<AuditLogEntry>>();
    expect(log.items[0]).toMatchObject({ actorType: 'PLATFORM', actorName: 'Platform OPERATOR' });
  });

  it('refuses a stale preview: the record changed since', async () => {
    const order = await placedOrder();
    const request = {
      operation: 'order.correct_status',
      params: { orderId: order.id, to: 'CANCELLED' },
    };
    const token = (await preview(request)).json<SupportPreview>().confirmation!.token;
    await prisma.order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
    const res = await execute({ ...request, confirmationToken: token, reason: 'Stuck order' });
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'SUPPORT_PREVIEW_STALE',
      details: { reason: 'CHANGED' },
    });
  });

  it('keeps the money guards: no cancelling a paid order, no non-system transition', async () => {
    const order = await placedOrder();
    // An online card payment, captured by the cloud (no drawer).
    const online = await prisma.paymentMethod.create({
      data: { tenantId: tenant.tenantId, type: 'ONLINE', nameEn: 'Card', nameAr: 'بطاقة' },
    });
    await prisma.payment.create({
      data: {
        id: newId(),
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        orderId: order.id,
        paymentMethodId: online.id,
        methodType: 'ONLINE',
        methodNameEn: 'Card',
        methodNameAr: 'بطاقة',
        provider: 'mock-online',
        type: 'CHARGE',
        status: 'CAPTURED',
        amount: order.total,
      },
    });
    const cancel = (
      await preview({
        operation: 'order.correct_status',
        params: { orderId: order.id, to: 'CANCELLED' },
      })
    ).json<SupportPreview>();
    expect(cancel).toMatchObject({
      executable: false,
      blockedReason: 'REFUND_FIRST',
      confirmation: null,
    });
    const staffOnly = (
      await preview({
        operation: 'order.correct_status',
        params: { orderId: order.id, to: 'COMPLETED' },
      })
    ).json<SupportPreview>();
    expect(staffOnly).toMatchObject({ executable: false, blockedReason: 'NOT_ALLOWED' });
  });

  it('reports a finalized order’s totals and never changes them; fixes an open order’s', async () => {
    const order = await placedOrder();
    await prisma.order.update({ where: { id: order.id }, data: { total: order.total + 500 } });
    const request = { operation: 'order.recalculate_totals', params: { orderId: order.id } };
    const open = (await preview(request)).json<SupportPreview>();
    expect(open.executable).toBe(true);
    expect((open.after.totals as { total: number }).total).toBe(order.total);
    const fixed = await execute({
      ...request,
      confirmationToken: open.confirmation!.token,
      reason: 'Header out of sync',
    });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).total).toBe(
      order.total,
    );

    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', total: order.total + 700 },
    });
    const finalized = (await preview(request)).json<SupportPreview>();
    expect(finalized).toMatchObject({
      executable: false,
      blockedReason: 'FINALIZED',
      confirmation: null,
    });
    expect(finalized.changes.find((c) => c.field === 'totals')).toBeDefined();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).total).toBe(
      order.total + 700,
    );
  });

  it('remaps an order line to another product and keeps its snapshot', async () => {
    const order = await placedOrder();
    const line = order.items[0]!;
    const request = {
      operation: 'order_item.correct_product',
      params: { orderItemId: line.id, productId: menu.cola.id, variantId: null },
    };
    const shown = (await preview(request)).json<SupportPreview>();
    expect(shown.changes.map((c) => c.field)).toEqual(['productId']);
    await execute({
      ...request,
      confirmationToken: shown.confirmation!.token,
      reason: 'Wrong mapping',
    });
    const stored = await prisma.orderItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(stored).toMatchObject({
      productId: menu.cola.id,
      nameEn: line.nameEn,
      unitPrice: line.unitPrice,
    });
  });

  it('restores an archived product', async () => {
    await prisma.product.update({ where: { id: menu.cola.id }, data: { archivedAt: new Date() } });
    const request = {
      operation: 'entity.restore',
      params: { entityType: 'PRODUCT', entityId: menu.cola.id },
    };
    const shown = (await preview(request)).json<SupportPreview>();
    expect(shown.changes.map((c) => [c.field, typeof c.before, c.after])).toEqual([
      ['archivedAt', 'string', null],
    ]);
    await execute({
      ...request,
      confirmationToken: shown.confirmation!.token,
      reason: 'Archived by mistake',
    });
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: menu.cola.id } })).archivedAt,
    ).toBeNull();
    // Another tenant's product is not found.
    const other = await createTenant(prisma);
    const otherMenu = await createMenuFixture(prisma, other);
    const foreign = await preview({
      operation: 'entity.restore',
      params: { entityType: 'PRODUCT', entityId: otherMenu.cola.id },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('asks the hub to resend a refused change (ADR 0014)', async () => {
    const paired = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/devices`,
      headers: staff,
      payload: { name: 'Main hub', type: 'GATEWAY' },
    });
    const deviceId = paired.json<PairedDevice>().device.id;
    const operationId = newId();
    await prisma.processedOperation.create({
      data: {
        operationId,
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        deviceId,
        entityType: 'Order',
        entityId: newId(),
        operationType: 'ORDER_UPSERT',
        entityVersion: 1,
        status: 'REJECTED',
        errorCode: 'SYNC_DEPENDENCY_MISSING',
        errorMessage: 'Missing shift',
      },
    });
    const request = { operation: 'sync.retry', params: { operationId } };
    const shown = (await preview(request)).json<SupportPreview>();
    expect(shown.executable, JSON.stringify(shown)).toBe(true);
    const done = await execute({
      ...request,
      confirmationToken: shown.confirmation!.token,
      reason: 'Shift was synced',
    });
    expect(done.statusCode, done.body).toBe(200);
    const row = await prisma.processedOperation.findUniqueOrThrow({ where: { operationId } });
    expect(row.resendRequestedAt).not.toBeNull();
    // Executing the same preview again: the record changed.
    const again = await execute({
      ...request,
      confirmationToken: shown.confirmation!.token,
      reason: 'Shift was synced',
    });
    expect(again.json<ApiErrorBody>().code).toBe('SUPPORT_PREVIEW_STALE');
  });

  it('does not repair an archived tenant', async () => {
    const order = await placedOrder();
    const request = {
      operation: 'order.correct_status',
      params: { orderId: order.id, to: 'CANCELLED' },
    };
    const token = (await preview(request)).json<SupportPreview>().confirmation!.token;
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { status: 'ARCHIVED' } });
    const res = await execute({ ...request, confirmationToken: token, reason: 'Stuck order' });
    expect(res.json<ApiErrorBody>().code).toBe('TENANT_ARCHIVED');
  });
});

describe('views, secrets and health', () => {
  let tenant: TenantFixture;
  let operator: Record<string, string>;

  beforeAll(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
    operator = await tokenOf('VIEWER');
  });

  it('shows payment accounts with their secret’s status, never the secret', async () => {
    const owner = bearer(await login(app, tenant.owner.email));
    const secret = 'sk_test_PlatformNeverRevealsThis1';
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenant.tenantId}/payment-providers`,
      headers: owner,
      payload: {
        method: 'ONLINE',
        providerKey: 'mock-online',
        mode: 'TEST',
        secrets: { secretKey: secret },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const res = await app.inject({
      method: 'GET',
      url: `${P}/tenants/${tenant.tenantId}/payment-accounts`,
      headers: operator,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(secret);
    expect(res.body).toContain('"hasSecret":true');
  });

  it('never returns password hashes with a tenant’s users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${P}/tenants/${tenant.tenantId}/users`,
      headers: operator,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/argon2|passwordHash/);
  });

  it('shows a live hub, its outbox and server errors on the health board', async () => {
    const owner = bearer(await login(app, tenant.owner.email));
    const paired = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/devices`,
      headers: owner,
      payload: { name: 'Main hub', type: 'GATEWAY' },
    });
    const hub = { authorization: `Device ${paired.json<PairedDevice>().credential}` };
    // The hub calls in (seen now) and reported its outbox with its last push.
    await app.inject({ method: 'GET', url: '/api/v1/sync/pull?wait=0', headers: hub });
    await prisma.device.update({
      where: { id: paired.json<PairedDevice>().device.id },
      data: {
        metadata: { outbox: { pending: 3, failed: 1, reportedAt: new Date().toISOString() } },
      },
    });
    app.get(PlatformErrorEventsService).record({
      status: 500,
      code: 'INTERNAL_ERROR',
      method: 'GET',
      route: '/api/v1/locations/:locationId/orders',
      message: 'Error: boom',
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      requestId: 'req-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const board = (
      await app.inject({ method: 'GET', url: `${P}/health`, headers: operator })
    ).json<{
      tenants: {
        tenantId: string;
        hubsOnline: number;
        pendingOperations: number;
        failedOperations: number;
        errors24h: number;
      }[];
    }>();
    expect(board.tenants.find((t) => t.tenantId === tenant.tenantId)).toMatchObject({
      hubsOnline: 1,
      pendingOperations: 3,
      failedOperations: 1,
      errors24h: 1,
    });
    const health = (
      await app.inject({
        method: 'GET',
        url: `${P}/tenants/${tenant.tenantId}/health`,
        headers: operator,
      })
    ).json<TenantHealth>();
    const locationA = health.locations.find((l) => l.locationId === tenant.locationA)!;
    expect(locationA).toMatchObject({ pendingOperations: 3, failedOperations: 1 });
    expect(locationA.hubs[0]?.online).toBe(true);
    expect(health.recentErrors[0]).toMatchObject({
      code: 'INTERNAL_ERROR',
      route: '/api/v1/locations/:locationId/orders',
    });
  });

  it('lists the platform’s own audit log', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${P}/audit-logs?action=platform_auth.`,
      headers: operator,
    });
    const page = res.json<Paginated<PlatformAuditEntry>>();
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.actorName).toBe('Platform VIEWER');
  });
});

describe('organizations (E1)', () => {
  let owner: Record<string, string>;
  let ownerId: string;
  let viewer: Record<string, string>;
  const O = `${P}/organizations`;
  const slug = () => `group-${Date.now().toString(36)}${(counter += 1)}`;
  const NEW_OWNER = { email: 'founder@group.test', displayName: 'Founder', password: PASSWORD };
  const create = (overrides: Record<string, unknown> = {}, headers = owner) =>
    app.inject({
      method: 'POST',
      url: O,
      headers,
      payload: {
        slug: slug(),
        nameEn: 'Group',
        nameAr: 'مجموعة',
        currencyCode: 'ILS',
        owner: NEW_OWNER,
        ...overrides,
      },
    });
  const makeOrganization = async (overrides: Record<string, unknown> = {}) => {
    const res = await create({
      owner: { ...NEW_OWNER, email: `o${(counter += 1)}@group.test` },
      ...overrides,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<PlatformOrganizationDetail>();
  };
  const attach = (organizationId: string, tenantId: string, headers = owner) =>
    app.inject({
      method: 'POST',
      url: `${O}/${organizationId}/tenants`,
      headers,
      payload: { tenantId },
    });
  const platformAudit = (action: string) =>
    prisma.platformAuditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const provisionRequest = (s: string, extra: Record<string, unknown> = {}) => ({
    tenant: {
      slug: s,
      nameEn: 'Branch Brand',
      nameAr: 'علامة',
      businessType: 'COFFEE_SHOP',
      defaultLocale: 'ar',
      timezone: 'Asia/Hebron',
    },
    location: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
    ...extra,
  });

  beforeAll(async () => {
    await resetDatabase(prisma);
    const operator = await platformUser('OPERATOR');
    ownerId = operator.id;
    owner = bearer((await platformLogin(operator.email)).json<PlatformTokenResponse>().accessToken);
    viewer = await tokenOf('VIEWER');
  });

  it('creates an organization with its first owner as an OWNER member, audited', async () => {
    const res = await create({ owner: { ...NEW_OWNER, email: ' Founder@Group.Test ' } });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<PlatformOrganizationDetail>();
    expect(created).toMatchObject({
      currencyCode: 'ILS',
      status: 'ACTIVE',
      brandCount: 0,
      memberCount: 1,
      brands: [],
    });
    expect(created.members).toMatchObject([
      { email: 'founder@group.test', role: 'OWNER', displayName: 'Founder' },
    ]);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: 'founder@group.test' },
    });
    expect(created.members[0]?.accountId).toBe(account.id);

    const entries = (await platformAudit('organization.create')).filter(
      (e) => e.entityId === created.id,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: ownerId, entityType: 'Organization' });
    expect(JSON.stringify(entries)).not.toContain(PASSWORD);
    const memberAudit = (await platformAudit('organization.member_add')).filter(
      (e) => e.entityId === created.members[0]?.id,
    );
    expect(memberAudit).toHaveLength(1);
  });

  it('makes an existing account the owner without a password; a new one needs it', async () => {
    const tenant = await createTenant(prisma);
    const existing = await create({
      owner: { email: tenant.owner.email, displayName: 'Existing Owner' },
    });
    expect(existing.statusCode, existing.body).toBe(201);
    expect(existing.json<PlatformOrganizationDetail>().members[0]?.email).toBe(tenant.owner.email);
    // Their password is untouched.
    expect(await login(app, tenant.owner.email)).toBeTruthy();

    const before = await prisma.organization.count();
    const missing = await create({ owner: { email: 'new@group.test', displayName: 'New' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<ApiErrorBody>().code).toBe('VALIDATION_FAILED');
    expect(await prisma.organization.count()).toBe(before);
    expect(await prisma.account.count({ where: { email: 'new@group.test' } })).toBe(0);
  });

  it('refuses a slug already in use', async () => {
    const first = await makeOrganization();
    const again = await create({
      slug: first.slug,
      owner: { ...NEW_OWNER, email: 'other@group.test' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<ApiErrorBody>().code).toBe('ORGANIZATION_SLUG_TAKEN');
    expect(await prisma.account.count({ where: { email: 'other@group.test' } })).toBe(0);
  });

  it('lets a viewer read but not write; support reads too', async () => {
    const org = await makeOrganization();
    const support = await tokenOf('SUPPORT');
    for (const headers of [viewer, support]) {
      const list = await app.inject({ method: 'GET', url: O, headers });
      expect(list.statusCode, list.body).toBe(200);
      const detail = await app.inject({ method: 'GET', url: `${O}/${org.id}`, headers });
      expect(detail.statusCode, detail.body).toBe(200);
      const members = await app.inject({ method: 'GET', url: `${O}/${org.id}/members`, headers });
      expect(members.statusCode, members.body).toBe(200);
    }
    const tenant = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    const before = await prisma.organization.count();
    const writes = [
      { method: 'POST', url: O, payload: {} },
      { method: 'PATCH', url: `${O}/${org.id}`, payload: { nameEn: 'X' } },
      { method: 'POST', url: `${O}/${org.id}/tenants`, payload: { tenantId: tenant.tenantId } },
      { method: 'DELETE', url: `${O}/${org.id}/tenants/${tenant.tenantId}`, payload: undefined },
      { method: 'POST', url: `${O}/${org.id}/members`, payload: {} },
      { method: 'PATCH', url: `${O}/${org.id}/members/${newId()}`, payload: { role: 'OWNER' } },
      { method: 'DELETE', url: `${O}/${org.id}/members/${newId()}`, payload: undefined },
    ] as const;
    for (const w of writes) {
      for (const headers of [viewer, support]) {
        const res = await app.inject({ ...w, headers });
        expect(res.statusCode, `${w.method} ${w.url}`).toBe(403);
        expect(res.json<ApiErrorBody>().details.missing).toEqual(['organizations.manage']);
      }
    }
    expect(await prisma.organization.count()).toBe(before);
  });

  it('lists and searches organizations, and answers 404 for an unknown one', async () => {
    const org = await makeOrganization({ nameEn: 'Zebra Holdings Unique' });
    await makeOrganization();
    const found = await app.inject({
      method: 'GET',
      url: `${O}?search=zebra holdings&status=ACTIVE`,
      headers: viewer,
    });
    const page = found.json<Paginated<PlatformOrganizationSummary>>();
    expect(page.items.map((i) => i.id)).toEqual([org.id]);
    expect(page.items[0]).toMatchObject({ brandCount: 0, memberCount: 1 });
    const suspended = await app.inject({
      method: 'GET',
      url: `${O}?status=SUSPENDED`,
      headers: viewer,
    });
    expect(suspended.json<Paginated<PlatformOrganizationSummary>>().total).toBe(0);
    const missing = await app.inject({ method: 'GET', url: `${O}/${newId()}`, headers: viewer });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiErrorBody>().code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('changes names and status, audited with before and after', async () => {
    const org = await makeOrganization();
    const res = await app.inject({
      method: 'PATCH',
      url: `${O}/${org.id}`,
      headers: owner,
      payload: { nameEn: 'Renamed Group', status: 'SUSPENDED' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PlatformOrganizationDetail>()).toMatchObject({
      nameEn: 'Renamed Group',
      nameAr: org.nameAr,
      status: 'SUSPENDED',
    });
    const entry = (await platformAudit('organization.update')).find((e) => e.entityId === org.id);
    expect(entry?.actorId).toBe(ownerId);
    expect(entry?.metadata).toMatchObject({
      before: { nameEn: 'Group', status: 'ACTIVE' },
      after: { nameEn: 'Renamed Group', status: 'SUSPENDED' },
    });
    const empty = await app.inject({
      method: 'PATCH',
      url: `${O}/${org.id}`,
      headers: owner,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'PATCH',
      url: `${O}/${newId()}`,
      headers: owner,
      payload: { nameEn: 'X' },
    });
    expect(unknown.json<ApiErrorBody>().code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('attaches a brand: members get linked users there; another currency is refused', async () => {
    const org = await makeOrganization();
    const brand = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    const res = await attach(org.id, brand.tenantId);
    expect(res.statusCode, res.body).toBe(200);
    const attached = res.json<PlatformOrganizationAttached>();
    expect(attached.skippedMemberIds).toEqual([]);
    expect(attached.brands.map((b) => b.id)).toEqual([brand.tenantId]);
    expect(attached.brandCount).toBe(1);
    const linked = await prisma.user.findFirstOrThrow({
      where: { tenantId: brand.tenantId, organizationMemberId: org.members[0]?.id },
    });
    expect(linked.isActive).toBe(true);
    const brandAudit = await prisma.auditLog.findFirstOrThrow({
      where: { tenantId: brand.tenantId, action: 'user.organization_linked' },
    });
    expect(brandAudit).toMatchObject({ actorType: 'PLATFORM', actorId: ownerId });
    const entry = (await platformAudit('organization.attach')).find((e) => e.entityId === org.id);
    expect(entry).toMatchObject({ actorId: ownerId, subjectTenantId: brand.tenantId });

    const sar = await createTenant(prisma);
    const mismatch = await attach(org.id, sar.tenantId);
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json<ApiErrorBody>().code).toBe('ORGANIZATION_CURRENCY_MISMATCH');

    const other = await makeOrganization();
    const taken = await attach(other.id, brand.tenantId);
    expect(taken.statusCode).toBe(409);
    expect(taken.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'TENANT_IN_ORGANIZATION' },
    });
    const unknown = await attach(org.id, newId());
    expect(unknown.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
  });

  it('provisions a brand into an organization: members are its owners, no owner e-mail', async () => {
    const org = await makeOrganization();
    const s = slug();
    const res = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(s, { organizationId: org.id }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<ProvisionedTenantDto>();
    expect(created.owner).toBeNull();
    const tenantId = created.tenant.tenant.id;
    expect(created.tenant.owners.map((o) => o.email)).toEqual([org.members[0]?.email]);
    const row = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(row.organizationId).toBe(org.id);
    // Nobody was created from an owner e-mail: the only user is the member's linked user.
    const users = await prisma.user.findMany({ where: { tenantId } });
    expect(users.map((u) => u.organizationMemberId)).toEqual([org.members[0]?.id]);
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: org.members[0]?.email, password: PASSWORD, tenantId },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const audit = await platformAudit('tenant.provisioned');
    expect(audit.find((e) => e.subjectTenantId === tenantId)?.metadata).toMatchObject({
      organizationId: org.id,
    });
    expect(
      (await platformAudit('organization.attach')).some((e) => e.subjectTenantId === tenantId),
    ).toBe(true);
  });

  it('reports the tenant id when linking the members fails, with the provisioning audited', async () => {
    const org = await makeOrganization();
    const s = slug();
    const spy = vi
      .spyOn(app.get(OrganizationService), 'attachTenant')
      .mockRejectedValueOnce(new Error('boom'));
    const res = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(s, { organizationId: org.id }),
    });
    spy.mockRestore();
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: s } });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { tenantId: tenant.id, reason: 'ORGANIZATION_LINK_FAILED' },
    });
    const audit = (await platformAudit('tenant.provisioned')).filter(
      (e) => e.subjectTenantId === tenant.id,
    );
    expect(audit).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { tenantId: tenant.id, action: 'tenant.provisioned' } }),
    ).toBe(1);
    expect(await prisma.user.count({ where: { tenantId: tenant.id } })).toBe(0);
    // Attaching again repairs it.
    const repaired = await attach(org.id, tenant.id);
    expect(repaired.statusCode, repaired.body).toBe(200);
    expect(await prisma.user.count({ where: { tenantId: tenant.id } })).toBe(1);
  });

  it('refuses an owner with an organization, an organization without an owner otherwise, a currency mismatch', async () => {
    const org = await makeOrganization();
    const both = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(slug(), {
        organizationId: org.id,
        owner: { email: 'x@owner.test', displayName: 'X' },
      }),
    });
    expect(both.statusCode).toBe(400);
    const neither = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(slug()),
    });
    expect(neither.statusCode).toBe(400);
    const s = slug();
    const sar = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(s, {
        organizationId: org.id,
        tenant: { ...provisionRequest(s).tenant, currencyCode: 'SAR' },
      }),
    });
    expect(sar.statusCode).toBe(409);
    expect(sar.json<ApiErrorBody>().code).toBe('ORGANIZATION_CURRENCY_MISMATCH');
    expect(await prisma.tenant.count({ where: { slug: s } })).toBe(0);
    const unknown = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(slug(), { organizationId: newId() }),
    });
    expect(unknown.json<ApiErrorBody>().code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('filters the tenant list by organization and shows its name in the rows', async () => {
    const org = await makeOrganization({ nameEn: 'Filter Group' });
    const inside = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    const outside = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    expect((await attach(org.id, inside.tenantId)).statusCode).toBe(200);
    const res = await app.inject({
      method: 'GET',
      url: `${P}/tenants?organizationId=${org.id}`,
      headers: viewer,
    });
    const page = res.json<Paginated<PlatformTenantSummary>>();
    expect(page.items.map((t) => t.id)).toEqual([inside.tenantId]);
    expect(page.items[0]?.organization).toEqual({
      id: org.id,
      nameEn: 'Filter Group',
      nameAr: org.nameAr,
    });
    const all = await app.inject({
      method: 'GET',
      url: `${P}/tenants?pageSize=100`,
      headers: viewer,
    });
    const rows = all.json<Paginated<PlatformTenantSummary>>().items;
    expect(rows.find((t) => t.id === outside.tenantId)?.organization).toBeNull();
  });

  it('refuses to detach a brand left without an owner of its own, then detaches', async () => {
    const org = await makeOrganization();
    const s = slug();
    const provisioned = await app.inject({
      method: 'POST',
      url: `${P}/tenants`,
      headers: owner,
      payload: provisionRequest(s, { organizationId: org.id }),
    });
    const tenantId = provisioned.json<ProvisionedTenantDto>().tenant.tenant.id;
    const detach = () =>
      app.inject({ method: 'DELETE', url: `${O}/${org.id}/tenants/${tenantId}`, headers: owner });

    const refused = await detach();
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'LAST_OWNER' },
    });
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).organizationId,
    ).toBe(org.id);

    // A brand Owner of its own: an inactive one does not count.
    const ownerRole = await prisma.role.findFirstOrThrow({ where: { tenantId, name: 'Owner' } });
    const account = await prisma.account.create({
      data: { email: `own-${s}@brand.test`, passwordHash: 'x', lastTenantId: tenantId },
    });
    const brandOwner = await prisma.user.create({
      data: {
        tenantId,
        accountId: account.id,
        email: account.email,
        displayName: 'Brand Owner',
        isActive: false,
        roles: { create: { roleId: ownerRole.id, locationId: null } },
      },
    });
    expect((await detach()).statusCode).toBe(409);
    await prisma.user.update({ where: { id: brandOwner.id }, data: { isActive: true } });

    const done = await detach();
    expect(done.statusCode, done.body).toBe(204);
    expect(
      (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).organizationId,
    ).toBeNull();
    const entry = (await platformAudit('organization.detach')).find(
      (e) => e.subjectTenantId === tenantId,
    );
    expect(entry).toMatchObject({ actorId: ownerId, entityId: org.id });
    // The member's linked user is deactivated and unlinked from the organization.
    const memberUser = await prisma.user.findFirstOrThrow({
      where: { tenantId, account: { email: org.members[0]?.email } },
    });
    expect(memberUser.isActive).toBe(false);
    expect(memberUser.organizationMemberId).toBeNull();
    // The brand owner stays active.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: brandOwner.id } })).isActive).toBe(
      true,
    );
    const gone = await detach();
    expect(gone.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
  });

  it('manages members like the organization does, audited, with the last-owner rule', async () => {
    const org = await makeOrganization();
    const brand = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    await attach(org.id, brand.tenantId);
    const members = `${O}/${org.id}/members`;
    const first = org.members[0]!;

    const added = await app.inject({
      method: 'POST',
      url: members,
      headers: owner,
      payload: {
        email: 'finance@group.test',
        displayName: 'Fin',
        role: 'FINANCE',
        password: PASSWORD,
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const member = added.json<PlatformOrganizationDetail['members'][number]>();
    expect(member).toMatchObject({ role: 'FINANCE', email: 'finance@group.test' });
    const brandUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: brand.tenantId, organizationMemberId: member.id },
      include: { roles: { include: { role: true } } },
    });
    expect(brandUser.roles.map((r) => r.role.name)).toEqual(['Finance']);
    expect(
      (
        await prisma.auditLog.findMany({
          where: { tenantId: brand.tenantId, entityId: brandUser.id },
        })
      )[0],
    ).toMatchObject({ actorType: 'PLATFORM', actorId: ownerId });

    const list = await app.inject({ method: 'GET', url: members, headers: viewer });
    expect(list.json<unknown[]>()).toHaveLength(2);

    const changed = await app.inject({
      method: 'PATCH',
      url: `${members}/${member.id}`,
      headers: owner,
      payload: { role: 'MANAGER' },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<{ role: string }>().role).toBe('MANAGER');

    const demote = await app.inject({
      method: 'PATCH',
      url: `${members}/${first.id}`,
      headers: owner,
      payload: { role: 'FINANCE' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json<ApiErrorBody>().code).toBe('ORGANIZATION_LAST_OWNER');
    const removeLast = await app.inject({
      method: 'DELETE',
      url: `${members}/${first.id}`,
      headers: owner,
    });
    expect(removeLast.json<ApiErrorBody>().code).toBe('ORGANIZATION_LAST_OWNER');

    const removed = await app.inject({
      method: 'DELETE',
      url: `${members}/${member.id}`,
      headers: owner,
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: brandUser.id } })).isActive).toBe(
      false,
    );

    for (const action of ['member_add', 'member_role', 'member_remove']) {
      const entries = (await platformAudit(`organization.${action}`)).filter(
        (e) => e.entityId === member.id,
      );
      expect(entries, action).toHaveLength(1);
      expect(entries[0]?.actorId).toBe(ownerId);
    }
    // Another organization's member is not found through this one.
    const other = await makeOrganization();
    const foreign = await app.inject({
      method: 'DELETE',
      url: `${O}/${other.id}/members/${member.id}`,
      headers: owner,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
