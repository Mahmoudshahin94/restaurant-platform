import type { Permission } from '@pos/shared-types';
import { PERMISSIONS } from '@pos/shared-types';
import type { AuthUser } from '@pos/validation';
import { vi } from 'vitest';
import { useSession } from '../stores/session';

export const RID = '01a146e8-0000-7000-8000-000000000001';
export const LOC = '01a146e8-0000-7000-8000-000000000002';

export const tenant = {
  id: RID,
  slug: 'demo',
  nameEn: 'Demo',
  nameAr: 'تجريبي',
  legalName: null,
  businessType: 'RESTAURANT',
  status: 'ACTIVE',
  currencyCode: 'SAR',
  defaultLocale: 'en',
  supportedLocales: ['en', 'ar'],
  timezone: 'Asia/Riyadh',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

export const location = {
  id: LOC,
  tenantId: RID,
  code: 'MAIN',
  nameEn: 'Main Branch',
  nameAr: 'الفرع الرئيسي',
  timezone: 'Asia/Riyadh',
  taxInclusive: true,
  onlineOrderingState: 'OPEN',
  cashRoundingIncrement: null,
  kdsWarnMinutes: 8,
  kdsLateMinutes: 15,
  addressLine: null,
  phone: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

/** Signs a user in for component tests, tenant-wide with the given permissions. */
export function signIn(
  permissions: readonly Permission[] = PERMISSIONS,
  locationId: string | null = null,
) {
  const user: AuthUser = {
    id: '01a146e8-0000-7000-8000-0000000000aa',
    email: 'owner@test.local',
    displayName: 'Test Owner',
    preferredLocale: 'en',
    tenantId: RID,
    roles: [
      {
        roleId: '01a146e8-0000-7000-8000-0000000000bb',
        roleName: 'Owner',
        locationId,
        permissions: [...permissions],
      },
    ],
  };
  useSession.setState({ status: 'authenticated', accessToken: 'token', user });
  return user;
}

interface Route {
  method: string;
  path: RegExp;
  reply: (body: unknown) => { status?: number; body?: unknown };
}

export interface ApiStub {
  /** Requests made, with parsed JSON bodies. */
  calls: { method: string; path: string; body: unknown }[];
  on: (
    method: string,
    path: RegExp,
    reply: Route['reply'] | Record<string, unknown> | readonly unknown[] | object,
  ) => ApiStub;
}

/**
 * Stubs `fetch` with routes matched by method and path (the tenant and its location are
 * always served). Unmatched requests answer 404 so a missing stub shows up in the test.
 */
export function stubApi(): ApiStub {
  const routes: Route[] = [];
  const calls: ApiStub['calls'] = [];
  const stub: ApiStub = {
    calls,
    on(method, path, reply) {
      routes.unshift({
        method,
        path,
        reply: typeof reply === 'function' ? (reply as Route['reply']) : () => ({ body: reply }),
      });
      return stub;
    },
  };
  stub.on('GET', /\/tenants\/[^/]+$/, tenant);
  stub.on('GET', /\/tenants\/[^/]+\/locations$/, [location]);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url.pathname + url.search, body });
      const route = routes.find((r) => r.method === method && r.path.test(url.pathname));
      const result = route
        ? route.reply(body)
        : { status: 404, body: { code: 'NOT_FOUND', message: 'no stub', details: {} } };
      const status = result.status ?? 200;
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(result.body ?? {}), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
      );
    }),
  );
  return stub;
}
