import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient, hashSecret } from '@pos/database';
import { businessDateFor, newId } from '@pos/domain';
import type {
  CategoryReport,
  ChannelReport,
  DailySalesReport,
  DiscountReport,
  Order,
  PaymentReport,
  PrepTimeReport,
  ProductReport,
  SalesFigures,
  Shift,
  ShiftReport,
  TaxReport,
} from '@pos/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';
import {
  type SeedDiscount,
  type SeedMethod,
  type SeedTax,
  type SeededOrder,
  reportSeeder,
} from './report-fixture';

/*
 * Phase 9 reports against a seeded history whose figures were worked out by hand (see each
 * order's comment). The restaurant is in SAR (2 decimals) and Asia/Riyadh (UTC+3): business date
 * 2026-10-10 runs from 2026-10-09T21:00Z to 2026-10-10T21:00Z. Location A prices include VAT 15%,
 * location B adds it.
 */

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;
/** `reports.view` at location A only. */
let manager: Record<string, string>;
/** No `reports.view` anywhere. */
let waiter: Record<string, string>;
let base: string;
let o: Record<'o1' | 'o2' | 'o3' | 'o4' | 'o5' | 'o6' | 'o7', SeededOrder>;
let stations: { grill: string; bar: string };

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  await resetDatabase(prisma);
  tenant = await createTenant(prisma, ['orders.view', 'reports.view', 'locations.view']);
  const menu = await createMenuFixture(prisma, tenant);
  const rid = tenant.restaurantId;
  await prisma.location.update({ where: { id: tenant.locationB }, data: { taxInclusive: false } });

  const waiterRole = await prisma.role.create({
    data: {
      restaurantId: rid,
      name: 'Waiter',
      permissions: { create: [{ permissionKey: 'orders.view' }] },
    },
  });
  const waiterUser = await prisma.user.create({
    data: {
      restaurantId: rid,
      email: `waiter-${newId()}@test.local`,
      passwordHash: await hashSecret(PASSWORD),
      displayName: 'Waiter',
      roles: { create: { roleId: waiterRole.id, locationId: null } },
    },
  });

  // Catalog beyond the menu fixture: an untaxed drink and a taxed dessert in their categories.
  const drinks = await prisma.category.create({
    data: { restaurantId: rid, nameEn: 'Drinks', nameAr: 'مشروبات' },
  });
  const desserts = await prisma.category.create({
    data: { restaurantId: rid, nameEn: 'Desserts', nameAr: 'حلويات' },
  });
  const water = await prisma.product.create({
    data: { restaurantId: rid, categoryId: drinks.id, nameEn: 'Water', nameAr: 'ماء', price: 300 },
  });
  const cake = await prisma.product.create({
    data: {
      restaurantId: rid,
      categoryId: desserts.id,
      nameEn: 'Cake',
      nameAr: 'كعكة',
      price: 1000,
    },
  });
  const bar = await prisma.kitchenStation.create({
    data: { restaurantId: rid, code: 'BAR', nameEn: 'Bar', nameAr: 'المشروبات', sortOrder: 1 },
  });
  stations = { grill: menu.grill.id, bar: bar.id };
  const fiveOff = await prisma.discount.create({
    data: { restaurantId: rid, nameEn: '5 off', nameAr: 'خصم 5', type: 'FIXED', value: 500 },
  });
  const method = async (type: SeedMethod['type'], nameEn: string, nameAr: string) => {
    const m = await prisma.paymentMethod.create({
      data: { restaurantId: rid, type, nameEn, nameAr },
    });
    return { id: m.id, type, nameEn, nameAr };
  };
  const cash = await method('CASH', 'Cash', 'نقدًا');
  const card = await method('CARD', 'Card', 'بطاقة');
  const online = await method('ONLINE', 'Online', 'إلكتروني');
  const register = async (locationId: string) =>
    (await prisma.cashRegister.create({ data: { locationId, nameEn: 'Drawer', nameAr: 'الدرج' } }))
      .id;
  const drawerA = await register(tenant.locationA);
  const drawerB = await register(tenant.locationB);

  const vat: SeedTax = { id: menu.vat.id, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 };
  const tenPercent: SeedDiscount = {
    id: menu.tenPercent.id,
    nameEn: '10% off',
    nameAr: 'خصم 10%',
    type: 'PERCENTAGE',
    value: 1000,
  };
  const five: SeedDiscount = { ...fiveOff, type: 'FIXED' };
  const burger = (quantity: number) => ({
    product: menu.burger,
    unitPrice: 2500,
    quantity,
    taxes: [vat],
  });
  const seed = reportSeeder(prisma, rid);
  const A = tenant.locationA;
  const B = tenant.locationB;
  const ownerId = tenant.owner.id;

  // Shifts. S1: A, opened at midnight of 10-10 (local), closed 20 short. S3: A on 10-11.
  // S2: B on 10-11, still open. S4: A, 01:00 on 10-12 (local) — outside the period.
  const s1 = await seed.shift({
    locationId: A,
    registerId: drawerA,
    openedById: ownerId,
    openedAt: '2026-10-09T21:00:00Z',
    openingFloat: 10_000,
    closed: {
      at: '2026-10-10T20:00:00Z',
      expectedCash: 14_220,
      countedCash: 14_200,
      byId: ownerId,
    },
  });
  const s3 = await seed.shift({
    locationId: A,
    registerId: drawerA,
    openedById: ownerId,
    openedAt: '2026-10-11T06:00:00Z',
    openingFloat: 0,
    closed: { at: '2026-10-11T18:00:00Z', expectedCash: 0, countedCash: 0, byId: ownerId },
  });
  const s2 = await seed.shift({
    locationId: B,
    registerId: drawerB,
    openedById: ownerId,
    openedAt: '2026-10-11T05:00:00Z',
    openingFloat: 5_000,
  });
  const s4 = await seed.shift({
    locationId: A,
    registerId: drawerA,
    openedById: ownerId,
    openedAt: '2026-10-11T22:00:00Z',
    openingFloat: 0,
  });

  // O1 (A, 10-10 00:15 local, dine-in): 2 burgers + large cola, 10% off. Subtotal 5800,
  // discount 580 (500 + 80), VAT included 587 + 94 = 681, total 5220, net sales 4539.
  // Paid in cash at 00:30 local — still 10-09 in UTC.
  o = {} as typeof o;
  o.o1 = await seed.order({
    locationId: A,
    businessDate: '2026-10-10',
    channel: 'DINE_IN',
    taxInclusive: true,
    at: '2026-10-09T21:15:00Z',
    lines: [
      burger(2),
      { product: menu.cola, variant: menu.large, unitPrice: 800, quantity: 1, taxes: [vat] },
    ],
    discounts: [tenPercent],
  });
  await seed.payment({
    order: o.o1,
    method: cash,
    amount: 5_220,
    at: '2026-10-09T21:30:00Z',
    shiftId: s1,
  });

  // O2 (A, 10-10, takeaway): small cola (VAT 78 included) + untaxed water. Total 900, net 822.
  // Paid by card; 3.00 refunded on 10-11 → tax 26, net sales 274.
  o.o2 = await seed.order({
    locationId: A,
    businessDate: '2026-10-10',
    channel: 'TAKEAWAY',
    taxInclusive: true,
    at: '2026-10-10T09:00:00Z',
    lines: [
      { product: menu.cola, variant: menu.small, unitPrice: 600, quantity: 1, taxes: [vat] },
      { product: water, unitPrice: 300, quantity: 1, taxes: [] },
    ],
  });
  const o2Charge = await seed.payment({
    order: o.o2,
    method: card,
    amount: 900,
    at: '2026-10-10T09:05:00Z',
    shiftId: s1,
  });
  await seed.payment({
    order: o.o2,
    method: card,
    amount: 300,
    at: '2026-10-11T08:00:00Z',
    shiftId: s3,
    refundOf: o2Charge,
  });

  // O3 (A, 10-10, phone): prepaid in cash, refunded, then cancelled. Not a sale; the money
  // movements still show in the payment and shift reports.
  o.o3 = await seed.order({
    locationId: A,
    businessDate: '2026-10-10',
    channel: 'PHONE',
    status: 'CANCELLED',
    taxInclusive: true,
    at: '2026-10-10T10:00:00Z',
    lines: [burger(1)],
  });
  const o3Charge = await seed.payment({
    order: o.o3,
    method: cash,
    amount: 2_500,
    at: '2026-10-10T10:05:00Z',
    shiftId: s1,
  });
  await seed.payment({
    order: o.o3,
    method: cash,
    amount: 2_500,
    at: '2026-10-10T10:20:00Z',
    shiftId: s1,
    refundOf: o3Charge,
  });
  await seed.cashMovement(s1, 'PAY_OUT', 1_000, '2026-10-10T12:00:00Z');

  // O4 (A, 10-11, website delivery): burger (VAT 326 included) + 5.00 untaxed fee = 3000,
  // net 2174; paid online and fully refunded the same day (status REFUNDED).
  o.o4 = await seed.order({
    locationId: A,
    businessDate: '2026-10-11',
    channel: 'WEBSITE',
    status: 'REFUNDED',
    taxInclusive: true,
    at: '2026-10-11T12:00:00Z',
    lines: [burger(1)],
    fee: 500,
  });
  const o4Charge = await seed.payment({
    order: o.o4,
    method: online,
    amount: 3_000,
    at: '2026-10-11T12:00:00Z',
    shiftId: null,
  });
  await seed.payment({
    order: o.o4,
    method: online,
    amount: 3_000,
    at: '2026-10-11T12:30:00Z',
    shiftId: null,
    refundOf: o4Charge,
  });

  // O5 (A, 10-11, dine-in): still in the kitchen. Not a sale.
  o.o5 = await seed.order({
    locationId: A,
    businessDate: '2026-10-11',
    channel: 'DINE_IN',
    status: 'PREPARING',
    taxInclusive: true,
    at: '2026-10-11T13:00:00Z',
    lines: [burger(1)],
  });

  // O6 (A, 01:30 on 10-12 local = 22:30Z on 10-11): outside the period.
  o.o6 = await seed.order({
    locationId: A,
    businessDate: '2026-10-12',
    channel: 'DINE_IN',
    taxInclusive: true,
    at: '2026-10-11T22:30:00Z',
    lines: [burger(1)],
  });
  await seed.payment({
    order: o.o6,
    method: cash,
    amount: 2_500,
    at: '2026-10-11T22:40:00Z',
    shiftId: s4,
  });

  // O7 (B, tax-exclusive, 10-11, staff-taken delivery): 3 cakes 3000 − 5.00 off = 2500 net,
  // + VAT 375 = 2875. Card; 5.75 refunded → tax 75, net sales 500.
  o.o7 = await seed.order({
    locationId: B,
    businessDate: '2026-10-11',
    channel: 'DELIVERY',
    taxInclusive: false,
    at: '2026-10-11T10:00:00Z',
    lines: [{ product: cake, unitPrice: 1_000, quantity: 3, taxes: [vat] }],
    discounts: [five],
  });
  const o7Charge = await seed.payment({
    order: o.o7,
    method: card,
    amount: 2_875,
    at: '2026-10-11T10:10:00Z',
    shiftId: s2,
  });
  await seed.payment({
    order: o.o7,
    method: card,
    amount: 575,
    at: '2026-10-11T11:00:00Z',
    shiftId: s2,
    refundOf: o7Charge,
  });

  // Kitchen: grill 10 min (O1) and 20 min (O4, later than the 15-minute threshold), bar 2 min
  // (O1). Not counted: a cancelled bar ticket, one still cooking, one outside the period.
  await seed.ticket({
    order: o.o1,
    stationId: stations.grill,
    at: '2026-10-09T21:16:00Z',
    startedAfter: 60,
    readyAfter: 600,
    status: 'COMPLETED',
  });
  await seed.ticket({
    order: o.o1,
    stationId: stations.bar,
    at: '2026-10-09T21:16:00Z',
    startedAfter: 30,
    readyAfter: 120,
    status: 'READY',
  });
  await seed.ticket({
    order: o.o4,
    stationId: stations.grill,
    at: '2026-10-11T12:01:00Z',
    startedAfter: 120,
    readyAfter: 1_200,
    status: 'COMPLETED',
  });
  await seed.ticket({
    order: o.o2,
    stationId: stations.bar,
    at: '2026-10-10T09:01:00Z',
    status: 'CANCELLED',
  });
  await seed.ticket({
    order: o.o5,
    stationId: stations.grill,
    at: '2026-10-11T13:01:00Z',
    startedAfter: 60,
    status: 'PREPARING',
  });
  await seed.ticket({
    order: o.o6,
    stationId: stations.grill,
    at: '2026-10-11T22:31:00Z',
    readyAfter: 300,
    status: 'COMPLETED',
  });

  owner = bearer(await login(app, tenant.owner.email));
  manager = bearer(await login(app, tenant.cashier.email));
  waiter = bearer(await login(app, waiterUser.email));
  base = `/api/v1/restaurants/${rid}/reports`;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// The caller names the response type, as with light-my-request's `json<T>()`.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function get<T>(
  report: string,
  query: string,
  headers: Record<string, string> = owner,
): Promise<{ status: number; body: T }> {
  const res = await app.inject({ method: 'GET', url: `${base}/${report}?${query}`, headers });
  return { status: res.statusCode, body: res.json<T>() };
}
const PERIOD = 'from=2026-10-10&to=2026-10-11';

