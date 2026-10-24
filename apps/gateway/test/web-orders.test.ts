import { newId } from '@pos/domain';
import { PrismaService, RealtimeBus } from '@pos/server';
import type { RealtimeEvent } from '@pos/shared-types';
import type { Order, SyncOrder, TokenResponse } from '@pos/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asHubTx } from '../src/database/hub-database';
import { FakeCloud, type TestHub, bearer, pair, removeDir, startHub } from './harness';
import { PASSWORD, buildSnapshot, withVersion } from './snapshot-fixture';

/**
 * Website orders on the hub (ADR 0013): received through the cloud's change feed, accepted or
 * rejected at the POS, handed over to the hub by its push, and the cloud's decision winning when
 * it came first (acceptance timeout).
 */
let cloud: FakeCloud;
let hub: TestHub;
let fixture: Awaited<ReturnType<typeof buildSnapshot>>;
let events: RealtimeEvent[];

beforeEach(async () => {
  fixture = await buildSnapshot();
  cloud = new FakeCloud();
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  await cloud.start();
  hub = await startHub();
  await pair(hub, cloud);
  expect(await hub.snapshots.syncNow()).toBe('applied');
  // The first contact takes the head of the feed; later entries are handled.
  await hub.engine.syncNow();
  events = [];
  hub.app.get(RealtimeBus).subscribe(fixture.ids.locationId, (e) => events.push(e));
});
afterEach(async () => {
  await hub.close();
  await cloud.stop();
  removeDir(hub.dataDir);
});

const api = '/api/v1';
const loc = () => `${api}/locations/${fixture.ids.locationId}`;
const db = () => asHubTx(hub.app.get(PrismaService));

