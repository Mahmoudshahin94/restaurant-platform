import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import { PaymentSecretsService, WebOrdersService } from '@pos/server';
import type {
  ApiErrorBody,
  LocationSnapshot,
  PairedDevice,
  PaymentProviderAccount,
  PaymentProvidersOverview,
  PublicLocation,
  WebOrderCreated,
} from '@pos/validation';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { createApp } from '../src/bootstrap';
import { testConfig } from './env';
import { type TenantFixture, bearer, createTenant, login, resetDatabase } from './helpers';
import { createMenuFixture } from './menu-fixture';

/**
 * MADAR Phase M8 (ADR 0024): payment configuration. Each tenant's provider accounts pick the
 * provider of its website card checkout (per location), its secrets are sealed and never leave
 * the API, and a business without an online provider is refused clearly.
 */
const SECRET_A = 'sk_test_AAAAsecretOfTenantA1';
const SECRET_A2 = 'sk_test_AAAAreplacedSecret22';
const SECRET_B = 'sk_test_BBBBsecretOfTenantB1';
const ALL_SECRETS = [SECRET_A, SECRET_A2, SECRET_B];
const keyB64 = () => randomBytes(32).toString('base64');

let app: NestFastifyApplication;
let prisma: PrismaClient;
let logLines: string[] = [];
let a: Business;
let b: Business;

interface Business {
  tenant: TenantFixture;
  owner: Record<string, string>;
  host: Record<string, string>;
  menu: Awaited<ReturnType<typeof createMenuFixture>>;
  hub: string;
}

/** Every log line the API writes, at every level, through its real redaction. */
const logStream = () =>
  new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString());
      done();
    },
  });

async function start(overrides: Record<string, string | undefined> = {}) {
  return createApp(
    testConfig({
      WEB_ORDER_TIMEOUT_SWEEP_SECONDS: '0',
      WEB_ORDER_RATE_LIMIT_PER_MINUTE: '100000',
      TRACKING_RATE_LIMIT_PER_MINUTE: '100000',
      ...overrides,
    }),
    { logStream: logStream() },
  );
}

beforeAll(async () => {
  app = await start();
  prisma = new PrismaClient({ datasourceUrl: testConfig().DATABASE_URL });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  logLines = [];
  a = await business();
  b = await business();
});