const noRefunds = { count: 0, amount: 0, tax: 0, fees: 0, netSales: 0 };
const zero: SalesFigures = {
  orders: 0,
  grossSales: 0,
  discounts: 0,
  netSales: 0,
  tax: 0,
  fees: 0,
  totalSales: 0,
  averageNetSale: 0,
  refunds: noRefunds,
  netSalesAfterRefunds: 0,
  taxAfterRefunds: 0,
  cancelledOrders: 0,
};

describe('daily sales', () => {
  it('counts completed sales on their business date and refunds on the day they were made', async () => {
    const { status, body } = await get<DailySalesReport>('daily-sales', PERIOD);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      from: '2026-10-10',
      to: '2026-10-11',
      currencyCode: 'SAR',
      channels: null,
    });
    expect([...body.locationIds].sort()).toEqual([tenant.locationA, tenant.locationB].sort());
    expect(body.rows).toEqual([
      {
        businessDate: '2026-10-10',
        orders: 2,
        grossSales: 6_700,
        discounts: 580,
        netSales: 5_361,
        tax: 759,
        fees: 0,
        totalSales: 6_120,
        averageNetSale: 2_681,
        refunds: noRefunds,
        netSalesAfterRefunds: 5_361,
        taxAfterRefunds: 759,
        cancelledOrders: 1,
      },
      {
        businessDate: '2026-10-11',
        orders: 2,
        grossSales: 5_500,
        discounts: 500,
        netSales: 4_674,
        tax: 701,
        fees: 500,
        totalSales: 5_875,
        averageNetSale: 2_337,
        refunds: { count: 3, amount: 3_875, tax: 427, fees: 500, netSales: 2_948 },
        netSalesAfterRefunds: 1_726,
        taxAfterRefunds: 274,
        cancelledOrders: 0,
      },
    ]);
    expect(body.totals).toEqual({
      orders: 4,
      grossSales: 12_200,
      discounts: 1_080,
      netSales: 10_035,
      tax: 1_460,
      fees: 500,
      totalSales: 11_995,
      averageNetSale: 2_509,
      refunds: { count: 3, amount: 3_875, tax: 427, fees: 500, netSales: 2_948 },
      netSalesAfterRefunds: 7_087,
      taxAfterRefunds: 1_033,
      cancelledOrders: 1,
    });
    // What was paid minus what was refunded equals the money the payment report shows.
    const payments = await get<PaymentReport>('payments', PERIOD);
    expect(body.totals.totalSales - body.totals.refunds.amount).toBe(payments.body.totals.net);
  });

  it('uses the location time zone for day boundaries', async () => {
    const late = await get<DailySalesReport>('daily-sales', 'from=2026-10-12&to=2026-10-12');
    expect(late.body.totals).toMatchObject({ orders: 1, totalSales: 2_500, netSales: 2_174 });
    const payments = await get<PaymentReport>('payments', 'from=2026-10-12&to=2026-10-12');
    expect(payments.body.totals).toMatchObject({ charges: 2_500, chargeCount: 1, net: 2_500 });
    // O1's payment was made at 21:30Z on 10-09, which is 00:30 on 10-10 in Riyadh.
    const first = await get<PaymentReport>('payments', 'from=2026-10-10&to=2026-10-10');
    expect(first.body.rows.find((r) => r.nameEn === 'Cash')).toMatchObject({ charges: 7_720 });
    const before = await get<PaymentReport>('payments', 'from=2026-10-09&to=2026-10-09');
    expect(before.body.rows).toEqual([]);
  });

  it('lists every day of the period, with zeros on quiet days', async () => {
    const { body } = await get<DailySalesReport>('daily-sales', 'from=2026-10-08&to=2026-10-10');
    expect(body.rows.map((r) => [r.businessDate, r.orders])).toEqual([
      ['2026-10-08', 0],
      ['2026-10-09', 0],
      ['2026-10-10', 2],
    ]);
    expect(body.rows[0]).toEqual({ businessDate: '2026-10-08', ...zero });
  });

  it('filters by channel and by location', async () => {
    const channels = await get<DailySalesReport>(
      'daily-sales',
      `${PERIOD}&channels=DINE_IN,TAKEAWAY`,
    );
    expect(channels.body.channels).toEqual(['DINE_IN', 'TAKEAWAY']);
    expect(channels.body.totals).toMatchObject({
      orders: 2,
      netSales: 5_361,
      refunds: { count: 1, amount: 300, tax: 26, fees: 0, netSales: 274 },
      netSalesAfterRefunds: 5_087,
      cancelledOrders: 0,
    });
    const locationB = await get<DailySalesReport>(
      'daily-sales',
      `${PERIOD}&locationIds=${tenant.locationB}`,
    );
    expect(locationB.body.locationIds).toEqual([tenant.locationB]);
    expect(locationB.body.totals).toMatchObject({
      orders: 1,
      grossSales: 3_000,
      discounts: 500,
      netSales: 2_500,
      tax: 375,
      totalSales: 2_875,
      refunds: { count: 1, amount: 575, tax: 75, fees: 0, netSales: 500 },
    });
  });
});

