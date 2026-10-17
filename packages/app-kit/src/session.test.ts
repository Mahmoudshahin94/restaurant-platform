import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionClient } from './session';

const user = {
  id: '01890a5d-ac96-774b-bcce-b302099a8057',
  email: 'a@b.co',
  displayName: 'A',
  preferredLocale: 'en',
  restaurantId: '01890a5d-ac96-774b-bcce-b302099a8058',
  roles: [],
};

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSessionClient (native mode)', () => {
  it('keeps the rotating refresh token and sends it on refresh', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({
          url,
          body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        });
        if (url.endsWith('/auth/login'))
          return respond({ accessToken: 'a1', expiresIn: 900, refreshToken: 'r1', user });
        if (url.endsWith('/auth/refresh'))
          return respond({ accessToken: 'a2', expiresIn: 900, refreshToken: 'r2', user });
        return respond({}, 204);
      }),
    );
    const session = createSessionClient({ source: 'POS', mode: 'native' });
    await session.signIn('a@b.co', 'pw');
    expect(calls[0]!.body).toMatchObject({ client: 'native' });
    expect(session.useSession.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'a1',
    });

    // Concurrent refreshes share one request and present the latest token.
    await Promise.all([session.refreshSession(), session.refreshSession()]);
    const refreshes = calls.filter((c) => c.url.endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.body).toEqual({ refreshToken: 'r1' });
    expect(session.useSession.getState().accessToken).toBe('a2');

    await session.signOut();
    expect(calls.at(-1)!.body).toEqual({ refreshToken: 'r2' });
    expect(session.useSession.getState().status).toBe('anonymous');
  });

  it('becomes anonymous without a stored token instead of calling the server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const session = createSessionClient({ source: 'POS', mode: 'native' });
    expect(await session.refreshSession()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session.useSession.getState().status).toBe('anonymous');
  });
});
