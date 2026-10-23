import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import { PrismaService, type RouteEntry, listRoutes, loadConfig, loggableError } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
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
  'GET /orders/track',
  'GET /public/locations/:locationId',
  'GET /public/locations/:locationId/menu',
  'GET /public/restaurants/:slug',
  'GET /ready',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/pin',
  'POST /auth/refresh',
  'POST /orders',
];

const key = (r: RouteEntry) => `${r.method} ${r.path}`;

/** A concrete URL for a route: the given tenant's ids, a fresh id for any other parameter. */
function urlOf(route: RouteEntry, ids: { restaurantId: string; locationId: string }): string {
  const path = route.path.replace(/:(\w+)/g, (_match, name: string) => {
    if (name === 'restaurantId') return ids.restaurantId;
    if (name === 'locationId') return ids.locationId;
    if (name === 'slug') return 'no-such-restaurant';
    return newId();
  });
  return path === '/health' || path === '/ready' ? path : `/api/v1${path}`;
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
        url: urlOf(route, { restaurantId: tenant.restaurantId, locationId: tenant.locationA }),
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
        url: urlOf(route, { restaurantId: tenant.restaurantId, locationId: tenant.locationA }),
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
        url: urlOf(route, { restaurantId: tenant.restaurantId, locationId: tenant.locationA }),
        headers: bearer(memberToken),
      });
      const { code } = res.json<ApiErrorBody>();
      if (res.statusCode !== 403 || code !== 'INSUFFICIENT_PERMISSION') {
        failures.push(`${key(route)} → ${String(res.statusCode)} ${code}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('hides another tenant’s restaurant and locations from an owner on every route', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'permissions')) {
      if (!/:(restaurantId|locationId)/.test(route.path)) continue;
      const res = await app.inject({
        method: methodOf(route),
        url: urlOf(route, { restaurantId: tenant.restaurantId, locationId: tenant.locationA }),
        headers: bearer(ownerToken),
      });
      const { code } = res.json<ApiErrorBody>();
      if (
        res.statusCode !== 404 ||
        !['RESTAURANT_NOT_FOUND', 'LOCATION_NOT_FOUND'].includes(code)
      ) {
        failures.push(`${key(route)} → ${String(res.statusCode)} ${code}`);
      }
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
      // Each budget is separate: website orders still have theirs.
      expect((await order()).statusCode).toBe(400);
      expect((await order()).statusCode).toBe(400);
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