describe('orders by channel', () => {
  it('distinguishes all five channels with their share of net sales', async () => {
    const { body } = await get<ChannelReport>('channels', PERIOD);
    expect(body.rows.map((r) => r.channel)).toEqual([
      'DINE_IN',
      'TAKEAWAY',
      'PHONE',
      'WEBSITE',
      'DELIVERY',
    ]);
    const row = (channel: string) => body.rows.find((r) => r.channel === channel);
    expect(row('DINE_IN')).toEqual({
      ...zero,
      channel: 'DINE_IN',
      orders: 1,
      grossSales: 5_800,
      discounts: 580,
      netSales: 4_539,
      tax: 681,
      totalSales: 5_220,
      averageNetSale: 4_539,
      netSalesAfterRefunds: 4_539,
      taxAfterRefunds: 681,
      shareBps: 4_523,
    });
    expect(row('TAKEAWAY')).toMatchObject({
      orders: 1,
      netSales: 822,
      refunds: { count: 1, amount: 300, tax: 26, fees: 0, netSales: 274 },
      netSalesAfterRefunds: 548,
      shareBps: 819,
    });
    expect(row('PHONE')).toEqual({ ...zero, channel: 'PHONE', cancelledOrders: 1, shareBps: 0 });
    expect(row('WEBSITE')).toMatchObject({
      orders: 1,
      netSales: 2_174,
      fees: 500,
      totalSales: 3_000,
      refunds: { count: 1, amount: 3_000, tax: 326, fees: 500, netSales: 2_174 },
      netSalesAfterRefunds: 0,
      taxAfterRefunds: 0,
      shareBps: 2_166,
    });
    expect(row('DELIVERY')).toMatchObject({
      orders: 1,
      netSales: 2_500,
      netSalesAfterRefunds: 2_000,
      shareBps: 2_491,
    });
    expect(body.totals.netSales).toBe(10_035);
  });

  it('lists only the requested channels', async () => {
    const { body } = await get<ChannelReport>('channels', `${PERIOD}&channels=WEBSITE`);
    expect(body.rows.map((r) => [r.channel, r.shareBps])).toEqual([['WEBSITE', 10_000]]);
  });
});

