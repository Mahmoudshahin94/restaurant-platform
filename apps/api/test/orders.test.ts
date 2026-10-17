import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type { ApiErrorBody, Permission } from '@pos/shared-types';
import type { Order, TableSection } from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let menu: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Record<string, string>;
let cashier: Record<string, string>;

const CASHIER_PERMISSIONS: Permission[] = [
  'orders.view',
  'orders.create',
  'orders.update',
  'locations.view',
  'products.view',
];

beforeAll(async () => {
  ({ app, prisma } = await startApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma, CASHIER_PERMISSIONS);
  menu = await createMenuFixture(prisma, tenant);
  owner = { ...bearer(await login(app, tenant.owner.email)), 'x-client-source': 'POS' };
  cashier = { ...bearer(await login(app, tenant.cashier.email)), 'x-client-source': 'POS' };
});

const ordersUrl = (location = tenant.locationA) => `/api/v1/locations/${location}/orders`;

function placeOrder(
  payload: Record<string, unknown>,
  headers = cashier,
  location = tenant.locationA,
) {
  return app.inject({ method: 'POST', url: ordersUrl(location), headers, payload });
}

async function createOrder(
  payload: Record<string, unknown> = {},
  headers = cashier,
): Promise<Order> {
  const res = await placeOrder(
    { id: newId(), channel: 'TAKEAWAY', items: [menu.burgerLine()], ...payload },
    headers,
  );
  if (res.statusCode !== 201) throw new Error(`create failed ${res.statusCode} ${res.body}`);
  return res.json<Order>();
}

