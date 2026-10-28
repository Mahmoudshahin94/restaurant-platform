import { platformPermissionsOf } from '@pos/shared-types';
import type { PlatformRole } from '@pos/shared-types';
import type { PlatformTenantSummary, PlatformUserDto } from '@pos/validation';
import { vi } from 'vitest';
import { useSession } from '../lib/api';

export const TID = '01a146e8-0000-7000-8000-000000000001';
export const ORDER = '01a146e8-0000-7000-8000-000000000010';

export const tenantSummary: PlatformTenantSummary = {
  id: TID,
  slug: 'demo-kitchen',
  nameEn: 'Demo Kitchen',
  nameAr: 'مطبخ تجريبي',
  businessType: 'RESTAURANT',
  status: 'ACTIVE',
  currencyCode: 'ILS',
  createdAt: '2026-10-01T00:00:00.000Z',
  locationCount: 1,
  userCount: 2,
  primaryDomain: 'demo-kitchen.madar.app',
};

/** Signs an operator of the given role in for component tests. */
export function signIn(role: PlatformRole = 'OPERATOR'): PlatformUserDto {
  const user: PlatformUserDto = {
    id: '01a146e8-0000-7000-8000-0000000000aa',
    email: 'operator@madar.test',
    displayName: 'Test Operator',
    role,
    permissions: [...platformPermissionsOf(role)],
    preferredLocale: 'en',
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
  on: (method: string, path: RegExp, reply: Route['reply'] | object) => ApiStub;
}

/**
 * Stubs `fetch` with routes matched by method and path. Unmatched requests answer 404 so a
 * missing stub shows up in the test.
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