describe('payment summary', () => {
  it('sums money by method and by channel on the day it moved, cancelled orders included', async () => {
    const { body } = await get<PaymentReport>('payments', PERIOD);
    expect(body.rows.map(({ paymentMethodId: _, ...r }) => r)).toEqual([
      {
        methodType: 'CARD',
        nameEn: 'Card',
        nameAr: 'بطاقة',
        charges: 3_775,
        chargeCount: 2,
        refunds: 875,
        refundCount: 2,
        net: 2_900,
        roundingAdjustment: 0,
      },
      {
        methodType: 'CASH',
        nameEn: 'Cash',
        nameAr: 'نقدًا',
        charges: 7_720,
        chargeCount: 2,
        refunds: 2_500,
        refundCount: 1,
        net: 5_220,
        roundingAdjustment: 0,
      },
      {
        methodType: 'ONLINE',
        nameEn: 'Online',
        nameAr: 'إلكتروني',
        charges: 3_000,
        chargeCount: 1,
        refunds: 3_000,
        refundCount: 1,
        net: 0,
        roundingAdjustment: 0,
      },
    ]);
    expect(body.byChannel).toEqual([
      {
        channel: 'DINE_IN',
        charges: 5_220,
        chargeCount: 1,
        refunds: 0,
        refundCount: 0,
        net: 5_220,
      },
      { channel: 'TAKEAWAY', charges: 900, chargeCount: 1, refunds: 300, refundCount: 1, net: 600 },
      { channel: 'PHONE', charges: 2_500, chargeCount: 1, refunds: 2_500, refundCount: 1, net: 0 },
      {
        channel: 'WEBSITE',
        charges: 3_000,
        chargeCount: 1,
        refunds: 3_000,
        refundCount: 1,
        net: 0,
      },
      {
        channel: 'DELIVERY',
        charges: 2_875,
        chargeCount: 1,
        refunds: 575,
        refundCount: 1,
        net: 2_300,
      },
    ]);
    expect(body.totals).toEqual({
      charges: 14_495,
      chargeCount: 5,
      refunds: 6_375,
      refundCount: 4,
      net: 8_120,
      roundingAdjustment: 0,
    });
  });
});