async function signIn(email: string): Promise<Record<string, string>> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${api}/auth/login`,
    payload: { email, password: PASSWORD, client: 'native' },
  });
  return { ...bearer(res.json<TokenResponse>().accessToken), 'x-client-source': 'POS' };
}

/** A website order as the cloud stores it: placed, waiting for the tenant. */
function cloudOrder(overrides: Partial<SyncOrder> = {}, paidOnline = false): SyncOrder {
  const id = overrides.id ?? newId();
  const at = new Date().toISOString();
  const lineId = newId();
  return {
    id,
    tenantId: fixture.ids.tenantId,
    locationId: fixture.ids.locationId,
    orderNumber: 'W-001',
    businessDate: `${at.slice(0, 10)}T00:00:00.000Z`,
    channel: 'WEBSITE',
    status: 'PLACED',
    paymentStatus: paidOnline ? 'PAID' : 'UNPAID',
    source: 'WEBSITE',
    tableId: null,
    customerName: 'Sara',
    customerPhone: '+966500000001',
    guestCount: null,
    customerEmail: null,
    fulfillmentType: 'PICKUP',
    deliveryAddress: null,
    notes: null,
    currencyCode: 'SAR',
    taxInclusive: true,
    subtotal: 2500,
    discountTotal: 0,
    taxTotal: 326,
    feeTotal: 0,
    total: 2500,
    version: 1,
    createdById: null,
    placedAt: at,
    acceptBy: new Date(Date.now() + 10 * 60_000).toISOString(),
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: at,
    updatedAt: at,
    items: [
      {
        id: lineId,
        orderId: id,
        productId: fixture.ids.burger,
        variantId: null,
        nameEn: 'Burger',
        nameAr: 'برجر',
        variantNameEn: null,
        variantNameAr: null,
        sku: null,
        barcode: null,
        quantity: 1,
        basePrice: 2500,
        unitPrice: 2500,
        gross: 2500,
        discount: 0,
        tax: 326,
        total: 2500,
        notes: null,
        stationIds: [fixture.ids.grill],
        sortOrder: 0,
        createdAt: at,
        updatedAt: at,
        modifiers: [
          {
            id: newId(),
            orderItemId: lineId,
            modifierId: fixture.ids.medium,
            modifierGroupId: fixture.ids.doneness,
            nameEn: 'Medium',
            nameAr: 'متوسط',
            priceDelta: 0,
          },
        ],
      },
    ],
    taxes: [
      {
        orderId: id,
        taxId: fixture.ids.vat,
        nameEn: 'VAT',
        nameAr: 'ضريبة',
        rateBps: 1500,
        taxableAmount: 2174,
        amount: 326,
      },
    ],
    discounts: [],
    statusHistory: [
      {
        id: newId(),
        orderId: id,
        fromStatus: null,
        toStatus: 'PLACED',
        actorType: 'CUSTOMER',
        actorId: null,
        source: 'WEBSITE',
        reason: null,
        createdAt: at,
      },
    ],
    payments: paidOnline ? [onlineCharge(id, 2500)] : [],
    ...overrides,
  };
}

function onlineCharge(orderId: string, amount: number, refundOfId: string | null = null) {
  const at = new Date().toISOString();
  return {
    id: newId(),
    tenantId: fixture.ids.tenantId,
    locationId: fixture.ids.locationId,
    orderId,
    shiftId: null,
    deviceId: null,
    paymentMethodId: fixture.ids.online,
    methodType: 'ONLINE' as const,
    methodNameEn: 'Online card',
    methodNameAr: 'بطاقة',
    type: refundOfId ? ('REFUND' as const) : ('CHARGE' as const),
    status: 'CAPTURED' as const,
    provider: 'mock-online',
    providerRef: 'mock_abc',
    amount,
    tendered: null,
    change: 0,
    roundingAdjustment: 0,
    reference: null,
    refundOfId,
    reason: refundOfId ? 'VOID: TOO_BUSY' : null,
    createdById: null,
    createdAt: at,
    updatedAt: at,
    cash: [],
  };
}

async function hubOrder(id: string, headers: Record<string, string>): Promise<Order> {
  const res = await hub.app.inject({ method: 'GET', url: `${loc()}/orders/${id}`, headers });
  expect(res.statusCode).toBe(200);
  return res.json<Order>();
}

async function transition(
  id: string,
  headers: Record<string, string>,
  to: 'CONFIRMED' | 'CANCELLED',
  reason: string | null = null,
) {
  return hub.app.inject({
    method: 'POST',
    url: `${loc()}/orders/${id}/transitions`,
    headers,
    payload: { to, reason },
  });
}

describe('receiving website orders', () => {
  it('stores an order announced on the feed and tells the POS', async () => {
    const order = cloudOrder();
    cloud.publishOrder(order);
    await hub.engine.syncNow();

    const cashier = await signIn('cashier@hub.test');
    const stored = await hubOrder(order.id, cashier);
    expect(stored).toMatchObject({
      orderNumber: 'W-001',
      channel: 'WEBSITE',
      status: 'PLACED',
      fulfillmentType: 'PICKUP',
      acceptBy: order.acceptBy,
      total: 2500,
      customerName: 'Sara',
    });
    expect(stored.items[0]?.modifiers[0]?.nameEn).toBe('Medium');
    const created = events.find((e) => e.type === 'order.created');
    expect(created?.payload).toMatchObject({
      orderId: order.id,
      channel: 'WEBSITE',
      status: 'PLACED',
    });
    expect(await db().inboundOrder.findUnique({ where: { orderId: order.id } })).toMatchObject({
      cloudVersion: 1,
    });
    // Receiving is not a hub change: nothing goes back to the cloud.
    expect(await db().syncOperation.count({ where: { entityId: order.id } })).toBe(0);
    const listed = (
      await hub.app.inject({
        method: 'GET',
        url: `${loc()}/orders?status=PLACED`,
        headers: cashier,
      })
    ).json<Order[]>();
    expect(listed.map((o) => o.id)).toEqual([order.id]);
  });

  it('keeps the cursor when the cloud is away, so the order is fetched later', async () => {
    const order = cloudOrder();
    cloud.publishOrder(order);
    cloud.mode = 'error';
    await hub.engine.syncNow();
    expect(await db().order.count({ where: { id: order.id } })).toBe(0);
    cloud.mode = 'up';
    await hub.engine.syncNow();
    expect(await db().order.count({ where: { id: order.id } })).toBe(1);
  });

  it('skips orders the cloud no longer serves to this hub', async () => {
    cloud.addChange('ORDER', newId());
    const order = cloudOrder();
    cloud.publishOrder(order);
    await hub.engine.syncNow();
    expect(await db().order.count({ where: { id: order.id } })).toBe(1);
    expect(await hub.state.get('cursor')).toBe(String(cloud.changes.length));
  });

  it('refreshes its menu first when the order references a product it does not know yet', async () => {
    const productId = newId();
    fixture.tables.products.push({
      id: productId,
      tenantId: fixture.ids.tenantId,
      categoryId: fixture.ids.category,
      nameEn: 'Shawarma',
      nameAr: 'شاورما',
      price: 1800,
    });
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    const order = cloudOrder();
    const item = order.items[0];
    if (!item) throw new Error('fixture');
    order.items = [{ ...item, productId, modifiers: [] }];
    // The order's ORDER entry arrives before the configuration change is seen.
    cloud.publishOrder(order);
    await hub.engine.syncNow();
    expect(await db().order.count({ where: { id: order.id } })).toBe(1);
    expect(await db().product.count({ where: { id: productId } })).toBe(1);
  });
});

describe('accepting and rejecting at the till', () => {
  it('hands an accepted order over: the push names the cloud version, the kitchen gets it', async () => {
    const order = cloudOrder();
    cloud.publishOrder(order);
    await hub.engine.syncNow();
    const cashier = await signIn('cashier@hub.test');

    const accepted = await transition(order.id, cashier, 'CONFIRMED');
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<Order>()).toMatchObject({ status: 'CONFIRMED', version: 2 });
    expect(await db().kitchenTicket.count({ where: { orderId: order.id } })).toBe(1);

    await hub.engine.pushNow();
    const sent = cloud.pushed.find((o) => o.entityId === order.id);
    expect(sent).toMatchObject({
      entityType: 'Order',
      entityVersion: 1,
      baseVersion: 1,
      payload: { status: 'CONFIRMED', version: 2 },
    });
    // The ticket follows its order in the same push.
    expect(cloud.pushed.map((o) => o.entityType).filter((type) => type !== 'AuditLog')).toEqual([
      'Order',
      'KitchenTicket',
    ]);
  });

  it('refuses to edit a website order before accepting it, and to accept it too late', async () => {
    const order = cloudOrder();
    const late = cloudOrder({
      orderNumber: 'W-002',
      acceptBy: new Date(Date.now() - 1000).toISOString(),
    });
    cloud.publishOrder(order);
    cloud.publishOrder(late);
    await hub.engine.syncNow();
    const cashier = await signIn('cashier@hub.test');

    const current = await hubOrder(order.id, cashier);
    const edit = await hub.app.inject({
      method: 'PUT',
      url: `${loc()}/orders/${order.id}`,
      headers: cashier,
      payload: {
        version: current.version,
        channel: 'TAKEAWAY',
        items: [{ id: newId(), productId: fixture.ids.cola, quantity: 1 }],
      },
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ details: { reason: 'AWAITING_ACCEPTANCE' } });

    const tooLate = await transition(late.id, cashier, 'CONFIRMED');
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json()).toMatchObject({ details: { reason: 'ACCEPTANCE_EXPIRED' } });
  });

  it('rejects an order paid online without a refund at the till (the cloud voids it)', async () => {
    const order = cloudOrder({}, true);
    cloud.publishOrder(order);
    await hub.engine.syncNow();
    const manager = await signIn('owner@hub.test');
    const res = await transition(order.id, manager, 'CANCELLED', 'TOO_BUSY');
    expect(res.statusCode).toBe(200);
    expect(res.json<Order>()).toMatchObject({ status: 'CANCELLED', cancelReason: 'TOO_BUSY' });
    await hub.engine.pushNow();
    expect(cloud.pushed.find((o) => o.entityId === order.id)).toMatchObject({
      baseVersion: 1,
      payload: { status: 'CANCELLED' },
    });

    // The cloud voids the payment and announces it; the hub merges the void without an upload.
    const charge = order.payments[0];
    if (!charge) throw new Error('fixture');
    cloud.publishOrder({
      ...order,
      status: 'CANCELLED',
      version: 2,
      paymentStatus: 'REFUNDED',
      payments: [charge, onlineCharge(order.id, charge.amount, charge.id)],
    });
    const ops = await db().syncOperation.count();
    await hub.engine.syncNow();
    expect(await hubOrder(order.id, manager)).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      cancelReason: 'TOO_BUSY',
    });
    expect(await db().syncOperation.count()).toBe(ops);
  });
});

describe('when the cloud decided first', () => {
  it('replaces an untouched order with the cloud’s cancellation', async () => {
    const order = cloudOrder();
    cloud.publishOrder(order);
    await hub.engine.syncNow();
    cloud.publishOrder({
      ...order,
      status: 'CANCELLED',
      version: 2,
      cancelReason: 'ACCEPTANCE_TIMEOUT',
      cancelledAt: new Date().toISOString(),
    });
    await hub.engine.syncNow();
    const cashier = await signIn('cashier@hub.test');
    expect(await hubOrder(order.id, cashier)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'ACCEPTANCE_TIMEOUT',
      version: 2,
    });
    expect(events.map((e) => e.type)).toContain('order.cancelled');
  });

  it('keeps the cloud’s timeout cancellation over an acceptance made offline', async () => {
    const order = cloudOrder();
    cloud.publishOrder(order);
    await hub.engine.syncNow();
    const cashier = await signIn('cashier@hub.test');

    // The Internet drops; the location accepts; the kitchen gets a ticket.
    await cloud.stop();
    expect((await transition(order.id, cashier, 'CONFIRMED')).statusCode).toBe(200);
    expect(await db().kitchenTicket.count({ where: { orderId: order.id, status: 'NEW' } })).toBe(1);

    // Meanwhile the cloud cancelled it at the deadline. The Internet returns.
    await cloud.start();
    await pair(hub, cloud);
    hub.state.invalidate();
    // The acceptance push is refused (as the real cloud does), then the cancellation arrives.
    cloud.answer = (op) =>
      op.entityId === order.id ? { status: 'CONFLICT', code: 'SYNC_CONFLICT', message: 'x' } : null;
    await hub.engine.pushNow();
    expect(
      await db().syncOperation.count({ where: { entityId: order.id, status: 'FAILED' } }),
    ).toBe(1);
    cloud.publishOrder({
      ...order,
      status: 'CANCELLED',
      version: 2,
      cancelReason: 'ACCEPTANCE_TIMEOUT',
      cancelledAt: new Date().toISOString(),
    });
    await hub.engine.syncNow();

    expect(await hubOrder(order.id, cashier)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'ACCEPTANCE_TIMEOUT',
    });
    expect(await db().kitchenTicket.findMany({ where: { orderId: order.id } })).toEqual([
      expect.objectContaining({ status: 'CANCELLED' }),
    ]);
    // The refused acceptance is superseded, not an error waiting for a manager.
    const ops = await db().syncOperation.findMany({ where: { entityId: order.id } });
    expect(ops.map((o) => [o.status, o.errorCode])).toEqual([['COMPLETED', 'SYNC_SUPERSEDED']]);
    const hubStatus = (await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })).json<{
      failedOperations: number;
    }>();
    expect(hubStatus.failedOperations).toBe(0);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['order.cancelled', 'kitchen.ticket_cancelled']),
    );
  });
});
