import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import {
  PrismaService,
  type RouteEntry,
  TrackingTokens,
  listRoutes,
  loadConfig,
  loggableError,
  trackingSecret,
} from '@pos/server';
import type { ApiErrorBody, Feature } from '@pos/shared-types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { testConfig } from './env';

/**
 * Security hardening checks (ADR 0016): every route is protected server-side, refusals hold for
 * every route rather than a sample, and the transport's defences (CORS, headers, rate limits,
 * log redaction) behave as configured.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let routes: RouteEntry[];

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  routes = listRoutes(app);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** The routes that need no credential at all; adding one must be a deliberate change here. */
const PUBLIC_ROUTES = [
  'GET /health',
  'GET /internal/domains/check',
  'GET /ready',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/pin',
  'POST /auth/refresh',
  // The platform admin's sign-in (ADR 0025); every other platform route is `platform`.
  'POST /platform/auth/login',
  'POST /platform/auth/logout',
  'POST /platform/auth/refresh',
];

/**
 * The tenant website's routes (ADR 0023): no credential, the tenant comes from the verified host
 * name. Adding one must be a deliberate change here.
 */
const HOST_ROUTES = [
  'GET /orders/track',
  'GET /public/site',
  'GET /public/site/files/:fileId',
  'GET /public/site/locations/:locationId',
  'GET /public/site/locations/:locationId/menu',
  'POST /orders',
];

const key = (r: RouteEntry) => `${r.method} ${r.path}`;

/**
 * Routes that need a module (ADR 0018), with the module. Adding a gate must be a deliberate change
 * here, and every route listed is called with its module off below.
 */
const FEATURE_ROUTES: Record<string, Feature> = {
  'GET /locations/:locationId/catalog/lookup': 'BARCODE',
  'GET /locations/:locationId/floor': 'TABLES',
  'GET /locations/:locationId/kitchen/settings': 'KDS',
  'GET /locations/:locationId/kitchen/tickets': 'KDS',
  'GET /locations/:locationId/kitchen/tickets/:ticketId': 'KDS',
  'GET /locations/:locationId/online-ordering': 'ONLINE_ORDERING',
  'GET /orders/track': 'ONLINE_ORDERING',
  'GET /public/site': 'ONLINE_ORDERING',
  'GET /public/site/files/:fileId': 'ONLINE_ORDERING',
  'GET /public/site/locations/:locationId': 'ONLINE_ORDERING',
  'GET /public/site/locations/:locationId/menu': 'ONLINE_ORDERING',
  'GET /tenants/:tenantId/domains': 'ONLINE_ORDERING',
  'GET /tenants/:tenantId/website': 'ONLINE_ORDERING',
  'PATCH /locations/:locationId/floor/sections/:sectionId': 'TABLES',
  'PATCH /locations/:locationId/floor/tables/:tableId': 'TABLES',
  'POST /locations/:locationId/floor/sections': 'TABLES',
  'POST /locations/:locationId/floor/sections/:sectionId/archive': 'TABLES',
  'POST /locations/:locationId/floor/tables': 'TABLES',
  'POST /locations/:locationId/floor/tables/:tableId/archive': 'TABLES',
  'POST /locations/:locationId/floor/tables/:tableId/restore': 'TABLES',
  'POST /locations/:locationId/kitchen/tickets/:ticketId/dismiss': 'KDS',
  'POST /locations/:locationId/kitchen/tickets/:ticketId/items/:itemId/done': 'KDS',
  'POST /locations/:locationId/kitchen/tickets/:ticketId/priority': 'KDS',
  'POST /locations/:locationId/kitchen/tickets/:ticketId/transitions': 'KDS',
  'POST /locations/:locationId/orders/:orderId/kitchen-priority': 'KDS',
  'POST /orders': 'ONLINE_ORDERING',
  'POST /tenants/:tenantId/domains': 'ONLINE_ORDERING',
  'POST /tenants/:tenantId/domains/:domainId/disable': 'ONLINE_ORDERING',
  'POST /tenants/:tenantId/domains/:domainId/primary': 'ONLINE_ORDERING',
  'POST /tenants/:tenantId/domains/:domainId/verify': 'ONLINE_ORDERING',
  'POST /tenants/:tenantId/website/preview': 'ONLINE_ORDERING',
  'POST /tenants/:tenantId/website/publish': 'ONLINE_ORDERING',
  'PUT /locations/:locationId/online-ordering': 'ONLINE_ORDERING',
  'PUT /tenants/:tenantId/website/draft': 'ONLINE_ORDERING',
};

