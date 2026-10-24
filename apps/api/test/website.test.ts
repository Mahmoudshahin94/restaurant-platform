import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import {
  DOMAIN_VERIFIER,
  type MockDomainVerifier,
  TrackingTokens,
  WebsitePreviewTokens,
  loadConfig,
  previewSecret,
  trackingSecret,
} from '@pos/server';
import { type ApiErrorBody, WebsiteSectionType } from '@pos/shared-types';
import {
  type PairedDevice,
  type PublicSite,
  type TenantDomainDto,
  type WebOrderCreated,
  type WebsiteConfig,
  type WebsitePreview,
  type WebsiteState,
  blankSection,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testConfig } from './env';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { PNG } from './image-fixture';
import { createMenuFixture } from './menu-fixture';

/**
 * The tenant website (ADR 0023): the host name is the tenant. Verified domains only, custom
 * domains proven by DNS, every location and order checked against the host's tenant, and the
 * website's draft kept from visitors until it is published.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let a: TenantFixture;
let b: TenantFixture;
let ownerA: Record<string, string>;
let ownerB: Record<string, string>;
let menuA: Awaited<ReturnType<typeof createMenuFixture>>;
let menuB: Awaited<ReturnType<typeof createMenuFixture>>;

beforeAll(async () => {
  ({ app, prisma } = await startApp({
    WEB_ORDER_TIMEOUT_SWEEP_SECONDS: '0',
    WEB_ORDER_RATE_LIMIT_PER_MINUTE: '100000',
    TRACKING_RATE_LIMIT_PER_MINUTE: '100000',
  }));
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  a = await createTenant(prisma);
  b = await createTenant(prisma);
  await prisma.tenant.update({ where: { id: b.tenantId }, data: { businessType: 'CLOTHING' } });
  // Clothing stores start without online ordering; this one switched it on.
  await prisma.featureOverride.create({
    data: { tenantId: b.tenantId, scope: 'tenant', feature: 'ONLINE_ORDERING', enabled: true },
  });
  menuA = await createMenuFixture(prisma, a);
  menuB = await createMenuFixture(prisma, b);
  ownerA = bearer(await login(app, a.owner.email));
  ownerB = bearer(await login(app, b.owner.email));
});

const verifier = () => app.get<MockDomainVerifier>(DOMAIN_VERIFIER);

function get(url: string, host: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { host, ...headers } });
}

const site = (host: string, headers: Record<string, string> = {}) =>
  get('/public/site', host, headers);

// The body's type is the caller's to name, as with `res.json<T>()`.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function admin<T = unknown>(
  owner: Record<string, string>,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: object,
): Promise<{ status: number; body: T }> {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: owner,
    ...(payload ? { payload } : {}),
  });
  return { status: res.statusCode, body: res.json<T>() };
}

/** Opens a location for online orders: a fresh hub heartbeat and the switch on. */
async function openForOrders(tenant: TenantFixture, owner: Record<string, string>) {
  const paired = await admin<PairedDevice>(
    owner,
    'POST',
    `/locations/${tenant.locationA}/devices`,
    { name: 'Hub', type: 'GATEWAY' },
  );
  await prisma.device.update({
    where: { id: paired.body.device.id },
    data: { status: 'ACTIVE', lastSeenAt: new Date() },
  });
  const res = await admin(owner, 'PUT', `/locations/${tenant.locationA}/online-ordering`, {
    state: 'OPEN',
    pickupEnabled: true,
  });
  expect(res.status).toBe(200);
}

const webOrder = (locationId: string, line: object, extra: object = {}) => ({
  id: newId(),
  locationId,
  fulfillment: 'PICKUP',
  customer: { name: 'Sara', phone: '+970590000001' },
  items: [line],
  payment: { option: 'PAY_AT_PICKUP' },
  ...extra,
});

// --- Host resolution ---------------------------------------------------------------------------