describe('product and category sales', () => {
  it('reports line quantities and amounts, best sellers first, adding up to net sales', async () => {
    const { body } = await get<ProductReport>('products', PERIOD);
    expect(
      body.rows.map((r) => [
        r.nameEn,
        r.variantNameEn,
        r.categoryNameEn,
        r.quantity,
        r.orders,
        r.grossSales,
        r.discounts,
        r.tax,
        r.netSales,
        r.shareBps,
      ]),
    ).toEqual([
      ['Burger', null, 'Mains', 3, 2, 7_500, 500, 913, 6_087, 6_066],
      ['Cake', null, 'Desserts', 3, 1, 3_000, 500, 375, 2_500, 2_491],
      ['Cola', 'Large', 'Mains', 1, 1, 800, 80, 94, 626, 624],
      ['Cola', 'Small', 'Mains', 1, 1, 600, 0, 78, 522, 520],
      ['Water', null, 'Drinks', 1, 1, 300, 0, 0, 300, 299],
    ]);
    expect(body.totals).toEqual({
      quantity: 9,
      orders: 4,
      grossSales: 12_200,
      discounts: 1_080,
      tax: 1_460,
      netSales: 10_035,
      shareBps: 10_000,
    });
  });

  it('groups by category', async () => {
    const { body } = await get<CategoryReport>('categories', PERIOD);
    expect(
      body.rows.map((r) => [
        r.nameEn,
        r.nameAr,
        r.products,
        r.quantity,
        r.orders,
        r.netSales,
        r.tax,
      ]),
    ).toEqual([
      ['Mains', 'رئيسية', 2, 5, 3, 7_235, 1_085],
      ['Desserts', 'حلويات', 1, 3, 1, 2_500, 375],
      ['Drinks', 'مشروبات', 1, 1, 1, 300, 0],
    ]);
    const dineIn = await get<CategoryReport>('categories', `${PERIOD}&channels=DINE_IN`);
    expect(dineIn.body.rows.map((r) => [r.nameEn, r.quantity, r.netSales])).toEqual([
      ['Mains', 3, 4_539],
    ]);
  });
});

