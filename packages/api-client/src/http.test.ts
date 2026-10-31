import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from './errors';
import { createApiClient } from './client';
import { HttpClient } from './http';
import { createPlatformApiClient } from './platform';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const schema = z.object({ ok: z.boolean() });

describe('HttpClient', () => {
  it('sends the bearer token and source header, and parses with the schema', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(200, { ok: true }));
    const client = new HttpClient({
      baseUrl: 'http://api.test',
      source: 'ADMIN',
      getAccessToken: () => 'abc',
      validateResponses: true,
      fetchImpl,
    });
    await expect(
      client.request('GET', '/x', { schema, query: { a: 1, b: undefined } }),
    ).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/x?a=1');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer abc');
    expect((init?.headers as Record<string, string>)['x-client-source']).toBe('ADMIN');
  });

  it('reports its MADAR version, and hands an upgrade refusal to the app (ADR 0026)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json(426, {
        code: 'CLIENT_UPGRADE_REQUIRED',
        message: 'too old',
        details: { minimumVersion: '1.1.0', version: '1.0.0' },
      }),
    );
    const onUpgradeRequired = vi.fn();
    const client = new HttpClient({
      baseUrl: '',
      source: 'ADMIN',
      getAccessToken: () => null,
      clientVersion: '1.0.0',
      onUpgradeRequired,
      fetchImpl,
    });
    await expect(client.request('GET', '/x')).rejects.toMatchObject({
      code: 'CLIENT_UPGRADE_REQUIRED',
      status: 426,
    });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['x-madar-client-version']).toBe('1.0.0');
    expect(onUpgradeRequired).toHaveBeenCalledOnce();
    expect(onUpgradeRequired.mock.calls[0]![0]).toMatchObject({
      details: { minimumVersion: '1.1.0' },
    });
  });

  it('turns error envelopes into typed ApiErrors', async () => {
    const client = new HttpClient({
      baseUrl: '',
      source: 'ADMIN',
      getAccessToken: () => null,
      fetchImpl: () =>
        Promise.resolve(
          json(403, {
            code: 'INSUFFICIENT_PERMISSION',
            message: 'no',
            details: { missing: ['x'] },
            requestId: 'r1',
          }),
        ),
    });
    const error = await client.request('GET', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'INSUFFICIENT_PERMISSION',
      status: 403,
      requestId: 'r1',
      details: { missing: ['x'] },
    });
  });

  it('maps transport failures to NETWORK_ERROR', async () => {
    const client = new HttpClient({
      baseUrl: '',
      source: 'POS',
      getAccessToken: () => null,
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(client.request('GET', '/x')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('refreshes once on TOKEN_EXPIRED and retries, sharing the refresh across concurrent calls', async () => {
    let token = 'old';
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      const auth = (init?.headers as Record<string, string>).authorization;
      return Promise.resolve(
        auth === 'Bearer new'
          ? json(200, { ok: true })
          : json(401, { code: 'TOKEN_EXPIRED', message: 'exp', details: {} }),
      );
    });
    const refreshSession = vi.fn(async () => {
      await Promise.resolve();
      token = 'new';
      return true;
    });
    const client = new HttpClient({
      baseUrl: '',
      source: 'ADMIN',
      getAccessToken: () => token,
      refreshSession,
      fetchImpl,
    });
    const results = await Promise.all([
      client.request('GET', '/a', { schema }),
      client.request('GET', '/b', { schema }),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not loop when refresh fails', async () => {
    const client = new HttpClient({
      baseUrl: '',
      source: 'ADMIN',
      getAccessToken: () => 'x',
      refreshSession: () => Promise.resolve(false),
      fetchImpl: () =>
        Promise.resolve(json(401, { code: 'TOKEN_EXPIRED', message: 'exp', details: {} })),
    });
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('rejects responses that break the contract when validation is on', async () => {
    const client = new HttpClient({
      baseUrl: '',
      source: 'ADMIN',
      getAccessToken: () => null,
      validateResponses: true,
      fetchImpl: () => Promise.resolve(json(200, { ok: 'yes' })),
    });
    await expect(client.request('GET', '/x', { schema })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

/** Calls one client method against a stub that answers `{}` (validation is off) and returns the request. */
async function sent(
  make: typeof createApiClient | typeof createPlatformApiClient,
  call: (api: never) => Promise<unknown>,
) {
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(json(200, {})));
  const api = make({
    baseUrl: 'http://api.test',
    source: 'ADMIN',
    getAccessToken: () => 't',
    fetchImpl,
  });
  await call(api as never);
  const [url, init] = fetchImpl.mock.calls[0]!;
  return {
    method: init?.method,
    url: url as string,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

const org = 'o1';
const range = { from: '2026-10-01', to: '2026-10-31' };

describe('organization and brand-switching paths (E1)', () => {
  const tenantApi = (call: (api: ReturnType<typeof createApiClient>) => Promise<unknown>) =>
    sent(createApiClient, call);
  const platformApi = (
    call: (api: ReturnType<typeof createPlatformApiClient>) => Promise<unknown>,
  ) => sent(createPlatformApiClient, call);

  it('switches brand, with the refresh token only for native clients', async () => {
    await expect(tenantApi((a) => a.auth.switch('t2'))).resolves.toMatchObject({
      method: 'POST',
      url: 'http://api.test/api/v1/auth/switch',
      body: { tenantId: 't2' },
    });
    const native = await tenantApi((a) => a.auth.switch('t2', 'rt'));
    expect(native.body).toEqual({ tenantId: 't2', refreshToken: 'rt' });
    const web = await tenantApi((a) => a.auth.switch('t2'));
    expect(web.body).toEqual({ tenantId: 't2' });
  });

  it('reads an organization, its dashboard and its reports', async () => {
    const base = `http://api.test/api/v1/organizations/${org}`;
    expect((await tenantApi((a) => a.organizations.get(org))).url).toBe(base);
    expect((await tenantApi((a) => a.organizations.dashboard(org))).url).toBe(`${base}/dashboard`);
    const reports = {
      dailySales: 'daily-sales',
      brands: 'brands',
      locations: 'locations',
      channels: 'channels',
      payments: 'payments',
      products: 'products',
      categories: 'categories',
    } as const;
    for (const [method, path] of Object.entries(reports)) {
      const request = await tenantApi((a) =>
        a.organizations.reports[method as keyof typeof reports](org, {
          ...range,
          tenantIds: ['t1', 't2'],
          locationIds: ['l1'],
          channels: ['DINE_IN'],
        }),
      );
      expect(request.method).toBe('GET');
      expect(request.url).toBe(
        `${base}/reports/${path}?from=2026-10-01&to=2026-10-31&locationIds=l1&channels=DINE_IN&tenantIds=t1%2Ct2`,
      );
    }
    // Empty filters are left out.
    const bare = await tenantApi((a) =>
      a.organizations.reports.brands(org, { ...range, tenantIds: [] }),
    );
    expect(bare.url).toBe(`${base}/reports/brands?from=2026-10-01&to=2026-10-31`);
  });

  it("manages an organization's members", async () => {
    const base = `http://api.test/api/v1/organizations/${org}/members`;
    expect(await tenantApi((a) => a.organizations.members.list(org))).toMatchObject({
      method: 'GET',
      url: base,
    });
    const body = { email: 'a@b.test', displayName: 'A', role: 'FINANCE' as const };
    expect(await tenantApi((a) => a.organizations.members.add(org, body))).toMatchObject({
      method: 'POST',
      url: base,
      body,
    });
    expect(
      await tenantApi((a) => a.organizations.members.changeRole(org, 'm1', { role: 'MANAGER' })),
    ).toMatchObject({ method: 'PATCH', url: `${base}/m1`, body: { role: 'MANAGER' } });
    expect(await tenantApi((a) => a.organizations.members.remove(org, 'm1'))).toMatchObject({
      method: 'DELETE',
      url: `${base}/m1`,
    });
  });

  it('manages organizations as a platform operator', async () => {
    const base = 'http://api.test/api/v1/platform/organizations';
    expect(
      await platformApi((a) => a.organizations.list({ search: 'x', status: 'ACTIVE', page: 2 })),
    ).toMatchObject({ method: 'GET', url: `${base}?search=x&status=ACTIVE&page=2` });
    const create = {
      slug: 'demo',
      nameEn: 'Demo',
      nameAr: 'تجريبي',
      currencyCode: 'SAR',
      owner: { email: 'o@d.test', displayName: 'O' },
    };
    expect(await platformApi((a) => a.organizations.create(create))).toMatchObject({
      method: 'POST',
      url: base,
      body: create,
    });
    expect(await platformApi((a) => a.organizations.get(org))).toMatchObject({
      method: 'GET',
      url: `${base}/${org}`,
    });
    expect(await platformApi((a) => a.organizations.update(org, { nameEn: 'New' }))).toMatchObject({
      method: 'PATCH',
      url: `${base}/${org}`,
      body: { nameEn: 'New' },
    });
    expect(await platformApi((a) => a.organizations.attach(org, 't1'))).toMatchObject({
      method: 'POST',
      url: `${base}/${org}/tenants`,
      body: { tenantId: 't1' },
    });
    expect(await platformApi((a) => a.organizations.detach(org, 't1'))).toMatchObject({
      method: 'DELETE',
      url: `${base}/${org}/tenants/t1`,
    });
    expect(await platformApi((a) => a.organizations.members.list(org))).toMatchObject({
      method: 'GET',
      url: `${base}/${org}/members`,
    });
    const member = { email: 'a@b.test', displayName: 'A', role: 'OWNER' as const };
    expect(await platformApi((a) => a.organizations.members.add(org, member))).toMatchObject({
      method: 'POST',
      url: `${base}/${org}/members`,
      body: member,
    });
    expect(
      await platformApi((a) => a.organizations.members.changeRole(org, 'm1', { role: 'FINANCE' })),
    ).toMatchObject({
      method: 'PATCH',
      url: `${base}/${org}/members/m1`,
      body: { role: 'FINANCE' },
    });
    expect(await platformApi((a) => a.organizations.members.remove(org, 'm1'))).toMatchObject({
      method: 'DELETE',
      url: `${base}/${org}/members/m1`,
    });
  });

  it('lists brands by organization and provisions into one', async () => {
    const list = await platformApi((a) => a.tenants.list({ organizationId: org }));
    expect(list.url).toBe(`http://api.test/api/v1/platform/tenants?organizationId=${org}`);
    const body = {
      slug: 'b',
      nameEn: 'B',
      nameAr: 'ب',
      businessType: 'RESTAURANT' as const,
      organizationId: org,
    };
    const provision = await platformApi((a) => a.tenants.provision(body as never));
    expect(provision.body).toMatchObject({ organizationId: org });
  });
});
