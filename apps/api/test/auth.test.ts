import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import type { ApiErrorBody } from '@pos/shared-types';
import type { TokenResponse } from '@pos/validation';
import { newId } from '@pos/domain';
import { SignJWT, decodeJwt } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig } from './env';
import {
  ORIGIN,
  PASSWORD,
  type TenantFixture,
  addAccountUser,
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

/** The tenant the access token of a sign-in response is for. */
function tidOf(res: Awaited<ReturnType<typeof postLogin>>): unknown {
  return decodeJwt(res.json<TokenResponse>().accessToken).tid;
}

describe('sign-in through accounts', () => {
  let brandB: TenantFixture;
  let ownerInB: string;

  beforeEach(async () => {
    brandB = await createTenant(prisma);
    ownerInB = await addAccountUser(prisma, tenant.owner.email, brandB);
  });

  it("login returns the account's brands", async () => {
    const res = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const { user } = res.json<TokenResponse>();
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: tenant.owner.email },
    });
    expect(user.accountId).toBe(account.id);
    expect(user.tenants.map((t) => t.id).sort()).toEqual([tenant.tenantId, brandB.tenantId].sort());
    expect(user.tenants.find((t) => t.id === brandB.tenantId)).toEqual({
      id: brandB.tenantId,
      nameEn: 'Test Tenant',
      nameAr: 'مطعم تجريبي',
      logoFileId: null,
      organizationId: null,
    });
    expect(user.organizations).toEqual([]);

    // The same lists on /auth/me; a one-brand person gets one entry.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(res.json<TokenResponse>().accessToken),
    });
    expect(me.json<TokenResponse['user']>().tenants).toHaveLength(2);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pos_rt: refreshCookie(res.headers['set-cookie']) },
      headers: { origin: ORIGIN },
    });
    expect(refreshed.json<TokenResponse>().user.tenants).toHaveLength(2);
    const cashier = await postLogin({ email: tenant.cashier.email, password: PASSWORD });
    expect(cashier.json<TokenResponse>().user.tenants.map((t) => t.id)).toEqual([tenant.tenantId]);
  });

  it('login honours tenantId, then the last brand', async () => {
    const chosen = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      tenantId: brandB.tenantId,
    });
    expect(chosen.statusCode).toBe(200);
    expect(tidOf(chosen)).toBe(brandB.tenantId);
    expect(chosen.json<TokenResponse>().user.id).toBe(ownerInB);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login', tenantId: brandB.tenantId },
    });
    expect(audit?.actorId).toBe(ownerInB);

    const again = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(tidOf(again)).toBe(brandB.tenantId);
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: tenant.owner.email },
    });
    expect(account.lastTenantId).toBe(brandB.tenantId);
  });

  it('a stale last brand falls back', async () => {
    await postLogin({ email: tenant.owner.email, password: PASSWORD, tenantId: brandB.tenantId });
    await prisma.user.update({ where: { id: ownerInB }, data: { isActive: false } });
    const res = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(tidOf(res)).toBe(tenant.tenantId);
    expect(res.json<TokenResponse>().user.tenants.map((t) => t.id)).toEqual([tenant.tenantId]);
    // Asking for the brand of the deactivated user is ignored the same way.
    const asked = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      tenantId: brandB.tenantId,
    });
    expect(tidOf(asked)).toBe(tenant.tenantId);

    // A suspended last brand too.
    await prisma.user.update({ where: { id: ownerInB }, data: { isActive: true } });
    await prisma.account.update({
      where: { email: tenant.owner.email },
      data: { lastTenantId: brandB.tenantId },
    });
    await prisma.tenant.update({ where: { id: brandB.tenantId }, data: { status: 'SUSPENDED' } });
    const suspended = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(tidOf(suspended)).toBe(tenant.tenantId);
  });

  it('no usable brand is ACCOUNT_DISABLED', async () => {
    await prisma.user.updateMany({
      where: { id: { in: [tenant.owner.id, ownerInB] } },
      data: { isActive: false },
    });
    const disabled = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
    expect(disabled.body).not.toContain(tenant.tenantId);
    expect(disabled.body).not.toContain(brandB.tenantId);

    await prisma.user.updateMany({
      where: { id: { in: [tenant.owner.id, ownerInB] } },
      data: { isActive: true },
    });
    await prisma.tenant.updateMany({
      where: { id: { in: [tenant.tenantId, brandB.tenantId] } },
      data: { status: 'SUSPENDED' },
    });
    const suspended = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    expect(suspended.statusCode).toBe(403);
    expect(suspended.json<ApiErrorBody>().code).toBe('TENANT_SUSPENDED');
    expect(suspended.body).not.toContain(tenant.tenantId);
    expect(suspended.body).not.toContain(brandB.tenantId);
  });

  it('e-mail is trimmed and case-insensitive', async () => {
    const res = await postLogin({
      email: `  ${tenant.owner.email.replace('owner', 'Owner').toUpperCase()} `,
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<TokenResponse>().user.email).toBe(tenant.owner.email);
  });

  it('a login for another tenant id is ignored, not an error', async () => {
    const foreign = await createTenant(prisma);
    const res = await postLogin({
      email: tenant.cashier.email,
      password: PASSWORD,
      tenantId: foreign.tenantId,
    });
    expect(res.statusCode).toBe(200);
    expect(tidOf(res)).toBe(tenant.tenantId);
    expect(res.json<TokenResponse>().user.id).toBe(tenant.cashier.id);
  });

  it("a linked user counts only while the brand's organization is active", async () => {
    const organization = await prisma.organization.create({
      data: {
        slug: `org-${brandB.tenantId.slice(-8)}`,
        nameEn: 'Group',
        nameAr: 'المجموعة',
        currencyCode: 'SAR',
      },
    });
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: tenant.owner.email },
    });
    const member = await prisma.organizationMember.create({
      data: { organizationId: organization.id, accountId: account.id, role: 'FINANCE' },
    });
    await prisma.tenant.update({
      where: { id: brandB.tenantId },
      data: { organizationId: organization.id },
    });
    await prisma.user.update({
      where: { id: ownerInB },
      data: { organizationMemberId: member.id },
    });

    const active = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      tenantId: brandB.tenantId,
    });
    expect(tidOf(active)).toBe(brandB.tenantId);
    const { user } = active.json<TokenResponse>();
    expect(user.tenants.find((t) => t.id === brandB.tenantId)?.organizationId).toBe(
      organization.id,
    );
    expect(user.organizations).toEqual([
      { id: organization.id, nameEn: 'Group', nameAr: 'المجموعة', role: 'FINANCE' },
    ]);

    await prisma.organization.update({
      where: { id: organization.id },
      data: { status: 'SUSPENDED' },
    });
    const suspended = await postLogin({
      email: tenant.owner.email,
      password: PASSWORD,
      tenantId: brandB.tenantId,
    });
    expect(tidOf(suspended)).toBe(tenant.tenantId);
    expect(suspended.json<TokenResponse>().user.tenants.map((t) => t.id)).toEqual([
      tenant.tenantId,
    ]);
    expect(suspended.json<TokenResponse>().user.organizations).toEqual([]);
  });
});