describe('creating orders', () => {
  it('prices on the server, snapshots lines and records history and audit', async () => {
    const res = await placeOrder({
      id: newId(),
      channel: 'TAKEAWAY',
      items: [menu.burgerLine(2), menu.colaLine(1)],
      notes: 'No onions',
    });
    expect(res.statusCode).toBe(201);
    const order = res.json<Order>();
    // Location A is tax-inclusive: burger (25.00 + 3.00 cheese) × 2 + large cola 8.00.
    expect(order).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'UNPAID',
      source: 'POS',
      channel: 'TAKEAWAY',
      orderNumber: 'LOCA-001',
      currencyCode: 'SAR',
      taxInclusive: true,
      subtotal: 6400,
      discountTotal: 0,
      total: 6400,
      notes: 'No onions',
    });
    // 6400 × 1500 / 11500 = 834.78 → per line: 5600 → 730, 800 → 104
    expect(order.taxTotal).toBe(834);
    expect(order.taxes).toEqual([
      expect.objectContaining({
        taxId: menu.vat.id,
        rateBps: 1500,
        amount: 834,
        taxableAmount: 6400 - 834,
      }),
    ]);
    expect(order.items[0]).toMatchObject({
      nameEn: 'Burger',
      unitPrice: 2800,
      quantity: 2,
      stationIds: [menu.grill.id],
    });
    expect(order.items[0]!.modifiers.map((m) => m.nameEn).sort()).toEqual(['Cheese', 'Medium']);
    expect(order.items[1]).toMatchObject({ variantNameEn: 'Large', unitPrice: 800 });
    expect(order.statusHistory).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'PLACED', source: 'POS' }),
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'order.created', entityId: order.id } }),
    ).toBe(1);
  });

  it('ignores any prices or totals the client sends', async () => {
    const res = await placeOrder({
      id: newId(),
      channel: 'TAKEAWAY',
      total: 1,
      subtotal: 1,
      items: [{ ...menu.burgerLine(), unitPrice: 1, price: 1 }],
    });
    expect(res.json<Order>().total).toBe(2800);
  });

  it('is idempotent on the client-generated id, even under concurrent retries', async () => {
    const payload = { id: newId(), channel: 'TAKEAWAY', items: [menu.burgerLine()] };
    const first = await placeOrder(payload);
    const again = await placeOrder(payload);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json<Order>().orderNumber).toBe(first.json<Order>().orderNumber);

    const racePayload = { id: newId(), channel: 'TAKEAWAY', items: [menu.burgerLine()] };
    const results = await Promise.all([1, 2, 3].map(() => placeOrder(racePayload)));
    expect(results.every((r) => [200, 201].includes(r.statusCode))).toBe(true);
    expect(new Set(results.map((r) => r.json<Order>().id)).size).toBe(1);
    expect(await prisma.order.count()).toBe(2);
  });

  it('numbers orders per location and business day', async () => {
    const a1 = await createOrder();
    const a2 = await createOrder();
    const b1 = (
      await placeOrder(
        { id: newId(), channel: 'TAKEAWAY', items: [menu.burgerLine()] },
        owner,
        tenant.locationB,
      )
    ).json<Order>();
    expect([a1.orderNumber, a2.orderNumber, b1.orderNumber]).toEqual([
      'LOCA-001',
      'LOCA-002',
      'LOCB-001',
    ]);
  });

  it('validates every line against the location menu', async () => {
    const missingDoneness = await placeOrder({
      id: newId(),
      channel: 'TAKEAWAY',
      items: [{ ...menu.burgerLine(), modifierIds: [menu.cheese.id] }],
    });
    expect(missingDoneness.statusCode).toBe(422);
    expect(missingDoneness.json<ApiErrorBody>()).toMatchObject({
      code: 'INVALID_MODIFIER_SELECTION',
      details: { reason: 'BELOW_MIN' },
    });

    await prisma.locationProduct.create({
      data: { locationId: tenant.locationA, productId: menu.burger.id, isAvailable: false },
    });
    const soldOut = await placeOrder({
      id: newId(),
      channel: 'TAKEAWAY',
      items: [menu.burgerLine()],
    });
    expect(soldOut.json<ApiErrorBody>().code).toBe('PRODUCT_UNAVAILABLE');
    expect(await prisma.order.count()).toBe(0);
  });

  it('requires a table of this location for dine-in', async () => {
    const noTable = await placeOrder({
      id: newId(),
      channel: 'DINE_IN',
      items: [menu.burgerLine()],
    });
    expect(noTable.statusCode).toBe(400);
    const foreignTable = await placeOrder({
      id: newId(),
      channel: 'DINE_IN',
      tableId: newId(),
      items: [menu.burgerLine()],
    });
    expect(foreignTable.json<ApiErrorBody>().code).toBe('TABLE_NOT_FOUND');
    const ok = await placeOrder({
      id: newId(),
      channel: 'DINE_IN',
      tableId: menu.tables[0]!.id,
      guestCount: 2,
      items: [menu.burgerLine()],
    });
    expect(ok.json<Order>()).toMatchObject({ tableLabel: 'T1', guestCount: 2 });
  });

  it('applies discounts only for staff with orders.discount, and audits them', async () => {
    const payload = {
      id: newId(),
      channel: 'TAKEAWAY',
      items: [menu.burgerLine()],
      discountIds: [menu.tenPercent.id],
    };
    const denied = await placeOrder(payload);
    expect(denied.statusCode).toBe(403);
    expect(denied.json<ApiErrorBody>().details).toEqual({ missing: ['orders.discount'] });

    const res = await placeOrder(payload, owner);
    const order = res.json<Order>();
    expect(order).toMatchObject({ subtotal: 2800, discountTotal: 280, total: 2520 });
    expect(order.discounts).toEqual([
      expect.objectContaining({ discountId: menu.tenPercent.id, amount: 280 }),
    ]);
    expect(
      await prisma.auditLog.count({
        where: { action: 'order.discount_applied', entityId: order.id },
      }),
    ).toBe(1);
  });

  it('keeps order snapshots when the menu changes later', async () => {
    const order = await createOrder();
    await prisma.product.update({
      where: { id: menu.burger.id },
      data: { nameEn: 'Renamed', price: 9900 },
    });
    const reloaded = await app.inject({
      method: 'GET',
      url: `${ordersUrl()}/${order.id}`,
      headers: cashier,
    });
    expect(reloaded.json<Order>().items[0]).toMatchObject({ nameEn: 'Burger', unitPrice: 2800 });
  });

  it('hides orders of other tenants and locations', async () => {
    const order = await createOrder();
    const other = await createTenant(prisma);
    const otherOwner = bearer(await login(app, other.owner.email));
    const res = await app.inject({
      method: 'GET',
      url: `${ordersUrl(other.locationA)}/${order.id}`,
      headers: otherOwner,
    });
    expect(res.statusCode).toBe(404);
    const wrongLocation = await app.inject({
      method: 'GET',
      url: `${ordersUrl(tenant.locationB)}/${order.id}`,
      headers: owner,
    });
    expect(wrongLocation.json<ApiErrorBody>().code).toBe('ORDER_NOT_FOUND');
  });
});

