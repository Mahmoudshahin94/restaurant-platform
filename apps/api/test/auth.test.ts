import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import type { ApiErrorBody } from '@pos/shared-types';
import type { TokenResponse } from '@pos/validation';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig } from './env';
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

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma);
});

function postLogin(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
}

function refreshCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
  const match = /pos_rt=([^;]+)/.exec(header);
  if (!match?.[1]) throw new Error('no refresh cookie');
  return match[1];
}

describe('POST /auth/login', () => {
  it('logs in a web client with an httpOnly SameSite=strict refresh cookie', async () => {
    const res = await postLogin({ email: tenant.owner.email.toUpperCase(), password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const body = res.json<TokenResponse>();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeUndefined();
    expect(body.user.email).toBe(tenant.owner.email);
    expect(body.user.roles[0]?.locationId).toBeNull();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login' } });
    expect(audit?.actorId).toBe(tenant.owner.id);
  });

  it('returns the refresh token in the body for native clients', async () => {
    const res = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      client: 'native',
    });
    expect(res.json<TokenResponse>().refreshToken).toBeTruthy();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a wrong password with the error envelope and audits the failure', async () => {
    const res = await postLogin({ email: tenant.owner.email, password: 'wrong' });
    expect(res.statusCode).toBe(401);
    const body = res.json<ApiErrorBody>();
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.requestId).toBe(res.headers['x-request-id']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.login_failed' } });
    expect(audit?.entityId).toBe(tenant.owner.id);
    expect(JSON.stringify(audit?.metadata)).not.toContain('wrong');
  });

  it('gives unknown emails the same answer as wrong passwords', async () => {
    const res = await postLogin({ email: 'nobody@test.local', password: PASSWORD });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects disabled accounts', async () => {
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { isActive: false } });
    const res = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(res.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
  });

  it('validates the body', async () => {
    const res = await postLogin({ email: 'not-an-email' });
    expect(res.statusCode).toBe(400);
    const body = res.json<ApiErrorBody>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details.issues).toBeInstanceOf(Array);
  });
});

describe('refresh token rotation', () => {
  it('rotates, and detects reuse by revoking the whole family', async () => {
    const login1 = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      client: 'native',
    });
    const first = login1.json<TokenResponse>().refreshToken!;

    const rotated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(rotated.statusCode).toBe(200);
    const second = rotated.json<TokenResponse>().refreshToken!;
    expect(second).not.toBe(first);

    // Move the rotation outside the benign-race grace window: this is now a replay.
    await prisma.refreshToken.updateMany({
      where: { replacedById: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json<ApiErrorBody>().code).toBe('TOKEN_REUSED');

    // The legitimate-looking newer token is revoked too.
    const afterTheft = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: second },
    });
    expect(afterTheft.json<ApiErrorBody>().code).toBe('TOKEN_REUSED');
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.refresh_token_reuse_detected' } }),
    ).toBeGreaterThan(0);
  });

  it('treats an immediate second use as a benign race and keeps the session alive', async () => {
    const res = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      client: 'native',
    });
    const first = res.json<TokenResponse>().refreshToken!;
    const rotated = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first },
    });
    const second = rotated.json<TokenResponse>().refreshToken!;

    const raced = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first },
    });
    expect(raced.statusCode).toBe(401);
    expect(raced.json<ApiErrorBody>()).toMatchObject({
      code: 'UNAUTHENTICATED',
      details: { reason: 'ROTATED' },
    });

    const stillValid = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: second },
    });
    expect(stillValid.statusCode).toBe(200);
  });

  it('only lets one of two concurrent refreshes with the same token succeed', async () => {
    const res = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      client: 'native',
    });
    const token = res.json<TokenResponse>().refreshToken!;
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          payload: { refreshToken: token },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('requires an allowed Origin when the refresh token comes from the cookie (CSRF)', async () => {
    const res = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    const cookie = refreshCookie(res.headers['set-cookie']);

    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pos_rt: cookie },
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json<ApiErrorBody>().code).toBe('CSRF_REJECTED');

    const evil = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pos_rt: cookie },
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pos_rt: cookie },
      headers: { origin: ORIGIN },
    });
    expect(ok.statusCode).toBe(200);
    expect(refreshCookie(ok.headers['set-cookie'])).not.toBe(cookie);
  });

  it('logout revokes the session', async () => {
    const res = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      client: 'native',
    });
    const token = res.json<TokenResponse>().refreshToken!;
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: token },
    });
    expect(out.statusCode).toBe(204);
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: token },
    });
    expect(again.statusCode).toBe(401);
  });
});

describe('access tokens', () => {
  it('protects routes by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().code).toBe('UNAUTHENTICATED');
  });

  it('returns the current user', async () => {
    const token = await login(app, tenant.cashier.email);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ preferredLocale: string }>().preferredLocale).toBe('ar');
  });

  it('reports expired tokens distinctly so clients know to refresh', async () => {
    const key = new TextEncoder().encode(testConfig().JWT_ACCESS_SECRET);
    const expired = await new SignJWT({ rid: tenant.restaurantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(tenant.owner.id)
      .setIssuer('pos-kds-api')
      .setAudience('pos-kds')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(expired),
    });
    expect(res.json<ApiErrorBody>().code).toBe('TOKEN_EXPIRED');
  });

  it('rejects tokens signed with another key', async () => {
    const forged = await new SignJWT({ rid: tenant.restaurantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(tenant.owner.id)
      .setIssuer('pos-kds-api')
      .setAudience('pos-kds')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(40)));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(forged),
    });
    expect(res.statusCode).toBe(401);
  });

  it('stops working once the user is disabled', async () => {
    const token = await login(app, tenant.owner.email);
    await prisma.user.update({ where: { id: tenant.owner.id }, data: { isActive: false } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) });
    expect(res.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
  });
});

describe('login rate limiting', () => {
  it('throttles repeated login attempts per IP', async () => {
    const limited = await startApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await limited.app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: tenant.owner.email, password: 'wrong' },
        });
        codes.push(res.statusCode);
        if (res.statusCode === 429) expect(res.json<ApiErrorBody>().code).toBe('RATE_LIMITED');
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.app.close();
      await limited.prisma.$disconnect();
    }
  });
});
