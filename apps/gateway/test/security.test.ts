import { newId } from '@pos/domain';
import { type RouteEntry, listRoutes } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import type { HubStatus } from '@pos/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeCloud, type TestHub, pair, removeDir, startHub } from './harness';
import { buildSnapshot, withVersion } from './snapshot-fixture';

/**
 * The hub's share of the hardening checks (ADR 0016): it serves the same server code on the
 * restaurant LAN, so the same rules hold — every route protected, refusals on every route, the
 * CORS allowlist and no secrets on its unauthenticated status.
 */
let cloud: FakeCloud;
let hub: TestHub;
let fixture: Awaited<ReturnType<typeof buildSnapshot>>;
let routes: RouteEntry[];

beforeAll(async () => {
  fixture = await buildSnapshot();
  cloud = new FakeCloud();
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  await cloud.start();
  hub = await startHub();
  await pair(hub, cloud);
  expect(await hub.snapshots.syncNow()).toBe('applied');
  routes = listRoutes(hub.app);
});
afterAll(async () => {
  await hub.close();
  await cloud.stop();
  removeDir(hub.dataDir);
});

const key = (r: RouteEntry) => `${r.method} ${r.path}`;

describe('hub routes', () => {
  it('protects every route; only sign-in, health and the hub status are public', () => {
    expect(routes.filter((r) => r.access === 'unprotected')).toEqual([]);
    expect(routes.filter((r) => r.access === 'guarded')).toEqual([]);
    expect(
      routes
        .filter((r) => r.access === 'public')
        .map(key)
        .sort(),
    ).toEqual([
      'GET /health',
      'GET /hub/status',
      'GET /ready',
      'POST /auth/login',
      'POST /auth/logout',
      'POST /auth/pin',
      'POST /auth/refresh',
    ]);
    // The cloud's hub-facing and customer routes are not served on the LAN.
    expect(routes.some((r) => r.path.startsWith('/sync/') || r.path.startsWith('/public/'))).toBe(
      false,
    );
  });

  it('answers 401 on every protected route without an access token', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'permissions')) {
      const url = `/api/v1${route.path.replace(/:(\w+)/g, (_m, name: string) =>
        name === 'locationId' ? fixture.ids.locationId : newId(),
      )}`;
      const res = await hub.app.inject({
        method: route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        url,
      });
      if (res.statusCode !== 401 || res.json<ApiErrorBody>().code !== 'UNAUTHENTICATED') {
        failures.push(`${key(route)} → ${String(res.statusCode)}`);
      }
    }
    expect(routes.filter((r) => r.access === 'permissions').length).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  it('allows only the configured LAN origins', async () => {
    const preflight = (origin: string) =>
      hub.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/pin',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
    expect((await preflight('http://localhost:5174')).headers['access-control-allow-origin']).toBe(
      'http://localhost:5174',
    );
    expect(
      (await preflight('http://192.168.1.66:8080')).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('serves liveness and readiness outside the versioned prefix', async () => {
    expect((await hub.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
    });
    const ready = await hub.app.inject({ method: 'GET', url: '/ready' });
    expect(ready.json()).toEqual({ status: 'ready', database: 'ok' });
    expect(ready.headers['x-request-id']).toBeTruthy();
  });

  it('keeps credentials out of its public status', async () => {
    const res = await hub.app.inject({ method: 'GET', url: '/api/v1/hub/status' });
    expect(res.statusCode).toBe(200);
    const status = res.json<HubStatus>();
    const text = JSON.stringify(status);
    expect(text).not.toMatch(/credential|secret|password|token/i);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