describe('host → tenant', () => {
  it('serves each tenant on its own MADAR address, with its own data only', async () => {
    const resA = await site(a.host);
    const resB = await site(`${b.host}:5175`);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    const siteA = resA.json<PublicSite>();
    const siteB = resB.json<PublicSite>();
    expect(siteA.id).toBe(a.tenantId);
    expect(siteB.id).toBe(b.tenantId);
    expect(siteA.locations.map((l) => l.id).sort()).toEqual([a.locationA, a.locationB].sort());
    expect(JSON.stringify(siteA)).not.toContain(b.tenantId);
    expect(JSON.stringify(siteA)).not.toContain(b.locationA);
    // Host names are compared normalized: case, port and a trailing dot do not matter.
    expect((await site(`${a.host.toUpperCase()}.:443`)).json<PublicSite>().id).toBe(a.tenantId);
  });

  it('ignores every other way a browser could name a tenant', async () => {
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: b.tenantId } });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/site?tenantId=${b.tenantId}&slug=${slug}`,
      headers: {
        host: a.host,
        'x-tenant-id': b.tenantId,
        'x-tenant-slug': slug,
        'x-forwarded-host': b.host,
        // A preview token of B is worth nothing on A's host.
        'x-website-preview': new WebsitePreviewTokens(previewSecret(testConfig())).issue(b.tenantId)
          .token,
      },
    });
    expect(res.json<PublicSite>()).toMatchObject({ id: a.tenantId, preview: false });
    // The removed slug route is gone, not merely hidden.
    expect((await get(`/public/tenants/${slug}`, a.host)).statusCode).toBe(404);
  });

  it('reads X-Forwarded-Host only behind a trusted proxy (TRUST_PROXY)', async () => {
    const forwarded = { 'x-forwarded-host': b.host };
    expect((await site('proxy.internal', forwarded)).statusCode).toBe(404);
    expect((await site(a.host, forwarded)).json<PublicSite>().id).toBe(a.tenantId);

    const proxied = await startApp({ TRUST_PROXY: '1' });
    try {
      const res = await proxied.app.inject({
        method: 'GET',
        url: '/api/v1/public/site',
        headers: { host: 'proxy.internal', ...forwarded },
      });
      expect(res.json<PublicSite>().id).toBe(b.tenantId);
    } finally {
      await proxied.app.close();
      await proxied.prisma.$disconnect();
    }
  });

  it('falls back to the development tenant on bare localhost only, never in production', async () => {
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    const dev = await startApp({ DEV_DEFAULT_TENANT_SLUG: slug });
    try {
      const at = (host: string) =>
        dev.app.inject({ method: 'GET', url: '/api/v1/public/site', headers: { host } });
      expect((await at('localhost:5175')).json<PublicSite>().id).toBe(a.tenantId);
      expect((await at('127.0.0.1')).json<PublicSite>().id).toBe(a.tenantId);
      // A domain nobody verified is still not found, fallback or not.
      expect((await at('unknown.localhost')).statusCode).toBe(404);
      expect((await at('shop.example')).statusCode).toBe(404);
      expect((await at(b.host)).json<PublicSite>().id).toBe(b.tenantId);
    } finally {
      await dev.app.close();
      await dev.prisma.$disconnect();
    }
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: testConfig().DATABASE_URL,
      JWT_ACCESS_SECRET: testConfig().JWT_ACCESS_SECRET,
      PLATFORM_WEB_DOMAIN: 'madar.app',
      WEBSITE_URL: 'https://{domain}',
    };
    expect(() => loadConfig(production)).not.toThrow();
    expect(() => loadConfig({ ...production, DEV_DEFAULT_TENANT_SLUG: slug })).toThrow(
      /DEV_DEFAULT_TENANT_SLUG/,
    );
    expect(() => loadConfig({ ...production, DOMAIN_VERIFIER: 'mock' })).toThrow(/DOMAIN_VERIFIER/);
    expect(() => loadConfig({ ...production, PLATFORM_WEB_DOMAIN: 'localhost' })).toThrow(
      /PLATFORM_WEB_DOMAIN/,
    );
  });
});

// --- Locations and orders through the host --------------------------------------------------------

describe('locations and orders belong to the host’s tenant', () => {
  it('hides B’s locations and menus on A’s host', async () => {
    for (const url of [
      `/public/site/locations/${b.locationA}`,
      `/public/site/locations/${b.locationA}/menu`,
    ]) {
      const res = await get(url, a.host);
      expect(res.statusCode, url).toBe(404);
      expect(res.json<ApiErrorBody>().code).toBe('LOCATION_NOT_FOUND');
      expect((await get(url, b.host)).statusCode, url).toBe(200);
    }
  });

  it('places an order in the host’s tenant and refuses one for another tenant’s location', async () => {
    await openForOrders(a, ownerA);
    await openForOrders(b, ownerB);
    const place = (host: string, body: object) =>
      app.inject({ method: 'POST', url: '/api/v1/orders', headers: { host }, payload: body });

    const foreign = await place(a.host, webOrder(b.locationA, menuB.colaLine(1)));
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json<ApiErrorBody>().code).toBe('LOCATION_NOT_FOUND');
    // A forged tenant in the body changes nothing either.
    const forged = await place(
      a.host,
      webOrder(b.locationA, menuB.colaLine(1), { tenantId: b.tenantId }),
    );
    expect(forged.statusCode).toBe(404);
    expect(await prisma.order.count()).toBe(0);

    const onA = await place(a.host, webOrder(a.locationA, menuA.colaLine(1)));
    const onB = await place(b.host, webOrder(b.locationA, menuB.colaLine(2)));
    expect(onA.statusCode, onA.body).toBe(201);
    expect(onB.statusCode, onB.body).toBe(201);
    const orders = await prisma.order.findMany({ select: { id: true, tenantId: true } });
    expect(orders).toHaveLength(2);
    const created = (res: typeof onA) => res.json<WebOrderCreated>();
    expect(orders.find((o) => o.id === created(onA).order.id)?.tenantId).toBe(a.tenantId);
    expect(orders.find((o) => o.id === created(onB).order.id)?.tenantId).toBe(b.tenantId);

    // Tracking B's order: on B's site only.
    const track = (host: string) =>
      app.inject({
        method: 'GET',
        url: '/api/v1/orders/track',
        headers: { host, 'x-tracking-token': created(onB).trackingToken },
      });
    expect((await track(b.host)).statusCode).toBe(200);
    const hidden = await track(a.host);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json<ApiErrorBody>().code).toBe('ORDER_NOT_FOUND');
  });

  it('tracks an order only on its own tenant’s site, whatever the token says', async () => {
    const orderId = newId();
    await prisma.order.create({
      data: {
        id: orderId,
        tenantId: b.tenantId,
        locationId: b.locationA,
        orderNumber: 'W-001',
        businessDate: new Date('2026-10-24T00:00:00Z'),
        channel: 'WEBSITE',
        fulfillmentType: 'PICKUP',
        customerName: 'Guest',
        customerPhone: '+970590000002',
        status: 'PLACED',
        source: 'WEBSITE',
        currencyCode: 'SAR',
        taxInclusive: true,
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        feeTotal: 0,
        total: 0,
      },
    });
    const token = new TrackingTokens(trackingSecret(testConfig())).issue(orderId);
    const at = (host: string) => get('/orders/track', host, { 'x-tracking-token': token });
    expect((await at(b.host)).statusCode).toBe(200);
    expect((await at(a.host)).statusCode).toBe(404);
  });
});

// --- Domains -----------------------------------------------------------------------------------

describe('custom domains', () => {
  const add = (owner: Record<string, string>, tenant: TenantFixture, domain: string) =>
    admin<TenantDomainDto>(owner, 'POST', `/tenants/${tenant.tenantId}/domains`, { domain });
  const action = (
    owner: Record<string, string>,
    tenant: TenantFixture,
    id: string,
    what: 'verify' | 'primary' | 'disable',
  ) => admin<TenantDomainDto>(owner, 'POST', `/tenants/${tenant.tenantId}/domains/${id}/${what}`);

  it('lists MADAR’s address first, verified and primary', async () => {
    const res = await admin<TenantDomainDto[]>(ownerA, 'GET', `/tenants/${a.tenantId}/domains`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        domain: a.host,
        kind: 'SUBDOMAIN',
        status: 'VERIFIED',
        isPrimary: true,
        verification: null,
        url: `http://${a.host}:5175`,
      }),
    ]);
  });

  it('adds a domain normalized, pending, with the TXT record to publish', async () => {
    const res = await add(ownerA, a, '  https://WWW.Café.Example:443/menu ');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      domain: 'www.xn--caf-dma.example',
      kind: 'CUSTOM',
      status: 'PENDING',
      isPrimary: false,
      verification: {
        type: 'TXT',
        name: '_madar-verify.www.xn--caf-dma.example',
        value: expect.stringMatching(/^madar-verify=[0-9a-f]{32}$/) as unknown,
      },
    });
    // Pending: it serves nothing yet.
    expect((await site('www.xn--caf-dma.example')).statusCode).toBe(404);
    expect((await site('www.café.example')).statusCode).toBe(404);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'domain.added' } });
    expect(audit?.metadata).toMatchObject({ domain: 'www.xn--caf-dma.example' });
  });

  it('refuses names that cannot be a tenant’s domain', async () => {
    for (const [domain, reason] of [
      ['localhost', 'SINGLE_LABEL'],
      ['10.0.0.1', 'IP_ADDRESS'],
      ['shop_1.example', 'INVALID'],
      ['user@shop.example', 'INVALID'],
      // MADAR's own addresses belong to the tenants of those slugs.
      ['localhost.', 'SINGLE_LABEL'],
      [b.host, 'PLATFORM_DOMAIN'],
      [`www.${b.host}`, 'PLATFORM_DOMAIN'],
    ] as const) {
      const res = await add(ownerA, a, domain);
      expect(res.status, domain).toBe(422);
      expect(res.body as unknown as ApiErrorBody).toMatchObject({
        code: 'DOMAIN_INVALID',
        details: { reason },
      });
    }
    await add(ownerA, a, 'shop.example');
    expect((await add(ownerA, a, 'SHOP.example.')).body as unknown as ApiErrorBody).toMatchObject({
      code: 'DOMAIN_TAKEN',
      details: { reason: 'ALREADY_ADDED' },
    });
  });

  it('verifies by DNS: a missing record fails, a published one serves the site', async () => {
    const domain = (await add(ownerA, a, 'shop.example')).body;
    verifier().refuse('shop.example');
    const failed = await action(ownerA, a, domain.id, 'verify');
    expect(failed.status).toBe(422);
    expect(failed.body as unknown as ApiErrorBody).toMatchObject({
      code: 'DOMAIN_NOT_VERIFIED',
      details: { record: domain.verification },
    });
    const listed = await admin<TenantDomainDto[]>(ownerA, 'GET', `/tenants/${a.tenantId}/domains`);
    expect(listed.body.find((d) => d.id === domain.id)?.status).toBe('FAILED');
    expect((await site('shop.example')).statusCode).toBe(404);

    verifier().publish('shop.example');
    const verified = await action(ownerA, a, domain.id, 'verify');
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      status: 'VERIFIED',
      verifiedAt: expect.any(String) as unknown,
    });
    expect((await site('shop.example')).json<PublicSite>().id).toBe(a.tenantId);
    expect((await site('Shop.Example:443')).json<PublicSite>().id).toBe(a.tenantId);
    expect(
      (
        await prisma.auditLog.findMany({
          where: { tenantId: a.tenantId, action: { startsWith: 'domain.' } },
        })
      )
        .map((e) => e.action)
        .sort(),
    ).toEqual(['domain.added', 'domain.verification_failed', 'domain.verified']);
  });

  it('lets a domain serve one tenant: a pending claim never blocks or impersonates the owner', async () => {
    // B claims A's future domain first, and never proves it.
    const claim = (await add(ownerB, b, 'shared.example')).body;
    verifier().refuse('shared.example');
    expect((await action(ownerB, b, claim.id, 'verify')).status).toBe(422);
    expect((await site('shared.example')).statusCode).toBe(404);
    // A, the real owner, adds and verifies it.
    verifier().publish('shared.example');
    const owned = (await add(ownerA, a, 'shared.example')).body;
    expect((await action(ownerA, a, owned.id, 'verify')).body.status).toBe('VERIFIED');
    expect((await site('shared.example')).json<PublicSite>().id).toBe(a.tenantId);
    // From then on nobody else can add or verify it.
    expect(
      (await action(ownerB, b, claim.id, 'verify')).body as unknown as ApiErrorBody,
    ).toMatchObject({ code: 'DOMAIN_TAKEN', details: { reason: 'OTHER_TENANT' } });
    const late = await add(ownerB, b, 'www.shared.example');
    expect(late.status).toBe(201);
    expect((await add(ownerB, b, 'shared.example')).status).toBe(409);
    expect((await site('shared.example')).json<PublicSite>().id).toBe(a.tenantId);
  });

  it('sets the primary domain and disables a custom one', async () => {
    const custom = (await add(ownerA, a, 'shop.example')).body;
    // Only a verified domain can be primary.
    expect(
      (await action(ownerA, a, custom.id, 'primary')).body as unknown as ApiErrorBody,
    ).toMatchObject({ code: 'DOMAIN_LOCKED', details: { reason: 'NOT_VERIFIED' } });
    await action(ownerA, a, custom.id, 'verify');
    const primary = await action(ownerA, a, custom.id, 'primary');
    expect(primary.body.isPrimary).toBe(true);
    expect((await site(a.host)).json<PublicSite>().primaryDomain).toBe('shop.example');
    const domains = (
      await admin<TenantDomainDto[]>(ownerA, 'GET', `/tenants/${a.tenantId}/domains`)
    ).body;
    expect(domains.filter((d) => d.isPrimary).map((d) => d.domain)).toEqual(['shop.example']);
    const subdomain = domains.find((d) => d.kind === 'SUBDOMAIN');
    if (!subdomain) throw new Error('the MADAR address is listed');

    // MADAR's address and the primary domain stay.
    for (const id of [subdomain.id, custom.id]) {
      expect((await action(ownerA, a, id, 'disable')).status).toBe(409);
    }
    await action(ownerA, a, subdomain.id, 'primary');
    const disabled = await action(ownerA, a, custom.id, 'disable');
    expect(disabled.body.status).toBe('DISABLED');
    expect((await site('shop.example')).statusCode).toBe(404);
    // Verified again, it serves again.
    expect((await action(ownerA, a, custom.id, 'verify')).body.status).toBe('VERIFIED');
    expect((await site('shop.example')).statusCode).toBe(200);
  });

  it('keeps each tenant to its own domains', async () => {
    const domain = (await add(ownerB, b, 'shop-b.example')).body;
    for (const what of ['verify', 'primary', 'disable'] as const) {
      const res = await action(ownerA, a, domain.id, what);
      expect(res.status, what).toBe(404);
      expect((res.body as unknown as ApiErrorBody).code).toBe('DOMAIN_NOT_FOUND');
    }
  });

  it('answers the proxy’s certificate check for verified domains only', async () => {
    const check = (domain: string) =>
      app.inject({
        method: 'GET',
        url: `/internal/domains/check?domain=${encodeURIComponent(domain)}`,
      });
    expect((await check(a.host)).statusCode).toBe(200);
    expect((await check(a.host.toUpperCase())).statusCode).toBe(200);
    await add(ownerA, a, 'shop.example');
    expect((await check('shop.example')).statusCode).toBe(404);
    expect((await check('nobody.example')).statusCode).toBe(404);
    expect((await check('')).statusCode).toBe(400);
  });
});

