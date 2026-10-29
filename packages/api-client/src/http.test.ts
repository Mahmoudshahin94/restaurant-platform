import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from './errors';
import { HttpClient } from './http';

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
