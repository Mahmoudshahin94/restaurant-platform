import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { TenantContext } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import type {
  BrandReport,
  CategoryReport,
  ChannelReport,
  DailySalesReport,
  LocationReport,
  OrganizationOverview,
  PaymentReport,
  ProductReport,
} from '@pos/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgDashboardService } from '../src/modules/organizations/org-dashboard.service';
import {
  type OrganizationFixture,
  type TenantFixture,
  bearer,
  createOrganization,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';
import { type SeedMethod, type SeededOrder, reportSeeder } from './report-fixture';

/*
 * Organization dashboard and reports (E1 §4.2): the organization's reports are the SQL of the
 * brand reports over all its brands, so its totals are the sum of the brands' own. Both brands are
 * ILS, in Asia/Riyadh (UTC+3). Brand 1 has one more order than brand 2, so a sum is not a double.
 */

let app: NestFastifyApplication;
let prisma: PrismaClient;
let org: OrganizationFixture;
let owner: Record<string, string>;
let brandOwners: Record<string, string>[];
let orders: Record<string, SeededOrder>[];
let menus: Awaited<ReturnType<typeof createMenuFixture>>[];

const RANGE = 'from=2026-10-09&to=2026-10-13';
const base = () => `/api/v1/organizations/${org.organizationId}`;
const brandIds = () => org.brands.map((b) => b.tenantId);

// The caller names the response type, as with light-my-request's `json<T>()`.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function get<T>(
  url: string,
  headers = owner,
): Promise<{ status: number; body: T & ApiErrorBody }> {
  const res = await app.inject({ method: 'GET', url, headers });
  return { status: res.statusCode, body: res.json() };
}
/** The dashboard as of `now`, in the organization's scope as the route runs it. */
const dashboardOf = (tenantIds: string[], now: Date) =>
  TenantContext.runInOrganization(org.organizationId, tenantIds, () =>
    app
      .get(OrgDashboardService)
      .build({ id: org.organizationId, role: 'OWNER', tenantIds, currencyCode: 'ILS' }, now),
  );
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const orgReport = <T>(kind: string, query = '') =>
  get<T>(`${base()}/reports/${kind}?${RANGE}${query}`);
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const brandReport = <T>(index: number, kind: string, query = '') =>
  get<T>(
    `/api/v1/tenants/${org.brands[index]!.tenantId}/reports/${kind}?${RANGE}${query}`,
    brandOwners[index],
  );

