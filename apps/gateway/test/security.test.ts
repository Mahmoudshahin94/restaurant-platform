import { newId } from '@pos/domain';
import { type RouteEntry, listRoutes } from '@pos/server';
import { type ApiErrorBody, MADAR_VERSION } from '@pos/shared-types';
import type { HubStatus, PairedTerminal, TokenResponse } from '@pos/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeCloud, type TestHub, pair, removeDir, startHub } from './harness';
import {
  KIOSK_CODE,
  PASSWORD,
  buildSnapshot,
  moduleOverride,
  pendingTerminal,
  withVersion,
} from './snapshot-fixture';

/**
 * The hub's share of the hardening checks (ADR 0016): it serves the same server code on the
 * location LAN, so the same rules hold — every route protected, refusals on every route, the
 * CORS allowlist and no secrets on its unauthenticated status.
 */
let cloud: FakeCloud;
let hub: TestHub;
let fixture: Awaited<ReturnType<typeof buildSnapshot>>;
let routes: RouteEntry[];
/** A paired kiosk's credential (ADR 0022). */
let kiosk: Record<string, string>;

beforeAll(async () => {
  fixture = await buildSnapshot();
  fixture.tables.devices = [pendingTerminal(fixture.ids)];
  fixture.tables.featureOverrides = [moduleOverride(fixture.ids, 'SELF_CHECKOUT', true)];
  cloud = new FakeCloud();
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  await cloud.start();
  hub = await startHub();
  await pair(hub, cloud);
  expect(await hub.snapshots.syncNow()).toBe('applied');
  routes = listRoutes(hub.app);
  const paired = await hub.app.inject({
    method: 'POST',
    url: '/api/v1/terminals/pair',
    payload: { code: KIOSK_CODE },
  });
  kiosk = { authorization: `Device ${paired.json<PairedTerminal>().credential}` };
});
afterAll(async () => {
  await hub.close();
  await cloud.stop();
  removeDir(hub.dataDir);
});

const key = (r: RouteEntry) => `${r.method} ${r.path}`;
const urlOf = (route: RouteEntry) =>
  `/api/v1${route.path.replace(/:(\w+)/g, (_m, name: string) =>
    name === 'locationId' ? fixture.ids.locationId : newId(),
  )}`;
const call = (route: RouteEntry, headers: Record<string, string> = {}) =>
  hub.app.inject({
    method: route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: urlOf(route),
    headers,
  });

describe('hub routes', () => {
  it('protects every route; only sign-in, health, the hub status, its sign-in look and the menu’s pictures are public', () => {
    expect(routes.filter((r) => r.access === 'unprotected')).toEqual([]);
    expect(routes.filter((r) => r.access === 'guarded')).toEqual([]);
    expect(
      routes
        .filter((r) => r.access === 'public')
        .map(key)
        .sort(),
    ).toEqual([
      'GET /health',
      'GET /hub/branding',
      'GET /hub/branding/files/:fileId',
      'GET /hub/locales',
      'GET /hub/media/:fileId',
      'GET /hub/status',
      'GET /ready',
      'POST /auth/login',
      'POST /auth/logout',
      'POST /auth/pin',
      'POST /auth/refresh',
      'POST /terminals/pair',
    ]);
    // The cloud's hub-facing and customer routes are not served on the LAN.
    expect(routes.some((r) => r.path.startsWith('/sync/') || r.path.startsWith('/public/'))).toBe(
      false,
    );
  });

  it('serves terminals only their device routes: the kiosk reads, orders and pays, nothing else', () => {
    expect(
      routes
        .filter((r) => r.access === 'device')
        .map((r) => `${key(r)} [${r.devices.join(',')}] ${r.features.join(',')}`)
        .sort(),
    ).toEqual([
      'GET /kiosk/context [KIOSK] ',
      'GET /locations/:locationId/kiosk/menu [KIOSK] SELF_CHECKOUT',
      'GET /terminals/me [POS,KDS,KIOSK,CUSTOMER_DISPLAY] ',
      'POST /kiosk/attendant [KIOSK] ',
      'POST /locations/:locationId/kiosk/orders [KIOSK] SELF_CHECKOUT',
      'POST /locations/:locationId/kiosk/orders/:orderId/cancel [KIOSK] SELF_CHECKOUT',
      'POST /locations/:locationId/kiosk/orders/:orderId/payments [KIOSK] SELF_CHECKOUT',
    ]);
    expect(routes.filter((r) => r.access === 'device' && r.permissions.length > 0)).toEqual([]);
  });

  it("refuses a kiosk's device credential on every staff route (401)", async () => {
    const staff = routes.filter((r) => r.access === 'permissions');
    const failures: string[] = [];
    for (const route of staff) {
      const res = await call(route, kiosk);
      if (res.statusCode !== 401 || res.json<ApiErrorBody>().code !== 'UNAUTHENTICATED') {
        failures.push(`${key(route)} → ${String(res.statusCode)}`);
      }
    }
    expect(staff.length).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });

  it('refuses anonymous callers, staff tokens and forged credentials on every device route', async () => {
    const login = await hub.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'owner@hub.test', password: PASSWORD },
    });
    const owner = { authorization: `Bearer ${login.json<TokenResponse>().accessToken}` };
    const forged = { authorization: `${kiosk.authorization ?? ''}x` };
    const failures: string[] = [];
    for (const route of routes.filter((r) => r.access === 'device')) {
      for (const [who, headers] of [
        ['anonymous', {}],
        ['owner', owner],
        ['forged', forged],
      ] as const) {
        const res = await call(route, headers);
        if (res.statusCode !== 401) failures.push(`${who}: ${key(route)} → ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps a kiosk to its own location: another location's id is not found", async () => {
    const res = await hub.app.inject({
      method: 'GET',
      url: `/api/v1/locations/${newId()}/kiosk/menu`,
      headers: kiosk,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('LOCATION_NOT_FOUND');
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

  it('serves liveness (with its MADAR version) and readiness outside the versioned prefix', async () => {
    expect((await hub.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({
      status: 'ok',
      version: MADAR_VERSION,
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