describe('tax summary', () => {
  it('reports each tax per price mode with the tax part of refunds', async () => {
    const { body } = await get<TaxReport>('taxes', PERIOD);
    expect(body.rows.map(({ taxId: _, ...r }) => r)).toEqual([
      {
        nameEn: 'VAT',
        nameAr: 'ضريبة',
        rateBps: 1_500,
        taxInclusive: false,
        orders: 1,
        taxableAmount: 2_500,
        tax: 375,
        refundedTax: 75,
        netTax: 300,
      },
      {
        nameEn: 'VAT',
        nameAr: 'ضريبة',
        rateBps: 1_500,
        taxInclusive: true,
        orders: 3,
        taxableAmount: 7_235,
        tax: 1_085,
        refundedTax: 352,
        netTax: 733,
      },
    ]);
    expect(body.totals).toEqual({ orders: 4, tax: 1_460, refundedTax: 427, netTax: 1_033 });
  });
});

describe('discount summary', () => {
  it('reports each discount and its share of gross sales', async () => {
    const { body } = await get<DiscountReport>('discounts', PERIOD);
    expect(body.rows.map(({ discountId: _, ...r }) => r)).toEqual([
      {
        nameEn: '10% off',
        nameAr: 'خصم 10%',
        type: 'PERCENTAGE',
        value: 1_000,
        applications: 1,
        orders: 1,
        amount: 580,
      },
      {
        nameEn: '5 off',
        nameAr: 'خصم 5',
        type: 'FIXED',
        value: 500,
        applications: 1,
        orders: 1,
        amount: 500,
      },
    ]);
    expect(body.totals).toEqual({
      applications: 2,
      orders: 2,
      amount: 1_080,
      grossSales: 12_200,
      shareOfGrossBps: 885,
    });
  });
});

describe('shift summary', () => {
  it('reports shifts opened in the period with cash, tenders and over/short', async () => {
    const { body } = await get<ShiftReport>('shifts', `${PERIOD}&channels=DINE_IN`);
    // Channels do not apply to drawers.
    expect(body.channels).toBeNull();
    expect(
      body.rows.map((r) => [
        r.businessDate,
        r.locationId === tenant.locationA ? 'A' : 'B',
        r.status,
      ]),
    ).toEqual([
      ['2026-10-11', 'A', 'CLOSED'],
      ['2026-10-11', 'B', 'OPEN'],
      ['2026-10-10', 'A', 'CLOSED'],
    ]);
    const [s3, s2, s1] = body.rows;
    expect(s1).toMatchObject({
      openingFloat: 10_000,
      cashSales: 7_720,
      cashRefunds: 2_500,
      payIns: 0,
      payOuts: 1_000,
      expectedCash: 14_220,
      countedCash: 14_200,
      cashDifference: -20,
      charges: 8_620,
      refunds: 2_500,
      netCollected: 6_120,
      orders: 3,
      openedByName: 'Owner',
      closedByName: 'Owner',
      cashRegisterNameEn: 'Drawer',
    });
    expect(s1?.byMethod.map((m) => [m.nameEn, m.charges, m.refunds, m.net])).toEqual([
      ['Card', 900, 0, 900],
      ['Cash', 7_720, 2_500, 5_220],
    ]);
    expect(s2).toMatchObject({
      status: 'OPEN',
      expectedCash: 5_000,
      countedCash: null,
      cashDifference: null,
      closedAt: null,
      closedByName: null,
      netCollected: 2_300,
      orders: 1,
    });
    expect(s3).toMatchObject({ charges: 0, refunds: 300, netCollected: -300, cashDifference: 0 });
    expect(body.totals).toEqual({
      shifts: 3,
      openShifts: 1,
      openingFloat: 15_000,
      cashSales: 7_720,
      cashRefunds: 2_500,
      payIns: 0,
      payOuts: 1_000,
      expectedCash: 19_220,
      cashDifference: -20,
      charges: 11_495,
      refunds: 3_375,
      netCollected: 8_120,
      orders: 4,
    });
  });
});