/** A concrete URL for a route: the given tenant's ids, a fresh id for any other parameter. */
function urlOf(route: RouteEntry, ids: { tenantId: string; locationId: string }): string {
  const path = route.path.replace(/:(\w+)/g, (_match, name: string) => {
    if (name === 'tenantId') return ids.tenantId;
    if (name === 'locationId') return ids.locationId;
    return newId();
  });
  return ['/health', '/ready', '/internal/domains/check'].includes(path) ? path : `/api/v1${path}`;
}

const methodOf = (route: RouteEntry) => route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe('route inventory', () => {
  it('finds the application’s routes', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.map(key)).toContain('POST /locations/:locationId/orders');
  });

  it('protects every route: public ones are listed, hub routes need the device guard', () => {
    expect(routes.filter((r) => r.access === 'unprotected')).toEqual([]);
    expect(
      routes
        .filter((r) => r.access === 'public')
        .map(key)
        .sort(),
    ).toEqual(PUBLIC_ROUTES);
    const guarded = routes.filter((r) => r.access === 'guarded');
    expect(guarded.length).toBeGreaterThan(0);
    for (const route of guarded) {
      expect(route.path.startsWith('/sync/'), key(route)).toBe(true);
      expect(route.guards, key(route)).toEqual(['DeviceGuard']);
    }
  });

  it('serves the website on host routes only, each resolved by HostTenantGuard', () => {
    const host = routes.filter((r) => r.access === 'host');
    expect(host.map(key).sort()).toEqual(HOST_ROUTES);
    for (const route of host) {
      expect(route.guards, key(route)).toEqual(['HostTenantGuard']);
      expect(route.permissions, key(route)).toEqual([]);
    }
  });
});