describe('modifying orders', () => {
  const put = (order: Order, payload: Record<string, unknown>, headers = cashier) =>
    app.inject({ method: 'PUT', url: `${ordersUrl()}/${order.id}`, headers, payload });

  it('replaces lines, re-prices and bumps the version', async () => {
    const order = await createOrder();
    const keep = {
      ...order.items[0]!,
      modifierIds: order.items[0]!.modifiers.map((m) => m.modifierId),
      quantity: 3,
    };
    const res = await put(order, {
      version: order.version,
      channel: 'TAKEAWAY',
      items: [
        { id: keep.id, productId: keep.productId, modifierIds: keep.modifierIds, quantity: 3 },
        menu.colaLine(2, 'small'),
      ],
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Order>();
    expect(updated.version).toBe(order.version + 1);
    expect(updated.items.map((i) => i.quantity)).toEqual([3, 2]);
    expect(updated.items[0]!.id).toBe(keep.id);
    expect(updated.total).toBe(2800 * 3 + 600 * 2);
    expect(
      await prisma.auditLog.count({ where: { action: 'order.modified', entityId: order.id } }),
    ).toBe(1);
  });

  it('rejects stale versions (optimistic concurrency)', async () => {
    const order = await createOrder();
    const body = { version: order.version, channel: 'TAKEAWAY', items: [menu.burgerLine()] };
    expect((await put(order, body)).statusCode).toBe(200);
    const stale = await put(order, body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorBody>().details).toEqual({
      reason: 'STALE_VERSION',
      currentVersion: order.version + 1,
    });
  });

  it('refuses changes once an order is cancelled', async () => {
    const order = await createOrder();
    await app.inject({
      method: 'POST',
      url: `${ordersUrl()}/${order.id}/transitions`,
      headers: owner,
      payload: { to: 'CANCELLED', reason: 'Customer left' },
    });
    const res = await put(order, {
      version: order.version + 1,
      channel: 'TAKEAWAY',
      items: [menu.burgerLine()],
    });
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'INVALID_ORDER_STATE',
      details: { reason: 'NOT_MODIFIABLE' },
    });
  });
});

describe('status transitions', () => {
  const transition = (order: Order, payload: Record<string, unknown>, headers = cashier) =>
    app.inject({ method: 'POST', url: `${ordersUrl()}/${order.id}/transitions`, headers, payload });

  it('confirms an order and records history', async () => {
    const order = await createOrder();
    const res = await transition(order, { to: 'CONFIRMED', version: order.version });
    expect(res.statusCode).toBe(200);
    const confirmed = res.json<Order>();
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.statusHistory.map((h) => `${h.fromStatus}->${h.toStatus}`)).toEqual([
      'null->PLACED',
      'PLACED->CONFIRMED',
    ]);
  });

  it('enforces the state machine', async () => {
    const order = await createOrder();
    const skip = await transition(order, { to: 'READY' });
    expect(skip.json<ApiErrorBody>()).toMatchObject({
      code: 'INVALID_ORDER_STATE',
      details: { reason: 'NOT_ALLOWED' },
    });
    await transition(order, { to: 'CONFIRMED' });
    const kitchenOnly = await transition(order, { to: 'PREPARING' });
    expect(kitchenOnly.json<ApiErrorBody>().details).toMatchObject({ reason: 'SYSTEM_ONLY' });
    const unpaid = await transition(order, { to: 'COMPLETED' });
    expect(unpaid.json<ApiErrorBody>().details).toMatchObject({ reason: 'UNPAID' });
  });

  it('cancels with a mandatory reason and the cancel permission', async () => {
    const order = await createOrder();
    const noPermission = await transition(order, { to: 'CANCELLED', reason: 'x' });
    expect(noPermission.statusCode).toBe(403);
    const noReason = await transition(order, { to: 'CANCELLED' }, owner);
    expect(noReason.json<ApiErrorBody>().details).toMatchObject({ reason: 'REASON_REQUIRED' });
    const res = await transition(order, { to: 'CANCELLED', reason: 'Wrong order' }, owner);
    expect(res.json<Order>()).toMatchObject({ status: 'CANCELLED', cancelReason: 'Wrong order' });
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'order.cancelled', entityId: order.id } }),
    ).toMatchObject({
      metadata: { from: 'PLACED', to: 'CANCELLED', reason: 'Wrong order' },
    });
  });

  it('rejects a transition based on a stale version', async () => {
    const order = await createOrder();
    await transition(order, { to: 'CONFIRMED' });
    const stale = await transition(
      order,
      { to: 'CANCELLED', reason: 'x', version: order.version },
      owner,
    );
    expect(stale.json<ApiErrorBody>().details).toMatchObject({ reason: 'STALE_VERSION' });
  });
});