// --- The website configuration -----------------------------------------------------------------

describe('website configuration', () => {
  const base = (tenant: TenantFixture) => `/tenants/${tenant.tenantId}/website`;
  const titleOf = (config: WebsiteConfig) => {
    const hero = config.sections.find((s) => s.type === WebsiteSectionType.HERO);
    return hero?.type === WebsiteSectionType.HERO ? hero.content.title.en : undefined;
  };

  it('starts each tenant from the template of its business type', async () => {
    const stateA = await admin<WebsiteState>(ownerA, 'GET', base(a));
    expect(stateA.status).toBe(200);
    expect(stateA.body).toMatchObject({ published: null, version: 0, hasUnpublishedChanges: true });
    const siteA = (await site(a.host)).json<PublicSite>();
    const siteB = (await site(b.host)).json<PublicSite>();
    expect(siteA.website).toEqual(stateA.body.draft);
    expect(titleOf(siteA.website)).not.toBe(titleOf(siteB.website));
  });

  it('keeps the draft from visitors until it is published', async () => {
    const draft = (await admin<WebsiteState>(ownerA, 'GET', base(a))).body.draft;
    const promo = blankSection(WebsiteSectionType.PROMO_BANNER, 'promo', 5);
    if (promo.type !== WebsiteSectionType.PROMO_BANNER) throw new Error('promo');
    promo.content.text = { en: 'Two-for-one Tuesday', ar: 'اثنان بسعر واحد' };
    const edited: WebsiteConfig = { ...draft, sections: [...draft.sections, promo] };

    const saved = await admin<WebsiteState>(ownerA, 'PUT', `${base(a)}/draft`, edited);
    expect(saved.status).toBe(200);
    expect(saved.body.draft.sections).toHaveLength(draft.sections.length + 1);
    // Visitors still see the template.
    expect((await site(a.host)).body).not.toContain('Two-for-one Tuesday');

    // The admin's preview shows the draft, on A's own site only, and is not cached.
    const preview = await admin<WebsitePreview>(ownerA, 'POST', `${base(a)}/preview`);
    expect(preview.body.url).toBe(
      `http://${a.host}:5175/?preview=${encodeURIComponent(preview.body.token)}`,
    );
    const previewed = await site(a.host, { 'x-website-preview': preview.body.token });
    expect(previewed.json<PublicSite>()).toMatchObject({ preview: true });
    expect(previewed.body).toContain('Two-for-one Tuesday');
    expect(previewed.headers['cache-control']).toBe('no-store');
    expect((await site(b.host, { 'x-website-preview': preview.body.token })).body).not.toContain(
      'Two-for-one Tuesday',
    );
    expect(
      (await site(a.host, { 'x-website-preview': 'garbage' })).json<PublicSite>().preview,
    ).toBe(false);

    const published = await admin<WebsiteState>(ownerA, 'POST', `${base(a)}/publish`);
    expect(published.body).toMatchObject({ version: 1, hasUnpublishedChanges: false });
    expect((await site(a.host)).body).toContain('Two-for-one Tuesday');
    expect((await site(b.host)).body).not.toContain('Two-for-one Tuesday');
    expect((await admin<WebsiteState>(ownerA, 'POST', `${base(a)}/publish`)).body.version).toBe(2);
    expect(
      (
        await prisma.auditLog.findMany({
          where: { tenantId: a.tenantId, action: { startsWith: 'website.' } },
        })
      )
        .map((e) => e.action)
        .sort(),
    ).toEqual(['website.draft_saved', 'website.published', 'website.published']);
  });

  it('refuses an invalid draft and anything that is not the tenant’s', async () => {
    const draft = (await admin<WebsiteState>(ownerA, 'GET', base(a))).body.draft;
    const invalid = await admin<ApiErrorBody>(ownerA, 'PUT', `${base(a)}/draft`, {
      ...draft,
      sections: [{ ...draft.sections[0], type: 'MARQUEE' }],
    });
    expect(invalid.status).toBe(400);

    const featured = blankSection(WebsiteSectionType.FEATURED_PRODUCTS, 'b-products', 1);
    if (featured.type !== WebsiteSectionType.FEATURED_PRODUCTS) throw new Error('featured');
    featured.content.productIds = [menuB.burger.id];
    const foreignProduct = await admin<ApiErrorBody>(ownerA, 'PUT', `${base(a)}/draft`, {
      ...draft,
      sections: [featured],
    });
    expect(foreignProduct.status).toBe(404);
    expect(foreignProduct.body.code).toBe('PRODUCT_NOT_FOUND');

    // B's picture cannot become A's hero image, and a logo is not a website picture.
    const upload = (owner: Record<string, string>, tenant: TenantFixture, kind: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/tenants/${tenant.tenantId}/files?kind=${kind}`,
        headers: { ...owner, 'content-type': 'image/png' },
        payload: PNG,
      });
    const pictureB = (await upload(ownerB, b, 'WEBSITE_IMAGE')).json<{ id: string }>();
    const logoA = (await upload(ownerA, a, 'LOGO')).json<{ id: string }>();
    const hero = blankSection(WebsiteSectionType.HERO, 'hero', 0);
    if (hero.type !== WebsiteSectionType.HERO) throw new Error('hero');
    for (const [fileId, code] of [
      [pictureB.id, 'FILE_NOT_FOUND'],
      [logoA.id, 'FILE_TYPE_NOT_ALLOWED'],
    ] as const) {
      const res = await admin<ApiErrorBody>(ownerA, 'PUT', `${base(a)}/draft`, {
        ...draft,
        sections: [{ ...hero, content: { ...hero.content, imageFileId: fileId } }],
      });
      expect(res.body.code, fileId).toBe(code);
    }
    // B's picture is public on B's site, never on A's.
    expect((await get(`/public/site/files/${pictureB.id}`, b.host)).statusCode).toBe(200);
    expect((await get(`/public/site/files/${pictureB.id}`, a.host)).statusCode).toBe(404);
  });

  it('is for website managers of the tenant only', async () => {
    const cashier = bearer(await login(app, a.cashier.email));
    expect((await admin(cashier, 'GET', base(a))).status).toBe(403);
    expect((await admin(ownerB, 'GET', base(a))).status).toBe(404);
  });
});