describe('the website on every host route (ADR 0023)', () => {
  let tenant: TenantFixture;
  let other: TenantFixture;

  beforeAll(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
    other = await createTenant(prisma);
    // A domain each of the other states: none of them serves anything.
    for (const status of ['PENDING', 'FAILED', 'DISABLED'] as const) {
      await prisma.tenantDomain.create({
        data: {
          tenantId: tenant.tenantId,
          domain: `${status.toLowerCase()}.example`,
          kind: 'CUSTOM',
          status,
          verificationToken: `token-${status}`,
        },
      });
    }
  });

  /** A body that would pass validation, so the refusal is the host's. */
  const requestOf = (route: RouteEntry, locationId: string) => ({
    method: methodOf(route),
    url: urlOf(route, { tenantId: tenant.tenantId, locationId }),
    ...(key(route) === 'POST /orders'
      ? {
          payload: {
            id: newId(),
            locationId,
            fulfillment: 'PICKUP',
            customer: { name: 'Guest', phone: '+970 59 000 0000' },
            items: [{ id: newId(), productId: newId(), quantity: 1 }],
            payment: { option: 'PAY_AT_PICKUP' },
          },
        }
      : {}),
  });

  it('answers 404 SITE_NOT_FOUND for an unknown, pending, failed or disabled host', async () => {
    const failures: string[] = [];
    const hosts = [
      'localhost',
      'unknown.localhost',
      'nobody.example',
      'pending.example',
      'failed.example',
      'disabled.example',
    ];
    for (const route of routes.filter((r) => r.access === 'host')) {
      for (const host of hosts) {
        const res = await app.inject({
          ...requestOf(route, tenant.locationA),
          headers: {
            host,
            // Names the tenant every other way a browser could: all ignored.
            'x-tenant-id': tenant.tenantId,
            'x-forwarded-host': tenant.host,
          },
        });
        if (res.statusCode !== 404 || res.json<ApiErrorBody>().code !== 'SITE_NOT_FOUND') {
          failures.push(`${key(route)} @ ${host} → ${String(res.statusCode)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('hides another tenant’s locations behind a tenant’s own host', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'host')) {
      if (!/:locationId/.test(route.path) && key(route) !== 'POST /orders') continue;
      const res = await app.inject({
        ...requestOf(route, other.locationA),
        headers: { host: tenant.host },
      });
      const { code } = res.json<ApiErrorBody>();
      if (res.statusCode !== 404 || code !== 'LOCATION_NOT_FOUND') {
        failures.push(`${key(route)} → ${String(res.statusCode)} ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('refusals on every protected route', () => {
  let tenant: TenantFixture;
  let other: TenantFixture;
  let memberToken: string;
  let ownerToken: string;

  beforeAll(async () => {
    await resetDatabase(prisma);
    // The "cashier" of this tenant holds a role with no permissions at location A.
    tenant = await createTenant(prisma, []);
    other = await createTenant(prisma);
    memberToken = await login(app, tenant.cashier.email);
    ownerToken = await login(app, other.owner.email);
  });

  it('answers 401 without an access token', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'permissions')) {
      const res = await app.inject({
        method: methodOf(route),
        url: urlOf(route, { tenantId: tenant.tenantId, locationId: tenant.locationA }),
      });
      if (res.statusCode !== 401 || res.json<ApiErrorBody>().code !== 'UNAUTHENTICATED') {
        failures.push(`${key(route)} → ${String(res.statusCode)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('answers 401 to hub routes without a device credential, even with a staff token', async () => {
    for (const route of routes.filter((r) => r.access === 'guarded')) {
      const res = await app.inject({
        method: methodOf(route),
        url: urlOf(route, { tenantId: tenant.tenantId, locationId: tenant.locationA }),
        headers: bearer(ownerToken),
      });
      expect(res.statusCode, key(route)).toBe(401);
    }
  });

  it('refuses a member without permissions on every route that requires one', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'permissions')) {
      if (route.permissions.length === 0) continue;
      const res = await app.inject({
        method: methodOf(route),
        url: urlOf(route, { tenantId: tenant.tenantId, locationId: tenant.locationA }),
        headers: bearer(memberToken),
      });
      const { code } = res.json<ApiErrorBody>();
      if (res.statusCode !== 403 || code !== 'INSUFFICIENT_PERMISSION') {
        failures.push(`${key(route)} → ${String(res.statusCode)} ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('hides another tenant and its locations from an owner on every route', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'permissions')) {
      if (!/:(tenantId|locationId)/.test(route.path)) continue;
      const res = await app.inject({
        method: methodOf(route),
        url: urlOf(route, { tenantId: tenant.tenantId, locationId: tenant.locationA }),
        headers: bearer(ownerToken),
      });
      const { code } = res.json<ApiErrorBody>();
      if (res.statusCode !== 404 || !['TENANT_NOT_FOUND', 'LOCATION_NOT_FOUND'].includes(code)) {
        failures.push(`${key(route)} → ${String(res.statusCode)} ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('modules on every gated route (ADR 0018)', () => {
  let tenant: TenantFixture;
  let ownerToken: string;
  let trackingToken: string;

  beforeAll(async () => {
    await resetDatabase(prisma);
    tenant = await createTenant(prisma);
    ownerToken = await login(app, tenant.owner.email);
    // A tracked website order, so tracking reaches its module check with a valid token.
    const orderId = newId();
    await prisma.order.create({
      data: {
        id: orderId,
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        orderNumber: 'W-001',
        businessDate: new Date('2026-10-23T00:00:00Z'),
        channel: 'WEBSITE',
        fulfillmentType: 'PICKUP',
        customerName: 'Guest',
        customerPhone: '+970 59 000 0000',
        status: 'PLACED',
        source: 'WEBSITE',
        currencyCode: 'SAR',
        taxInclusive: true,
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        feeTotal: 0,
        total: 0,
      },
    });
    trackingToken = new TrackingTokens(trackingSecret(testConfig())).issue(orderId);
  });

  /** The tenant switches every module off (the platform still entitles it to them). */
  async function switchOff(features: readonly Feature[]) {
    await prisma.featureOverride.createMany({
      data: features.map((feature) => ({
        tenantId: tenant.tenantId,
        scope: 'tenant',
        feature,
        enabled: false,
      })),
      skipDuplicates: true,
    });
  }

  /** A request that reaches the route's module check: valid ids, body and token. */
  function requestFor(route: RouteEntry) {
    const ids = { tenantId: tenant.tenantId, locationId: tenant.locationA };
    const url = urlOf(route, ids);
    switch (key(route)) {
      case 'GET /orders/track':
        return { url, headers: { host: tenant.host, 'x-tracking-token': trackingToken } };
      case 'POST /orders':
        return {
          url,
          headers: { host: tenant.host },
          payload: {
            id: newId(),
            locationId: tenant.locationA,
            fulfillment: 'PICKUP',
            customer: { name: 'Guest', phone: '+970 59 000 0000' },
            items: [{ id: newId(), productId: newId(), quantity: 1 }],
            payment: { option: 'PAY_AT_PICKUP' },
          },
        };
      default:
        if (route.access === 'host') return { url, headers: { host: tenant.host } };
        return route.access === 'public' ? { url } : { url, headers: bearer(ownerToken) };
    }
  }

  it('records the module of every gated route in the inventory', () => {
    const gated = Object.fromEntries(
      routes.filter((r) => r.features.length > 0).map((r) => [key(r), r.features.join(',')]),
    );
    expect(gated).toEqual(FEATURE_ROUTES);
  });

  it('answers 403 FEATURE_DISABLED on every gated route while its module is off', async () => {
    // BARCODE is off by default for a restaurant; the others are switched off.
    await switchOff(['KDS', 'TABLES', 'ONLINE_ORDERING']);
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.features.length > 0)) {
      const res = await app.inject({ method: methodOf(route), ...requestFor(route) });
      const body = res.json<ApiErrorBody>();
      if (
        res.statusCode !== 403 ||
        body.code !== 'FEATURE_DISABLED' ||
        body.details.feature !== FEATURE_ROUTES[key(route)]
      ) {
        failures.push(`${key(route)} → ${String(res.statusCode)} ${body.code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('serves the same routes again once the module is back on', async () => {
    await prisma.featureOverride.deleteMany({ where: { tenantId: tenant.tenantId } });
    await prisma.featureOverride.create({
      data: { tenantId: tenant.tenantId, scope: 'tenant', feature: 'BARCODE', enabled: true },
    });
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.features.length > 0)) {
      const res = await app.inject({ method: methodOf(route), ...requestFor(route) });
      if (res.statusCode === 403) failures.push(`${key(route)} → 403 ${res.body}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('transport defences', () => {
  it('answers CORS preflights for configured origins only', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const evil = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const simple = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a wildcard or malformed CORS origin at start-up', () => {
    for (const value of ['*', 'http://localhost:5173/app', 'localhost:5173', 'https://*.example']) {
      expect(() => loadConfig({ ...testEnv(), CORS_ORIGINS: value })).toThrow(/CORS_ORIGINS/);
    }
    expect(
      loadConfig({ ...testEnv(), CORS_ORIGINS: 'https://admin.example.com, tauri://localhost' })
        .CORS_ORIGINS,
    ).toEqual(['https://admin.example.com', 'tauri://localhost']);
  });

  it('sends security headers on every response', async () => {
    for (const url of ['/health', '/api/v1/auth/me', '/api/v1/nope']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['x-content-type-options'], url).toBe('nosniff');
      expect(res.headers['strict-transport-security'], url).toMatch(/max-age=\d+/);
      expect(res.headers['x-frame-options'], url).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy'], url).toContain("default-src 'self'");
      expect(res.headers['referrer-policy'], url).toBe('no-referrer');
      expect(res.headers['x-powered-by'], url).toBeUndefined();
    }
  });

  it('rate-limits token refreshes and website orders per client IP', async () => {
    const limited = await startApp({
      AUTH_RATE_LIMIT_PER_MINUTE: '2',
      WEB_ORDER_RATE_LIMIT_PER_MINUTE: '2',
    });
    try {
      const refresh = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          payload: { refreshToken: 'not-a-real-token-but-long-enough-0123456789' },
        });
      const order = () =>
        limited.app.inject({ method: 'POST', url: '/api/v1/orders', payload: {} });
      const refreshCodes = [(await refresh()).statusCode, (await refresh()).statusCode];
      expect(refreshCodes.every((c) => c !== 429)).toBe(true);
      const third = await refresh();
      expect(third.statusCode).toBe(429);
      expect(third.json<ApiErrorBody>().code).toBe('RATE_LIMITED');
      // Each budget is separate: website orders still have theirs (no website answers on the
      // test host, so they are not found until the budget runs out).
      expect((await order()).statusCode).toBe(404);
      expect((await order()).statusCode).toBe(404);
      expect((await order()).statusCode).toBe(429);
    } finally {
      await limited.app.close();
      await limited.prisma.$disconnect();
    }
  });

  it('keys rate limits on the forwarded client address only behind a trusted proxy', async () => {
    const attempt = (target: NestFastifyApplication, client: string) =>
      target.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': client },
        payload: { email: 'nobody@test.local', password: 'wrong-password' },
      });
    const direct = await startApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1' });
    const proxied = await startApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1', TRUST_PROXY: '1' });
    try {
      expect((await attempt(direct.app, '203.0.113.1')).statusCode).toBe(401);
      // Without a trusted proxy the header is ignored: both share the socket's address.
      expect((await attempt(direct.app, '203.0.113.2')).statusCode).toBe(429);
      expect((await attempt(proxied.app, '203.0.113.1')).statusCode).toBe(401);
      expect((await attempt(proxied.app, '203.0.113.2')).statusCode).toBe(401);
      expect((await attempt(proxied.app, '203.0.113.2')).statusCode).toBe(429);
    } finally {
      for (const started of [direct, proxied]) {
        await started.app.close();
        await started.prisma.$disconnect();
      }
    }
  });

  it('records a client’s claimed source only when it may claim it', async () => {
    await resetDatabase(prisma);
    const tenant = await createTenant(prisma);
    for (const source of ['POS', 'HUB', 'SYSTEM']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-client-source': source },
        payload: { email: tenant.owner.email, password: PASSWORD, client: 'native' },
      });
      expect(res.statusCode).toBe(200);
    }
    const sources = await prisma.auditLog.findMany({
      where: { action: 'auth.login', actorId: tenant.owner.id },
      orderBy: { createdAt: 'asc' },
      select: { source: true },
    });
    // Only a paired hub (device credential) may record HUB; nobody may claim SYSTEM.
    expect(sources.map((s) => s.source)).toEqual(['POS', 'ADMIN', 'ADMIN']);
  });
});

describe('error responses and logs', () => {
  it('answers /ready with a typed error when the database is unavailable', async () => {
    const database = app.get(PrismaService);
    const spy = vi.spyOn(database, '$queryRaw').mockRejectedValueOnce(new Error('connection lost'));
    try {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json<ApiErrorBody>()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it('logs Prisma errors without the query arguments they quote', async () => {
    const error = await prisma.user
      .create({ data: { passwordHash: 'argon-hash-that-must-not-leak' } as never })
      .catch((e: unknown) => e);
    expect((error as Error).message).toContain('argon-hash-that-must-not-leak');
    const logged = loggableError(error);
    expect(logged.message).toMatch(/^PrismaClient\w+/);
    expect(JSON.stringify(logged)).not.toContain('argon-hash-that-must-not-leak');
    expect(loggableError(new Error('plain failure')).message).toBe('plain failure');
  });
});

function testEnv(): Record<string, string> {
  const config = testConfig();
  return {
    NODE_ENV: 'test',
    DATABASE_URL: config.DATABASE_URL,
    JWT_ACCESS_SECRET: config.JWT_ACCESS_SECRET,
  };
}