describe('floor plan and lists', () => {
  it('shows open orders on their table until they are closed', async () => {
    const table = menu.tables[0]!;
    const order = await createOrder({ channel: 'DINE_IN', tableId: table.id });
    const floorUrl = `/api/v1/locations/${tenant.locationA}/floor`;
    const busy = (await app.inject({ method: 'GET', url: floorUrl, headers: cashier })).json<
      TableSection[]
    >();
    expect(busy[0]!.tables.find((t) => t.id === table.id)!.openOrders.map((o) => o.id)).toEqual([
      order.id,
    ]);

    await app.inject({
      method: 'POST',
      url: `${ordersUrl()}/${order.id}/transitions`,
      headers: owner,
      payload: { to: 'CANCELLED', reason: 'Test' },
    });
    const free = (await app.inject({ method: 'GET', url: floorUrl, headers: cashier })).json<
      TableSection[]
    >();
    expect(free[0]!.tables.find((t) => t.id === table.id)!.openOrders).toEqual([]);
  });

  it('lists open orders newest first', async () => {
    const first = await createOrder();
    const second = await createOrder();
    await app.inject({
      method: 'POST',
      url: `${ordersUrl()}/${first.id}/transitions`,
      headers: owner,
      payload: { to: 'CANCELLED', reason: 'Test' },
    });
    const open = await app.inject({
      method: 'GET',
      url: `${ordersUrl()}?open=true`,
      headers: cashier,
    });
    expect(open.json<Order[]>().map((o) => o.id)).toEqual([second.id]);
    const cancelled = await app.inject({
      method: 'GET',
      url: `${ordersUrl()}?status=CANCELLED`,
      headers: cashier,
    });
    expect(cancelled.json<Order[]>().map((o) => o.id)).toEqual([first.id]);
  });

  it('lets only tables.manage edit the floor plan', async () => {
    const url = `/api/v1/locations/${tenant.locationA}/floor/tables`;
    const payload = { sectionId: menu.tables[0]!.sectionId, label: 'T9', seats: 2 };
    expect((await app.inject({ method: 'POST', url, headers: cashier, payload })).statusCode).toBe(
      403,
    );
    const res = await app.inject({ method: 'POST', url, headers: owner, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json<TableSection[]>()[0]!.tables.map((t) => t.label)).toContain('T9');
    expect((await app.inject({ method: 'POST', url, headers: owner, payload })).statusCode).toBe(
      409,
    );
  });
});

describe('pricing configuration', () => {
  it('manages taxes with settings.manage and exposes them in the menu', async () => {
    const r = `/api/v1/restaurants/${tenant.restaurantId}`;
    const denied = await app.inject({
      method: 'POST',
      url: `${r}/taxes`,
      headers: cashier,
      payload: { nameEn: 'x', nameAr: 'x', rateBps: 500 },
    });
    expect(denied.statusCode).toBe(403);
    const rate = await app.inject({
      method: 'PATCH',
      url: `${r}/taxes/${menu.vat.id}`,
      headers: owner,
      payload: { rateBps: 500 },
    });
    expect(rate.statusCode).toBe(200);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'tax.rate_changed' } }),
    ).toMatchObject({
      metadata: { changes: { rateBps: 500 }, before: { rateBps: 1500 } },
    });
    const published = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/menu`,
      headers: cashier,
    });
    const body = published.json<{
      taxes: { id: string; rateBps: number }[];
      categories: { products: { taxIds: string[] }[] }[];
    }>();
    expect(body.taxes).toEqual([expect.objectContaining({ id: menu.vat.id, rateBps: 500 })]);
    expect(body.categories[0]!.products[0]!.taxIds).toEqual([menu.vat.id]);
  });

  it('lists discounts to every member but restricts changes', async () => {
    const url = `/api/v1/restaurants/${tenant.restaurantId}/discounts`;
    expect((await app.inject({ method: 'GET', url, headers: cashier })).statusCode).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url,
      headers: owner,
      payload: { nameEn: 'x', nameAr: 'x', type: 'PERCENTAGE', value: 20_000 },
    });
    expect(bad.statusCode).toBe(400);
  });
});