describe('POST /auth/switch', () => {
  let brandB: TenantFixture;
  let ownerInB: string;

  beforeEach(async () => {
    brandB = await createTenant(prisma);
    ownerInB = await addAccountUser(prisma, tenant.owner.email, brandB);
  });

  const signIn = async (client: 'web' | 'native' = 'native') =>
    (
      await postLogin({ email: tenant.owner.email, password: PASSWORD, client })
    ).json<TokenResponse>();

  const postSwitch = (
    accessToken: string,
    payload: Record<string, unknown>,
    extra: { cookies?: Record<string, string>; headers?: Record<string, string> } = {},
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch',
      payload,
      headers: { ...bearer(accessToken), ...extra.headers },
      cookies: extra.cookies,
    });

  it("switch issues a session for the account's user in the other brand", async () => {
    const first = await signIn();
    expect(first.user.tenantId).toBe(tenant.tenantId);

    const res = await postSwitch(first.accessToken, {
      tenantId: brandB.tenantId,
      refreshToken: first.refreshToken,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<TokenResponse>();
    expect(decodeJwt(body.accessToken).tid).toBe(brandB.tenantId);
    expect(body.user.id).toBe(ownerInB);
    expect(body.user.tenantId).toBe(brandB.tenantId);
    expect(body.user.tenants).toHaveLength(2);
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(first.refreshToken);

    // The old session is gone: its refresh token is revoked.
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(old.statusCode).toBe(401);
    expect(['TOKEN_REUSED', 'UNAUTHENTICATED']).toContain(old.json<ApiErrorBody>().code);

    // The new token works, in the new brand; the new refresh token starts a fresh family.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: bearer(body.accessToken),
    });
    expect(me.json<TokenResponse['user']>().id).toBe(ownerInB);
    const families = await prisma.refreshToken.findMany({
      where: { userId: { in: [first.user.id, ownerInB] } },
    });
    expect(new Set(families.map((t) => t.familyId)).size).toBe(2);

    // One audit entry in each brand, and the account remembers the brand.
    const inA = await prisma.auditLog.findFirst({
      where: { action: 'auth.switch', tenantId: tenant.tenantId },
    });
    const inB = await prisma.auditLog.findFirst({
      where: { action: 'auth.switch', tenantId: brandB.tenantId },
    });
    expect(inA?.actorId).toBe(first.user.id);
    expect(inA?.metadata).toMatchObject({ toTenantId: brandB.tenantId });
    expect(inB?.actorId).toBe(ownerInB);
    expect(inB?.metadata).toMatchObject({ fromTenantId: tenant.tenantId });
    const account = await prisma.account.findUniqueOrThrow({
      where: { email: tenant.owner.email },
    });
    expect(account.lastTenantId).toBe(brandB.tenantId);

    // And back again.
    const back = await postSwitch(body.accessToken, {
      tenantId: tenant.tenantId,
      refreshToken: body.refreshToken,
    });
    expect(back.statusCode).toBe(200);
    expect(back.json<TokenResponse>().user.id).toBe(first.user.id);
  });

  it('a web client sends and receives the refresh cookie (with the Origin check)', async () => {
    const login1 = await postLogin({ email: tenant.owner.email, password: PASSWORD });
    const cookie = refreshCookie(login1.headers['set-cookie']);
    const { accessToken } = login1.json<TokenResponse>();

    const forged = await postSwitch(
      accessToken,
      { tenantId: brandB.tenantId },
      { cookies: { pos_rt: cookie }, headers: { origin: 'https://evil.example' } },
    );
    expect(forged.statusCode).toBe(403);
    expect(forged.json<ApiErrorBody>().code).toBe('CSRF_REJECTED');

    const res = await postSwitch(
      accessToken,
      { tenantId: brandB.tenantId },
      { cookies: { pos_rt: cookie }, headers: { origin: ORIGIN } },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<TokenResponse>().refreshToken).toBeUndefined();
    const next = refreshCookie(res.headers['set-cookie']);
    expect(next).not.toBe(cookie);
    expect(res.json<TokenResponse>().user.tenantId).toBe(brandB.tenantId);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          cookies: { pos_rt: next },
          headers: { origin: ORIGIN },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("another person's refresh token is not revoked", async () => {
    const mine = await signIn();
    const other = await postLogin({
      email: tenant.cashier.email,
      password: PASSWORD,
      client: 'native',
    });
    const res = await postSwitch(mine.accessToken, {
      tenantId: brandB.tenantId,
      refreshToken: other.json<TokenResponse>().refreshToken,
    });
    expect(res.statusCode).toBe(200);
    const stillGood = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: other.json<TokenResponse>().refreshToken },
    });
    expect(stillGood.statusCode).toBe(200);
  });

  it('switching to the current brand issues a fresh session', async () => {
    const first = await signIn();
    const res = await postSwitch(first.accessToken, {
      tenantId: tenant.tenantId,
      refreshToken: first.refreshToken,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<TokenResponse>().user.id).toBe(first.user.id);
    expect(res.json<TokenResponse>().refreshToken).not.toBe(first.refreshToken);
  });

  it('switch to a brand of another account is 404', async () => {
    const stranger = await createTenant(prisma);
    const first = await signIn();
    const res = await postSwitch(first.accessToken, {
      tenantId: stranger.tenantId,
      refreshToken: first.refreshToken,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
    // A refused switch keeps the session.
    const kept = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: first.refreshToken },
    });
    expect(kept.statusCode).toBe(200);
    const unknown = await postSwitch(first.accessToken, { tenantId: newId() });
    expect(unknown.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
  });

  it("switch to a deactivated user's brand is 404", async () => {
    const first = await signIn();
    await prisma.user.update({ where: { id: ownerInB }, data: { isActive: false } });
    const res = await postSwitch(first.accessToken, { tenantId: brandB.tenantId });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
    await prisma.user.update({ where: { id: ownerInB }, data: { isActive: true } });
    await prisma.tenant.update({ where: { id: brandB.tenantId }, data: { status: 'SUSPENDED' } });
    const suspended = await postSwitch(first.accessToken, { tenantId: brandB.tenantId });
    expect(suspended.statusCode).toBe(404);
  });

  it('switch without a token is 401, and the body is validated', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch',
      payload: { tenantId: brandB.tenantId },
    });
    expect(anon.statusCode).toBe(401);
    expect(anon.json<ApiErrorBody>().code).toBe('UNAUTHENTICATED');

    const first = await signIn();
    const bad = await postSwitch(first.accessToken, { tenantId: 'not-an-id' });
    expect(bad.statusCode).toBe(400);
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
    const expired = await new SignJWT({ tid: tenant.tenantId })
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
    const forged = await new SignJWT({ tid: tenant.tenantId })
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
