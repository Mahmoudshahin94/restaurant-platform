import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import type { ApiErrorBody } from '@pos/shared-types';
import type {
  PublicTenant,
  TenantContextDto,
  TenantLocalizationDto,
  UpdateLocalizationRequest,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
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
let owner: Record<string, string>;
let cashier: Record<string, string>;

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
  owner = bearer(await login(app, tenant.owner.email));
  cashier = bearer(await login(app, tenant.cashier.email));
});

const url = () => `/api/v1/tenants/${tenant.tenantId}/localization`;

/** The settings as stored after provisioning: two languages, everything else inherited. */
const DEFAULTS: UpdateLocalizationRequest = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'ar'],
  digits: null,
  currencySymbol: null,
  currencyDisplay: null,
  currencyFormatLocale: null,
};

const put = (payload: object, headers = owner) =>
  app.inject({ method: 'PUT', url: url(), headers, payload });

const context = async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tenants/${tenant.tenantId}/context`,
    headers: cashier,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TenantContextDto>();
};

describe('localization settings (ADR 0020)', () => {
  it('shows what the tenant set and what its screens get', async () => {
    const res = await app.inject({ method: 'GET', url: url(), headers: owner });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<TenantLocalizationDto>()).toMatchObject({
      settings: DEFAULTS,
      currency: {
        code: 'SAR',
        decimalPlaces: 2,
        symbol: null,
        display: 'narrowSymbol',
        formatLocale: null,
        sources: { symbol: 'PLATFORM', display: 'PLATFORM', formatLocale: 'PLATFORM' },
      },
      locales: { default: 'en', supported: ['en', 'ar'], digits: 'latn' },
    });
  });

  it('gives a shekel tenant ₪ by default', async () => {
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { currencyCode: 'ILS' } });
    const { currency } = await context();
    expect(currency).toMatchObject({ code: 'ILS', decimalPlaces: 2, symbol: '₪' });
  });

  it('saves languages and the currency display, audits them, and serves them in the context', async () => {
    const res = await put({
      defaultLocale: 'ar',
      supportedLocales: ['ar'],
      digits: 'arab',
      currencySymbol: ' ر.س ',
      currencyDisplay: 'symbol',
      currencyFormatLocale: 'ar-SA',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<TenantLocalizationDto>().settings.currencySymbol).toBe('ر.س');

    const body = await context();
    expect(body.currency).toMatchObject({
      code: 'SAR',
      decimalPlaces: 2,
      symbol: 'ر.س',
      display: 'symbol',
      formatLocale: 'ar-SA',
      sources: { symbol: 'TENANT', display: 'TENANT', formatLocale: 'TENANT' },
    });
    expect(body.locales).toEqual({
      default: 'ar',
      supported: ['ar'],
      digits: 'arab',
      sources: { digits: 'TENANT' },
    });

    const audit = await prisma.auditLog.findFirst({ where: { action: 'localization.updated' } });
    expect(audit).toMatchObject({ entityType: 'Tenant', entityId: tenant.tenantId });
    expect(audit?.metadata).toMatchObject({ before: DEFAULTS, changes: { digits: 'arab' } });

    // Null inherits again.
    expect((await put(DEFAULTS)).statusCode).toBe(200);
    expect((await context()).currency).toMatchObject({ symbol: null, display: 'narrowSymbol' });
  });

  it('refuses invalid settings with the field at fault', async () => {
    const cases: [object, string][] = [
      [{ ...DEFAULTS, supportedLocales: ['ar'] }, 'supportedLocales'],
      [{ ...DEFAULTS, supportedLocales: [] }, 'supportedLocales'],
      [{ ...DEFAULTS, supportedLocales: ['en', 'en'] }, 'supportedLocales'],
      [{ ...DEFAULTS, supportedLocales: ['en', 'fr'] }, 'supportedLocales'],
      [{ ...DEFAULTS, currencySymbol: '5₪' }, 'currencySymbol'],
      [{ ...DEFAULTS, currencySymbol: 'TOO-LONG-SYMBOL' }, 'currencySymbol'],
      [{ ...DEFAULTS, currencyDisplay: 'name' }, 'currencyDisplay'],
      [{ ...DEFAULTS, currencyFormatLocale: 'en-ZZ' }, 'currencyFormatLocale'],
      [{ ...DEFAULTS, digits: 'roman' }, 'digits'],
    ];
    for (const [payload, field] of cases) {
      const res = await put(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      const body = res.json<ApiErrorBody>();
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(body.details)).toContain(field);
    }
    const { settings } = (
      await app.inject({ method: 'GET', url: url(), headers: owner })
    ).json<TenantLocalizationDto>();
    expect(settings).toEqual(DEFAULTS);
  });

  it('never changes the currency or its decimal places (ADR 0002)', async () => {
    for (const extra of [{ currencyCode: 'USD' }, { decimalPlaces: 3 }]) {
      const res = await put({ ...DEFAULTS, ...extra });
      expect(res.statusCode).toBe(400);
      expect(res.json<ApiErrorBody>().code).toBe('VALIDATION_FAILED');
    }
    expect((await context()).currency).toMatchObject({ code: 'SAR', decimalPlaces: 2 });
  });

  it('is for managers: staff without settings.manage may not read or change it', async () => {
    expect((await app.inject({ method: 'GET', url: url(), headers: cashier })).statusCode).toBe(
      403,
    );
    expect((await put(DEFAULTS, cashier)).statusCode).toBe(403);
  });

  it("does not reach another tenant's settings", async () => {
    const other = await createTenant(prisma);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/tenants/${other.tenantId}/localization`,
      headers: owner,
      payload: { ...DEFAULTS, supportedLocales: ['en'] },
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.tenant.findUniqueOrThrow({ where: { id: other.tenantId } });
    expect(row.supportedLocales).toEqual(['en', 'ar']);
  });

  it("gives the website the store's currency display and languages", async () => {
    await prisma.location.update({
      where: { id: tenant.locationA },
      data: { onlineOrderingState: 'OPEN' },
    });
    expect(
      (
        await put({
          ...DEFAULTS,
          defaultLocale: 'ar',
          supportedLocales: ['ar'],
          currencyDisplay: 'code',
        })
      ).statusCode,
    ).toBe(200);
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.tenantId } });
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/tenants/${slug}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PublicTenant>()).toMatchObject({
      currency: { code: 'SAR', decimalPlaces: 2, display: 'code' },
      locales: { default: 'ar', supported: ['ar'], digits: 'latn' },
    });
  });
});