describe('kitchen prep times', () => {
  it('reports prep and wait times per station from ticket timestamps', async () => {
    const { body } = await get<PrepTimeReport>('prep-times', PERIOD);
    expect(body.rows.map(({ stationId: _, ...r }) => r)).toEqual([
      {
        code: 'GRILL',
        nameEn: 'Grill',
        nameAr: 'شواية',
        tickets: 2,
        averagePrepSeconds: 900,
        medianPrepSeconds: 900,
        p90PrepSeconds: 1_140,
        maxPrepSeconds: 1_200,
        averageWaitSeconds: 90,
        lateTickets: 1,
        lateShareBps: 5_000,
      },
      {
        code: 'BAR',
        nameEn: 'Bar',
        nameAr: 'المشروبات',
        tickets: 1,
        averagePrepSeconds: 120,
        medianPrepSeconds: 120,
        p90PrepSeconds: 120,
        maxPrepSeconds: 120,
        averageWaitSeconds: 30,
        lateTickets: 0,
        lateShareBps: 0,
      },
    ]);
    expect(body.totals).toEqual({
      tickets: 3,
      averagePrepSeconds: 640,
      medianPrepSeconds: 600,
      p90PrepSeconds: 1_080,
      maxPrepSeconds: 1_200,
      averageWaitSeconds: 70,
      lateTickets: 1,
      lateShareBps: 3_333,
    });
    const website = await get<PrepTimeReport>('prep-times', `${PERIOD}&channels=WEBSITE`);
    expect(website.body.rows.map((r) => [r.code, r.tickets, r.averagePrepSeconds])).toEqual([
      ['GRILL', 1, 1_200],
      ['BAR', 0, 0],
    ]);
  });
});