/** Orders of one brand: the same three everywhere, and a fourth on request. */
async function seedBrand(
  brand: TenantFixture,
  menu: Awaited<ReturnType<typeof createMenuFixture>>,
  extra: boolean,
): Promise<Record<string, SeededOrder>> {
  const tid = brand.tenantId;
  const method = async (type: SeedMethod['type'], nameEn: string): Promise<SeedMethod> => {
    const m = await prisma.paymentMethod.create({
      data: { tenantId: tid, type, nameEn, nameAr: nameEn },
    });
    return { id: m.id, type, nameEn, nameAr: nameEn };
  };
  const cash = await method('ONLINE', 'Online');
  const card = await method('ONLINE', 'Wallet');
  const seed = reportSeeder(prisma, tid, 'ILS');
  const burger = (quantity: number) => ({
    product: menu.burger,
    unitPrice: 2500,
    quantity,
    taxes: [{ id: menu.vat.id, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 }],
  });
  const out: Record<string, SeededOrder> = {};
  out.dineIn = await seed.order({
    locationId: brand.locationA,
    businessDate: '2026-10-10',
    channel: 'DINE_IN',
    taxInclusive: true,
    at: '2026-10-10T09:00:00Z',
    lines: [burger(2)],
  });
  await seed.payment({
    order: out.dineIn,
    method: cash,
    amount: out.dineIn.total,
    at: '2026-10-10T09:05:00Z',
    shiftId: null,
  });
  out.takeaway = await seed.order({
    locationId: brand.locationA,
    businessDate: '2026-10-11',
    channel: 'TAKEAWAY',
    taxInclusive: true,
    at: '2026-10-11T09:00:00Z',
    lines: [burger(1)],
  });
  const charge = await seed.payment({
    order: out.takeaway,
    method: card,
    amount: out.takeaway.total,
    at: '2026-10-11T09:05:00Z',
    shiftId: null,
  });
  await seed.payment({
    order: out.takeaway,
    method: card,
    amount: 500,
    at: '2026-10-12T09:00:00Z',
    shiftId: null,
    refundOf: charge,
  });
  out.delivery = await seed.order({
    locationId: brand.locationB,
    businessDate: '2026-10-11',
    channel: 'DELIVERY',
    taxInclusive: true,
    at: '2026-10-11T10:00:00Z',
    lines: [burger(1)],
  });
  await seed.payment({
    order: out.delivery,
    method: card,
    amount: out.delivery.total,
    at: '2026-10-11T10:05:00Z',
    shiftId: null,
  });
  if (extra) {
    out.extra = await seed.order({
      locationId: brand.locationB,
      businessDate: '2026-10-12',
      channel: 'DINE_IN',
      taxInclusive: true,
      at: '2026-10-12T10:00:00Z',
      lines: [burger(3)],
    });
    await seed.payment({
      order: out.extra,
      method: cash,
      amount: out.extra.total,
      at: '2026-10-12T10:05:00Z',
      shiftId: null,
    });
  }
  return out;
}

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  await resetDatabase(prisma);
  org = await createOrganization(app, prisma, { brands: 2 });
  menus = [
    await createMenuFixture(prisma, org.brands[0]!),
    await createMenuFixture(prisma, org.brands[1]!),
  ];
  orders = [
    await seedBrand(org.brands[0]!, menus[0]!, true),
    await seedBrand(org.brands[1]!, menus[1]!, false),
  ];
  owner = bearer(await login(app, org.owner.email));
  brandOwners = [
    bearer(await login(app, org.brands[0]!.owner.email)),
    bearer(await login(app, org.brands[1]!.owner.email)),
  ];
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('organization reports', () => {
  it("organization totals equal the sum of the brands' reports", async () => {
    const [daily, a, b] = await Promise.all([
      orgReport<DailySalesReport>('daily-sales'),
      brandReport<DailySalesReport>(0, 'daily-sales'),
      brandReport<DailySalesReport>(1, 'daily-sales'),
    ]);
    expect(daily.status).toBe(200);
    expect(daily.body.currencyCode).toBe('ILS');
    expect(a.body.totals.orders).toBeGreaterThan(b.body.totals.orders);
    for (const key of ['orders', 'grossSales', 'netSales', 'tax', 'totalSales'] as const) {
      expect(daily.body.totals[key], key).toBe(a.body.totals[key] + b.body.totals[key]);
    }
    expect(daily.body.totals.refunds.amount).toBe(1_000);
    expect(daily.body.totals.refunds.amount).toBe(
      a.body.totals.refunds.amount + b.body.totals.refunds.amount,
    );
    expect(daily.body.rows.map((r) => r.totalSales)).toEqual(
      daily.body.rows.map((_, i) => a.body.rows[i]!.totalSales + b.body.rows[i]!.totalSales),
    );

    const [channels, ca, cb] = await Promise.all([
      orgReport<ChannelReport>('channels'),
      brandReport<ChannelReport>(0, 'channels'),
      brandReport<ChannelReport>(1, 'channels'),
    ]);
    expect(channels.body.totals.totalSales).toBe(
      ca.body.totals.totalSales + cb.body.totals.totalSales,
    );
    for (const row of channels.body.rows) {
      const of = (r: ChannelReport) => r.rows.find((x) => x.channel === row.channel)!;
      expect(row.orders, row.channel).toBe(of(ca.body).orders + of(cb.body).orders);
      expect(row.netSales, row.channel).toBe(of(ca.body).netSales + of(cb.body).netSales);
    }

    const [payments, pa, pb] = await Promise.all([
      orgReport<PaymentReport>('payments'),
      brandReport<PaymentReport>(0, 'payments'),
      brandReport<PaymentReport>(1, 'payments'),
    ]);
    for (const key of ['charges', 'chargeCount', 'refunds', 'refundCount', 'net'] as const) {
      expect(payments.body.totals[key], key).toBe(pa.body.totals[key] + pb.body.totals[key]);
    }
    expect(payments.body.totals.refunds).toBe(1_000);
  });

  it('brands and locations reports split by brand and branch', async () => {
    const [brands, a, b] = await Promise.all([
      orgReport<BrandReport>('brands'),
      brandReport<DailySalesReport>(0, 'daily-sales'),
      brandReport<DailySalesReport>(1, 'daily-sales'),
    ]);
    expect(brands.status).toBe(200);
    expect(brands.body.rows.map((r) => r.tenantId)).toEqual(brandIds());
    expect(brands.body.rows[0]).toMatchObject({
      nameEn: 'Test Tenant',
      orders: a.body.totals.orders,
    });
    expect(brands.body.rows[0]?.totalSales).toBe(a.body.totals.totalSales);
    expect(brands.body.rows[1]?.totalSales).toBe(b.body.totals.totalSales);
    expect(brands.body.totals.totalSales).toBe(a.body.totals.totalSales + b.body.totals.totalSales);

    const locations = await orgReport<LocationReport>('locations');
    expect(locations.status).toBe(200);
    expect(locations.body.rows.map((r) => [r.tenantId, r.locationId])).toEqual(
      org.brands.flatMap((brand) => [
        [brand.tenantId, brand.locationA],
        [brand.tenantId, brand.locationB],
      ]),
    );
    const byLocation = (locationId: string) =>
      locations.body.rows.find((r) => r.locationId === locationId)!;
    // Brand 1 (A: dine-in 2 + takeaway 1, B: delivery 1 + extra 3 burgers), brand 2 without the extra.
    expect(byLocation(org.brands[0]!.locationA).orders).toBe(2);
    expect(byLocation(org.brands[0]!.locationB).orders).toBe(2);
    expect(byLocation(org.brands[1]!.locationA).orders).toBe(2);
    expect(byLocation(org.brands[1]!.locationB).orders).toBe(1);
    expect(byLocation(org.brands[0]!.locationA).totalSales).toBe(
      orders[0]!.dineIn!.total + orders[0]!.takeaway!.total,
    );
    expect(byLocation(org.brands[0]!.locationA).code).toBe('LOCA');
    expect(locations.body.rows.reduce((sum, r) => sum + r.totalSales, 0)).toBe(
      locations.body.totals.totalSales,
    );
    expect(locations.body.totals.orders).toBe(a.body.totals.orders + b.body.totals.orders);
  });

  it('products and categories carry their brand', async () => {
    const [products, categories, daily] = await Promise.all([
      orgReport<ProductReport>('products'),
      orgReport<CategoryReport>('categories'),
      orgReport<DailySalesReport>('daily-sales'),
    ]);
    expect(new Set(products.body.rows.map((r) => r.tenantId))).toEqual(new Set(brandIds()));
    expect(new Set(categories.body.rows.map((r) => r.tenantId))).toEqual(new Set(brandIds()));
    // One burger line per order, no fees: line net sales are the orders' net sales.
    expect(products.body.totals.netSales).toBe(daily.body.totals.netSales);
    expect(categories.body.totals.netSales).toBe(daily.body.totals.netSales);
    const [a] = await Promise.all([brandReport<ProductReport>(0, 'products')]);
    const mine = products.body.rows.find((r) => r.tenantId === brandIds()[0]);
    expect(mine?.netSales).toBe(a.body.rows[0]?.netSales);
    expect(a.body.rows[0]?.tenantId).toBe(brandIds()[0]);
  });

  it('filters by brand and branch; a foreign id is 404', async () => {
    const [a, onlyA] = await Promise.all([
      brandReport<DailySalesReport>(0, 'daily-sales'),
      orgReport<DailySalesReport>('daily-sales', `&tenantIds=${brandIds()[0]}`),
    ]);
    expect(onlyA.body.totals).toEqual(a.body.totals);
    expect(onlyA.body.locationIds.sort()).toEqual(
      [org.brands[0]!.locationA, org.brands[0]!.locationB].sort(),
    );

    const branch = org.brands[1]!.locationB;
    const one = await orgReport<LocationReport>('locations', `&locationIds=${branch}`);
    expect(one.body.rows.map((r) => r.locationId)).toEqual([branch]);
    expect(one.body.totals.orders).toBe(1);

    const both = await orgReport<LocationReport>(
      'locations',
      `&tenantIds=${brandIds()[1]}&locationIds=${branch}`,
    );
    expect(both.body.totals.orders).toBe(1);

    const takeaways = await orgReport<DailySalesReport>('daily-sales', '&channels=TAKEAWAY');
    expect(takeaways.body.totals.orders).toBe(2);

    const stranger = await createTenant(prisma, undefined, { currencyCode: 'ILS' });
    const foreignBrand = await orgReport<unknown>('daily-sales', `&tenantIds=${stranger.tenantId}`);
    expect(foreignBrand.status).toBe(404);
    expect(foreignBrand.body.code).toBe('TENANT_NOT_FOUND');
    const mixed = await orgReport<unknown>(
      'brands',
      `&tenantIds=${brandIds()[0]},${stranger.tenantId}`,
    );
    expect(mixed.status).toBe(404);
    const foreignBranch = await orgReport<unknown>(
      'daily-sales',
      `&locationIds=${stranger.locationA}`,
    );
    expect(foreignBranch.status).toBe(404);
    expect(foreignBranch.body.code).toBe('LOCATION_NOT_FOUND');
    // A branch of the organization, but not of the brands asked for.
    const otherBrandsBranch = await orgReport<unknown>(
      'daily-sales',
      `&tenantIds=${brandIds()[0]}&locationIds=${branch}`,
    );
    expect(otherBrandsBranch.status).toBe(404);
    expect(otherBrandsBranch.body.code).toBe('LOCATION_NOT_FOUND');

    expect((await orgReport<unknown>('daily-sales', '&tenantIds=nope')).status).toBe(400);
    expect(
      (await get<unknown>(`${base()}/reports/daily-sales?from=2026-10-13&to=2026-10-09`)).status,
    ).toBe(400);
  });

  it('refuses people who are no member of the organization', async () => {
    const res = await get<unknown>(
      `${base()}/dashboard`,
      bearer(await login(app, org.brands[0]!.cashier.email)),
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ORGANIZATION_NOT_FOUND');
  });
});

describe('organization overview and dashboard', () => {
  it('lists the brands with their branches', async () => {
    const res = await get<OrganizationOverview>(base());
    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({
      id: org.organizationId,
      nameEn: 'Test Group',
      currencyCode: 'ILS',
    });
    expect(res.body.brands.map((b) => b.id)).toEqual(brandIds());
    expect(res.body.brands[0]).toMatchObject({
      nameEn: 'Test Tenant',
      logoFileId: null,
    });
    expect(res.body.brands[0]?.locations.map((l) => l.code)).toEqual(['LOCA', 'LOCB']);
    expect(res.body.brands[0]?.locations[0]).toMatchObject({
      id: org.brands[0]!.locationA,
      timezone: 'Asia/Riyadh',
    });
  });

  it('builds the dashboard: periods, brands, branches and hubs', async () => {
    const now = new Date('2026-10-13T12:00:00Z');
    await prisma.device.create({
      data: {
        tenantId: brandIds()[0]!,
        locationId: org.brands[0]!.locationA,
        name: 'Hub A',
        type: 'GATEWAY',
        status: 'ACTIVE',
        credentialHash: 'x',
        lastSeenAt: now,
      },
    });
    await prisma.device.create({
      data: {
        tenantId: brandIds()[0]!,
        locationId: org.brands[0]!.locationB,
        name: 'Hub B',
        type: 'GATEWAY',
        status: 'ACTIVE',
        credentialHash: 'y',
        lastSeenAt: new Date(now.getTime() - 3_600_000),
      },
    });
    const res = await dashboardOf(brandIds(), now);
    const all = Object.values(orders).flatMap((o) => Object.values(o));
    const total = all.reduce((sum, o) => sum + o.total, 0);
    expect(res.currencyCode).toBe('ILS');
    expect(res.periods.last30).toEqual({
      salesTotal: total,
      orderCount: all.length,
      averageTicket: Math.round(total / all.length),
    });
    expect(res.periods.today).toEqual({ salesTotal: 0, orderCount: 0, averageTicket: 0 });
    expect(res.periods.last7.orderCount).toBe(all.length);
    expect(res.byBrand.map((b) => b.tenantId)).toEqual(brandIds());
    expect(res.byBrand[0]).toEqual({
      tenantId: brandIds()[0],
      salesTotal: Object.values(orders[0]!).reduce((sum, o) => sum + o.total, 0),
      orderCount: 4,
    });
    expect(res.byLocation).toHaveLength(4);
    const hub = (id: string) => res.byLocation.find((l) => l.locationId === id)?.hubOnline;
    expect(hub(org.brands[0]!.locationA)).toBe(true);
    expect(hub(org.brands[0]!.locationB)).toBe(false);
    expect(hub(org.brands[1]!.locationA)).toBe(false);
    expect(res.daily.at(-1)?.date).toBe('2026-10-13');
    expect(res.daily).toHaveLength(30);
    const oct12 = res.daily.find((d) => d.date === '2026-10-12');
    expect(oct12?.byTenant[brandIds()[0]!]).toBe(orders[0]!.extra!.total);
    expect(oct12?.byTenant[brandIds()[1]!]).toBe(0);
  });

  it("the dashboard counts each branch's business day in its own timezone", async () => {
    const brand = org.brands[0]!;
    await prisma.location.update({
      where: { id: brand.locationA },
      data: { timezone: 'Asia/Hebron' },
    });
    await prisma.location.update({ where: { id: brand.locationB }, data: { timezone: 'UTC' } });
    const menu = menus[0]!;
    const seed = reportSeeder(prisma, brand.tenantId, 'ILS');
    const vat = { id: menu.vat.id, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 };
    const sale = (locationId: string, businessDate: string, at: string) =>
      seed.order({
        locationId,
        businessDate,
        channel: 'DINE_IN',
        taxInclusive: true,
        at,
        lines: [{ product: menu.burger, unitPrice: 1000, quantity: 1, taxes: [vat] }],
      });
    // 23:30Z on 10-20: already 10-21 in Hebron (UTC+3 until the end of October), still 10-20 in UTC.
    const now = new Date('2026-10-20T23:30:00Z');
    const hebronToday = await sale(brand.locationA, '2026-10-21', '2026-10-20T23:15:00Z');
    const hebronYesterday = await sale(brand.locationA, '2026-10-20', '2026-10-20T10:00:00Z');
    const utcToday = await sale(brand.locationB, '2026-10-20', '2026-10-20T23:15:00Z');
    const dashboard = await dashboardOf([brand.tenantId], now);
    expect(dashboard.periods.today.orderCount).toBe(2);
    expect(dashboard.periods.today.salesTotal).toBe(hebronToday.total + utcToday.total);
    expect(dashboard.periods.last7.orderCount).toBe(3);
    const day = (date: string) =>
      dashboard.daily.find((d) => d.date === date)?.byTenant[brand.tenantId];
    // Each branch's own business date lands in the series (the old orders are on other days).
    expect(day('2026-10-21')).toBe(hebronToday.total);
    expect(day('2026-10-20')).toBe(hebronYesterday.total + utcToday.total);
    const hebron = dashboard.byLocation.find((l) => l.locationId === brand.locationA);
    expect(hebron?.orderCount).toBe(4);
  });
});