/** A tenant whose locations take pickup orders, with a hub online at each. */
async function business(): Promise<Business> {
  const tenant = await createTenant(prisma);
  const menu = await createMenuFixture(prisma, tenant);
  const owner = bearer(await login(app, tenant.owner.email));
  let hub = '';
  for (const locationId of [tenant.locationA, tenant.locationB]) {
    const paired = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${locationId}/devices`,
      headers: owner,
      payload: { name: 'Hub', type: 'GATEWAY' },
    });
    const device = paired.json<PairedDevice>();
    if (locationId === tenant.locationA) hub = device.credential;
    await prisma.device.update({
      where: { id: device.device.id },
      data: { status: 'ACTIVE', lastSeenAt: new Date() },
    });
    const opened = await app.inject({
      method: 'PUT',
      url: `/api/v1/locations/${locationId}/online-ordering`,
      headers: owner,
      payload: { state: 'OPEN', pickupEnabled: true },
    });
    expect(opened.statusCode, opened.body).toBe(200);
  }
  return { tenant, owner, host: { host: tenant.host }, menu, hub };
}

const providers = (who: Business) => `/api/v1/tenants/${who.tenant.tenantId}/payment-providers`;

async function addAccount(who: Business, payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: providers(who),
    headers: who.owner,
    payload: { method: 'ONLINE', providerKey: 'mock-online', mode: 'TEST', ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<PaymentProviderAccount>();
}

const overview = async (who: Business) =>
  (
    await app.inject({ method: 'GET', url: providers(who), headers: who.owner })
  ).json<PaymentProvidersOverview>();

async function cardOrder(who: Business, locationId: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: { ...who.host, 'x-client-source': 'WEBSITE' },
    payload: {
      id: newId(),
      locationId,
      fulfillment: 'PICKUP',
      customer: { name: 'Sara', phone: '+966500000001' },
      items: [who.menu.burgerLine(1)],
      payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' },
    },
  });
}

async function paymentOf(res: { json: <T>() => T }) {
  const { order } = res.json<WebOrderCreated>();
  return prisma.payment.findFirstOrThrow({ where: { orderId: order.id, type: 'CHARGE' } });
}

const publicLocation = async (who: Business, locationId: string) =>
  (
    await app.inject({
      method: 'GET',
      url: `/api/v1/public/site/locations/${locationId}`,
      headers: who.host,
    })
  ).json<PublicLocation>();

describe('provider selection per tenant and location', () => {
  it('takes card orders through the tenant’s own account; a cash-only business is refused', async () => {
    const account = await addAccount(a, { secrets: { secretKey: SECRET_A } });
    // The coffee shop had no online tender: one was created and linked to the account.
    const tender = await prisma.paymentMethod.findFirstOrThrow({
      where: { tenantId: a.tenant.tenantId, type: 'ONLINE' },
    });
    expect(tender).toMatchObject({ providerAccountId: account.id, nameEn: 'Online card' });

    const placed = await cardOrder(a, a.tenant.locationA);
    expect(placed.statusCode, placed.body).toBe(201);
    expect(await paymentOf(placed)).toMatchObject({
      provider: 'mock-online',
      providerAccountId: account.id,
      paymentMethodId: tender.id,
      status: 'CAPTURED',
    });
    expect((await publicLocation(a, a.tenant.locationA)).onlineCardEnabled).toBe(true);

    // Tenant B has no ONLINE account (cash only): no card on its site, and checkout is refused.
    expect((await publicLocation(b, b.tenant.locationA)).onlineCardEnabled).toBe(false);
    const refused = await cardOrder(b, b.tenant.locationA);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ApiErrorBody>().code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
    expect(await prisma.order.count({ where: { tenantId: b.tenant.tenantId } })).toBe(0);
    // Paying at pickup still works for the cash-only business.
    const pickup = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: b.host,
      payload: {
        id: newId(),
        locationId: b.tenant.locationA,
        fulfillment: 'PICKUP',
        customer: { name: 'Omar', phone: '+966500000002' },
        items: [b.menu.burgerLine(1)],
        payment: { option: 'PAY_AT_PICKUP' },
      },
    });
    expect(pickup.statusCode, pickup.body).toBe(201);
  });

  it('lets a location override the business-wide provider, and falls back when it is disabled', async () => {
    const tenantWide = await addAccount(a, { publicConfig: { statementDescriptor: 'A WIDE' } });
    const atB = await addAccount(a, {
      locationId: a.tenant.locationB,
      publicConfig: { statementDescriptor: 'A BRANCH B' },
    });

    expect((await paymentOf(await cardOrder(a, a.tenant.locationA))).providerAccountId).toBe(
      tenantWide.id,
    );
    expect((await paymentOf(await cardOrder(a, a.tenant.locationB))).providerAccountId).toBe(
      atB.id,
    );
    const effective = (await overview(a)).effective.filter((e) => e.method === 'ONLINE');
    expect(effective).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locationId: a.tenant.locationA,
          source: 'TENANT',
          accountId: tenantWide.id,
        }),
        expect.objectContaining({
          locationId: a.tenant.locationB,
          source: 'LOCATION',
          accountId: atB.id,
        }),
      ]),
    );

    // Disabled override: location B inherits the business-wide account again.
    await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${atB.id}`,
      headers: a.owner,
      payload: { status: 'DISABLED' },
    });
    expect((await paymentOf(await cardOrder(a, a.tenant.locationB))).providerAccountId).toBe(
      tenantWide.id,
    );
    // And without the business-wide account, nothing takes cards anywhere.
    await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${tenantWide.id}`,
      headers: a.owner,
      payload: { status: 'DISABLED' },
    });
    expect((await cardOrder(a, a.tenant.locationA)).json<ApiErrorBody>().code).toBe(
      'ONLINE_PAYMENT_UNAVAILABLE',
    );
  });

  it('keeps one active account per method and scope, and validates against the catalog', async () => {
    await addAccount(a, {});
    const second = await app.inject({
      method: 'POST',
      url: providers(a),
      headers: a.owner,
      payload: { method: 'ONLINE', providerKey: 'mock-online', mode: 'TEST' },
    });
    expect(second.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'ACTIVE_ACCOUNT_EXISTS' },
    });
    const cases: [Record<string, unknown>, string][] = [
      [{ method: 'ONLINE', providerKey: 'stripe', mode: 'TEST' }, 'UNKNOWN_PROVIDER'],
      [{ method: 'TERMINAL', providerKey: 'mock-online', mode: 'TEST' }, 'WRONG_METHOD'],
      [{ method: 'CASH', providerKey: 'cash', mode: 'LIVE' }, 'BUILT_IN'],
      [{ method: 'ONLINE', providerKey: 'mock-online', mode: 'LIVE' }, 'MODE_NOT_SUPPORTED'],
      [
        { method: 'TERMINAL', providerKey: 'mock-terminal', mode: 'TEST', publicConfig: { x: 1 } },
        'INVALID_CONFIG',
      ],
      [
        { method: 'TERMINAL', providerKey: 'mock-terminal', mode: 'TEST', secrets: { k: 'v' } },
        'NO_SECRETS',
      ],
    ];
    for (const [payload, reason] of cases) {
      const res = await app.inject({
        method: 'POST',
        url: providers(b),
        headers: b.owner,
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(res.json<ApiErrorBody>()).toMatchObject({
        code: 'PAYMENT_PROVIDER_INVALID',
        details: { reason },
      });
    }
  });
});

describe('secrets are write-only (ADR 0024)', () => {
  it('never returns, logs, audits, snapshots or syncs a secret', async () => {
    const created = await app.inject({
      method: 'POST',
      url: providers(a),
      headers: a.owner,
      payload: {
        method: 'ONLINE',
        providerKey: 'mock-online',
        mode: 'TEST',
        secrets: { secretKey: SECRET_A },
      },
    });
    const account = created.json<PaymentProviderAccount>();
    expect(account.secret).toMatchObject({
      hasSecret: true,
      fingerprint: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
    const bodies = [created.body];

    // Updating without secrets keeps them; with new ones replaces them (a new fingerprint).
    const kept = await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${account.id}`,
      headers: a.owner,
      payload: { publicConfig: { statementDescriptor: 'DEMO' } },
    });
    expect(kept.json<PaymentProviderAccount>().secret.fingerprint).toBe(account.secret.fingerprint);
    const replaced = await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${account.id}`,
      headers: a.owner,
      payload: { secrets: { secretKey: SECRET_A2 } },
    });
    expect(replaced.json<PaymentProviderAccount>().secret.fingerprint).not.toBe(
      account.secret.fingerprint,
    );
    // A refused secret is not echoed either (paths and codes only).
    const refused = await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${account.id}`,
      headers: a.owner,
      payload: { secrets: { secretKey: `${SECRET_B}!` } },
    });
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID',
      details: { reason: 'INVALID_SECRETS', issues: [{ path: 'secretKey' }] },
    });
    bodies.push(kept.body, replaced.body, refused.body);
    bodies.push((await app.inject({ method: 'GET', url: providers(a), headers: a.owner })).body);

    // The secret is used: a card order goes through the account's configured adapter.
    const placed = await cardOrder(a, a.tenant.locationA);
    expect(placed.statusCode, placed.body).toBe(201);
    const { order } = placed.json<WebOrderCreated>();

    // The hub's view: its snapshot and the order it fetches carry the account, never its secret.
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/snapshot',
      headers: { authorization: `Device ${a.hub}` },
    });
    expect(snapshot.statusCode).toBe(200);
    const tables = snapshot.json<LocationSnapshot>().tables;
    expect(tables.paymentProviderAccounts).toEqual([
      expect.objectContaining({ id: account.id, providerKey: 'mock-online', mode: 'TEST' }),
    ]);
    const hubOrder = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/orders/${order.id}`,
      headers: { authorization: `Device ${a.hub}` },
    });
    expect(hubOrder.statusCode).toBe(200);
    bodies.push(snapshot.body, hubOrder.body);

    const audits = await prisma.auditLog.findMany({ where: { tenantId: a.tenant.tenantId } });
    expect(audits.map((x) => x.action)).toEqual(
      expect.arrayContaining(['payment_provider.created', 'payment_provider.updated']),
    );
    const stored = await prisma.paymentProviderSecret.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    const everything = [
      ...bodies,
      JSON.stringify(audits),
      logLines.join(''),
      Buffer.from(stored.ciphertext).toString('latin1'),
      Buffer.from(stored.wrappedKey).toString('latin1'),
      JSON.stringify(await prisma.paymentProviderAccount.findMany()),
    ].join('\n');
    expect(logLines.length).toBeGreaterThan(0);
    // (The catalog's field hint `sk_test_…` is in the answers; no secret value is.)
    for (const secret of ALL_SECRETS) expect(everything).not.toContain(secret);
  });

  it('refuses a ciphertext swapped between tenants', async () => {
    const mine = await addAccount(a, { secrets: { secretKey: SECRET_A } });
    const theirs = await addAccount(b, { secrets: { secretKey: SECRET_B } });
    // Someone with database access copies tenant B's sealed secret onto tenant A's account.
    await prisma.$executeRaw`
      UPDATE payment_provider_secrets AS mine
      SET ciphertext = theirs.ciphertext, wrapped_key = theirs.wrapped_key
      FROM payment_provider_secrets AS theirs
      WHERE mine.account_id = ${mine.id}::uuid AND theirs.account_id = ${theirs.id}::uuid`;
    const res = await cardOrder(a, a.tenant.locationA);
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'PAYMENT_FAILED',
      details: { reason: 'PROVIDER_SECRET_UNREADABLE' },
    });
    expect(await prisma.payment.count({ where: { tenantId: a.tenant.tenantId } })).toBe(0);
    expect(await prisma.order.count({ where: { tenantId: a.tenant.tenantId } })).toBe(0);
    // Tenant B's own account still works: nothing was decrypted with another tenant's scope.
    expect((await cardOrder(b, b.tenant.locationA)).statusCode).toBe(201);
    expect(logLines.join('')).not.toContain(SECRET_B);
  });
});

describe('tenant isolation of provider accounts', () => {
  it('tenant A cannot read or change tenant B’s accounts', async () => {
    const theirs = await addAccount(b, { secrets: { secretKey: SECRET_B } });
    const read = await app.inject({ method: 'GET', url: providers(b), headers: a.owner });
    expect(read.statusCode).toBe(404);
    const viaOwnTenant = await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${theirs.id}`,
      headers: a.owner,
      payload: { status: 'DISABLED' },
    });
    expect(viaOwnTenant.statusCode).toBe(404);
    expect(viaOwnTenant.json<ApiErrorBody>().code).toBe('PAYMENT_PROVIDER_NOT_FOUND');
    const viaTheirTenant = await app.inject({
      method: 'PATCH',
      url: `${providers(b)}/${theirs.id}`,
      headers: a.owner,
      payload: { status: 'DISABLED' },
    });
    expect(viaTheirTenant.statusCode).toBe(404);
    // Nor link a tender to it, nor scope an account to B's location.
    const tender = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${a.tenant.tenantId}/payment-methods`,
      headers: a.owner,
      payload: { type: 'ONLINE', nameEn: 'Web', nameAr: 'ويب', providerAccountId: theirs.id },
    });
    expect(tender.json<ApiErrorBody>().code).toBe('PAYMENT_PROVIDER_NOT_FOUND');
    const foreignLocation = await app.inject({
      method: 'POST',
      url: providers(a),
      headers: a.owner,
      payload: {
        method: 'ONLINE',
        providerKey: 'mock-online',
        mode: 'TEST',
        locationId: b.tenant.locationA,
      },
    });
    expect(foreignLocation.statusCode).toBe(404);
    expect(
      (await prisma.paymentProviderAccount.findUniqueOrThrow({ where: { id: theirs.id } })).status,
    ).toBe('ACTIVE');
    expect((await overview(a)).accounts).toEqual([]);
  });

  it('is for the business’s administrators only: a location role cannot see it', async () => {
    const cashier = bearer(await login(app, a.tenant.cashier.email));
    const res = await app.inject({ method: 'GET', url: providers(a), headers: cashier });
    expect(res.statusCode).toBe(403);
  });
});

describe('voids go back through the account that took the charge', () => {
  it('voids a timed-out order through its (since disabled) account', async () => {
    const account = await addAccount(a, {});
    const placed = await cardOrder(a, a.tenant.locationA);
    const { order } = placed.json<WebOrderCreated>();
    await app.inject({
      method: 'PATCH',
      url: `${providers(a)}/${account.id}`,
      headers: a.owner,
      payload: { status: 'DISABLED' },
    });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(
      await app
        .get(WebOrdersService)
        .cancelExpired(new Date((row.acceptBy?.getTime() ?? 0) + 60_000)),
    ).toBe(1);
    const voided = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id, type: 'REFUND' },
    });
    // CAPTURED: the provider confirmed the void, so it was found and configured.
    expect(voided).toMatchObject({ providerAccountId: account.id, status: 'CAPTURED' });
  });
});

describe('master key (PAYMENT_SECRETS_KEY)', () => {
  let other: NestFastifyApplication | null = null;
  afterEach(async () => {
    await other?.close();
    other = null;
  });

  it('rotation re-encrypts under the new version; old versions still open until then', async () => {
    const v1 = keyB64();
    const v2 = keyB64();
    await app.close();
    app = await start({ PAYMENT_SECRETS_KEY: `1:${v1}` });
    const account = await addAccount(a, { secrets: { secretKey: SECRET_A } });
    const before = await prisma.paymentProviderSecret.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    expect(before.keyVersion).toBe(1);

    await app.close();
    app = await start({ PAYMENT_SECRETS_KEY: `1:${v1},2:${v2}` });
    // Not yet rotated: the version-1 secret still opens.
    expect((await cardOrder(a, a.tenant.locationA)).statusCode).toBe(201);
    const rotation = await app.get(PaymentSecretsService).rotateAll();
    expect(rotation).toEqual({ rotated: 1, failed: 0, currentVersion: 2 });
    const after = await prisma.paymentProviderSecret.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    expect(after.keyVersion).toBe(2);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(Buffer.from(after.ciphertext).equals(Buffer.from(before.ciphertext))).toBe(false);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    await expect(app.get(PaymentSecretsService).rotateAll()).resolves.toMatchObject({ rotated: 0 });

    // Version 1 retired: the re-encrypted secret opens with version 2 alone.
    await app.close();
    app = await start({ PAYMENT_SECRETS_KEY: `2:${v2}` });
    expect((await cardOrder(a, a.tenant.locationA)).statusCode).toBe(201);

    // Without the key that sealed it, a secret does not open: the charge is refused.
    await app.close();
    app = await start({ PAYMENT_SECRETS_KEY: `3:${keyB64()}` });
    expect((await cardOrder(a, a.tenant.locationA)).json<ApiErrorBody>()).toMatchObject({
      details: { reason: 'PROVIDER_SECRET_UNREADABLE' },
    });
    await app.close();
    app = await start();
  });

  it('production refuses to start without a key, and offers no test adapters', async () => {
    const production = {
      NODE_ENV: 'production',
      PLATFORM_WEB_DOMAIN: 'madar.app',
      WEBSITE_URL: 'https://{domain}',
      DOMAIN_VERIFIER: 'dns',
    };
    // The real module graph, without Nest aborting the test process on the start-up error.
    await expect(
      NestFactory.createApplicationContext(AppModule.forRoot(testConfig(production)), {
        abortOnError: false,
        logger: false,
      }),
    ).rejects.toThrow('PAYMENT_SECRETS_KEY is required in production');
    // The development defaults are refused by the configuration itself.
    expect(() =>
      testConfig({
        ...production,
        PAYMENT_SECRETS_KEY: keyB64(),
        DEV_PAYMENT_PROVIDERS: 'mock-online',
      }),
    ).toThrow('DEV_PAYMENT_PROVIDERS');

    other = await start({ ...production, PAYMENT_SECRETS_KEY: keyB64() });
    const owner = bearer(await login(other, a.tenant.owner.email));
    const view = (
      await other.inject({ method: 'GET', url: providers(a), headers: owner })
    ).json<PaymentProvidersOverview>();
    expect(view.catalog.filter((c) => c.devOnly)).toEqual([]);
    const res = await other.inject({
      method: 'POST',
      url: providers(a),
      headers: owner,
      payload: { method: 'ONLINE', providerKey: 'mock-online', mode: 'TEST' },
    });
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'PAYMENT_PROVIDER_INVALID',
      details: { reason: 'UNKNOWN_PROVIDER' },
    });
  });
});