describe('access', () => {
  it('limits a manager to the locations where they may view reports', async () => {
    const { status, body } = await get<DailySalesReport>('daily-sales', PERIOD, manager);
    expect(status).toBe(200);
    expect(body.locationIds).toEqual([tenant.locationA]);
    expect(body.totals).toMatchObject({ orders: 3, netSales: 7_535 });
    const other = await get<{ code: string }>(
      'products',
      `${PERIOD}&locationIds=${tenant.locationB}`,
      manager,
    );
    expect(other.status).toBe(404);
    expect(other.body.code).toBe('LOCATION_NOT_FOUND');
  });

  it('refuses callers without reports.view and other restaurants', async () => {
    const denied = await get<{ code: string }>('daily-sales', PERIOD, waiter);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('INSUFFICIENT_PERMISSION');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/restaurants/${newId()}/reports/daily-sales?${PERIOD}`,
      headers: owner,
    });
    expect(res.statusCode).toBe(404);
    const anonymous = await app.inject({ method: 'GET', url: `${base}/daily-sales?${PERIOD}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('validates the period and filters', async () => {
    for (const query of [
      'from=2026-10-11&to=2026-10-10',
      'from=2025-01-01&to=2026-01-02',
      'to=2026-10-10',
      `${PERIOD}&channels=DRIVE_THRU`,
      `${PERIOD}&locationIds=not-a-uuid`,
    ]) {
      const res = await get<{ code: string }>('daily-sales', query);
      expect(res.status, query).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    const leapYear = await get<DailySalesReport>('daily-sales', 'from=2028-01-01&to=2028-12-31');
    expect(leapYear.body.rows).toHaveLength(366);
  });
});

describe('3-decimal currency', () => {
  it('reports KWD amounts in fils and splits refunds by largest remainder', async () => {
    const kw = await createTenant(prisma);
    await prisma.restaurant.update({
      where: { id: kw.restaurantId },
      data: { currencyCode: 'KWD', timezone: 'Asia/Kuwait' },
    });
    await prisma.location.update({
      where: { id: kw.locationA },
      data: { timezone: 'Asia/Kuwait', taxInclusive: false },
    });
    const category = await prisma.category.create({
      data: { restaurantId: kw.restaurantId, nameEn: 'Mains', nameAr: 'رئيسية' },
    });
    const product = await prisma.product.create({
      data: {
        restaurantId: kw.restaurantId,
        categoryId: category.id,
        nameEn: 'Machboos',
        nameAr: 'مكبوس',
        price: 1_250,
      },
    });
    const tax = await prisma.tax.create({
      data: { restaurantId: kw.restaurantId, nameEn: 'Tax', nameAr: 'ضريبة', rateBps: 500 },
    });
    const method = await prisma.paymentMethod.create({
      data: { restaurantId: kw.restaurantId, type: 'ONLINE', nameEn: 'Online', nameAr: 'إلكتروني' },
    });
    const seed = reportSeeder(prisma, kw.restaurantId, 'KWD');
    // 2 × 1.250 = 2.500 + 5% = 0.125 → 2.625 KWD; 1.000 refunded → tax 0.048, net 0.952.
    const sale = await seed.order({
      locationId: kw.locationA,
      businessDate: '2026-10-10',
      channel: 'TAKEAWAY',
      taxInclusive: false,
      at: '2026-10-10T08:00:00Z',
      lines: [{ product, unitPrice: 1_250, quantity: 2, taxes: [{ ...tax }] }],
    });
    const m = { id: method.id, type: 'ONLINE' as const, nameEn: 'Online', nameAr: 'إلكتروني' };
    const charge = await seed.payment({
      order: sale,
      method: m,
      amount: 2_625,
      at: '2026-10-10T08:01:00Z',
      shiftId: null,
    });
    await seed.payment({
      order: sale,
      method: m,
      amount: 1_000,
      at: '2026-10-10T09:00:00Z',
      shiftId: null,
      refundOf: charge,
    });

    const kwOwner = bearer(await login(app, kw.owner.email));
    const url = `/api/v1/restaurants/${kw.restaurantId}/reports`;
    const daily = (
      await app.inject({
        method: 'GET',
        url: `${url}/daily-sales?from=2026-10-10&to=2026-10-10`,
        headers: kwOwner,
      })
    ).json<DailySalesReport>();
    expect(daily.currencyCode).toBe('KWD');
    expect(daily.totals).toMatchObject({
      orders: 1,
      grossSales: 2_500,
      netSales: 2_500,
      tax: 125,
      totalSales: 2_625,
      refunds: { count: 1, amount: 1_000, tax: 48, fees: 0, netSales: 952 },
      netSalesAfterRefunds: 1_548,
      taxAfterRefunds: 77,
    });
    const taxes = (
      await app.inject({
        method: 'GET',
        url: `${url}/taxes?from=2026-10-10&to=2026-10-10`,
        headers: kwOwner,
      })
    ).json<TaxReport>();
    expect(taxes.rows).toMatchObject([
      {
        rateBps: 500,
        taxInclusive: false,
        taxableAmount: 2_500,
        tax: 125,
        refundedTax: 48,
        netTax: 77,
      },
    ]);
  });
});

describe('orders taken through the API', () => {
  it('appear in today’s reports exactly as the POS priced and paid them', async () => {
    const t = await createTenant(prisma);
    const menu = await createMenuFixture(prisma, t);
    const cash = await prisma.paymentMethod.create({
      data: { restaurantId: t.restaurantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
    });
    const register = await prisma.cashRegister.create({
      data: { locationId: t.locationA, nameEn: 'Drawer', nameAr: 'الدرج' },
    });
    const headers = bearer(await login(app, t.owner.email));
    const loc = `/api/v1/locations/${t.locationA}`;
    const call = async <T>(url: string, payload: object) => {
      const res = await app.inject({ method: 'POST', url, headers, payload });
      expect(res.statusCode, res.body).toBeLessThan(300);
      return res.json<T>();
    };
    const shift = await call<Shift>(`${loc}/shifts`, {
      id: newId(),
      cashRegisterId: register.id,
      openingFloat: 0,
    });
    // Two large colas, 10% off: no kitchen station, so it can be handed over at once.
    let order = await call<Order>(`${loc}/orders`, {
      id: newId(),
      channel: 'TAKEAWAY',
      items: [menu.colaLine(2, 'large')],
      discountIds: [menu.tenPercent.id],
    });
    const paid = await call<{ order: Order }>(`${loc}/orders/${order.id}/payments`, {
      id: newId(),
      shiftId: shift.id,
      paymentMethodId: cash.id,
      amount: order.total,
      tendered: order.total,
    });
    await call<Order>(`${loc}/orders/${order.id}/transitions`, { to: 'CONFIRMED' });
    order = await call<Order>(`${loc}/orders/${order.id}/transitions`, { to: 'COMPLETED' });
    await call(`${loc}/orders/${order.id}/payments/${paid.order.payments[0]?.id ?? ''}/refunds`, {
      id: newId(),
      shiftId: shift.id,
      amount: 100,
      reason: 'Warm drink',
    });

    const today = businessDateFor(new Date(), 'Asia/Riyadh');
    const url = `/api/v1/restaurants/${t.restaurantId}/reports`;
    const q = `from=${today}&to=${today}`;
    const read = async <T>(name: string) =>
      (await app.inject({ method: 'GET', url: `${url}/${name}?${q}`, headers })).json<T>();
    const daily = await read<DailySalesReport>('daily-sales');
    expect(daily.totals).toMatchObject({
      orders: 1,
      grossSales: order.subtotal,
      discounts: order.discountTotal,
      tax: order.taxTotal,
      totalSales: order.total,
      netSales: order.total - order.taxTotal,
      refunds: { count: 1, amount: 100 },
    });
    const products = await read<ProductReport>('products');
    expect(products.rows).toMatchObject([{ nameEn: 'Cola', variantNameEn: 'Large', quantity: 2 }]);
    const shifts = await read<ShiftReport>('shifts');
    expect(shifts.rows).toMatchObject([
      { status: 'OPEN', cashSales: order.total, cashRefunds: 100, expectedCash: order.total - 100 },
    ]);
  });
});
