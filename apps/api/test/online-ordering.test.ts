import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId, quoteOrder } from '@pos/domain';
import { WebOrdersService } from '@pos/server';
import type {
  CreateWebOrderRequest,
  OnlineOrderingOverview,
  PairedDevice,
  PublicLocation,
  PublicOrder,
  PublicRestaurant,
  PublishedMenu,
  SyncOperationResult,
  SyncOrder,
  SyncPullResponse,
  SyncPushResponse,
  WebOrderCreated,
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
import { createMenuFixture } from './menu-fixture';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let menu: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Record<string, string>;
let hub: Record<string, string>;
let deviceId: string;
let slug: string;

beforeAll(async () => {
  ({ app, prisma } = await startApp({
    ONLINE_PAYMENT_PROVIDER: 'mock',
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
  tenant = await createTenant(prisma);
  menu = await createMenuFixture(prisma, tenant);
  slug = (await prisma.restaurant.findUniqueOrThrow({ where: { id: tenant.restaurantId } })).slug;
  await prisma.paymentMethod.create({
    data: {
      restaurantId: tenant.restaurantId,
      type: 'ONLINE',
      nameEn: 'Online card',
      nameAr: 'بطاقة عبر الإنترنت',
    },
  });
  owner = bearer(await login(app, tenant.owner.email));
  const paired = await app.inject({
    method: 'POST',
    url: `/api/v1/locations/${tenant.locationA}/devices`,
    headers: owner,
    payload: { name: 'Main hub', type: 'GATEWAY' },
  });
  const device = paired.json<PairedDevice>();
  deviceId = device.device.id;
  hub = { authorization: `Device ${device.credential}` };
  await heartbeat();
  await settings({
    state: 'OPEN',
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryFee: 900,
    acceptMinutes: 10,
  });
});

// --- Helpers -------------------------------------------------------------------------------------

/** The hub talked to the cloud just now (its heartbeat), or `ago` milliseconds ago. */
async function heartbeat(ago = 0): Promise<void> {
  await prisma.device.update({
    where: { id: deviceId },
    data: { status: 'ACTIVE', lastSeenAt: new Date(Date.now() - ago) },
  });
}

async function settings(payload: Record<string, unknown>): Promise<OnlineOrderingOverview> {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/v1/locations/${tenant.locationA}/online-ordering`,
    headers: owner,
    payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json<OnlineOrderingOverview>();
}

function webOrder(overrides: Partial<CreateWebOrderRequest> = {}): CreateWebOrderRequest {
  return {
    id: newId(),
    locationId: tenant.locationA,
    fulfillment: 'PICKUP',
    customer: { name: 'Sara', phone: '+966500000001', email: 'sara@example.com' },
    items: [menu.burgerLine(2), menu.colaLine(1)],
    notes: 'No onions',
    payment: { option: 'PAY_AT_PICKUP' },
    ...overrides,
  };
}

async function placeRaw(payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: { 'x-client-source': 'WEBSITE' },
    payload: payload as Record<string, unknown>,
  });
}

async function place(overrides: Partial<CreateWebOrderRequest> = {}): Promise<WebOrderCreated> {
  const res = await placeRaw(webOrder(overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<WebOrderCreated>();
}

async function track(token: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/orders/track',
    headers: { 'x-tracking-token': token },
  });
}

async function pull(cursor: string): Promise<SyncPullResponse> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/sync/pull?${cursor ? `cursor=${cursor}` : ''}`,
    headers: hub,
  });
  expect(res.statusCode).toBe(200);
  return res.json<SyncPullResponse>();
}

async function cloudAggregate(orderId: string, headers = hub): Promise<SyncOrder> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/sync/orders/${orderId}`, headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<SyncOrder>();
}

/** What the hub's outbox sends after the restaurant decided on a website order. */
function decided(order: SyncOrder, to: 'CONFIRMED' | 'CANCELLED', reason: string | null = null) {
  const at = new Date().toISOString();
  return {
    ...order,
    status: to,
    version: order.version + 1,
    updatedAt: at,
    ...(to === 'CANCELLED' ? { cancelledAt: at, cancelReason: reason } : {}),
    statusHistory: [
      ...order.statusHistory,
      {
        id: newId(),
        orderId: order.id,
        fromStatus: 'PLACED' as const,
        toStatus: to,
        actorType: 'USER' as const,
        actorId: tenant.cashier.id,
        source: 'POS' as const,
        reason,
        createdAt: at,
      },
    ],
  } satisfies SyncOrder;
}

function orderOp(payload: SyncOrder, entityVersion: number, baseVersion?: number) {
  return {
    operationId: newId(),
    entityType: 'Order',
    entityId: payload.id,
    operationType: 'ORDER_UPSERT',
    entityVersion,
    ...(baseVersion === undefined ? {} : { baseVersion }),
    payload,
  };
}

async function push(operations: unknown[]): Promise<SyncOperationResult[]> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: hub,
    payload: { operations },
  });
  expect(res.statusCode).toBe(200);
  return res.json<SyncPushResponse>().results;
}

const sweeper = () => app.get(WebOrdersService);
const minutes = (n: number) => n * 60_000;

// --- Storefront ----------------------------------------------------------------------------------

describe('public storefront', () => {
  it('lists the restaurant’s active locations with what customers can do there', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/public/restaurants/${slug}` });
    expect(res.statusCode).toBe(200);
    const restaurant = res.json<PublicRestaurant>();
    expect(restaurant).toMatchObject({ slug, currencyCode: 'SAR' });
    const a = restaurant.locations.find((l) => l.id === tenant.locationA);
    expect(a).toMatchObject({
      status: { state: 'OPEN', reason: null },
      pickupEnabled: true,
      deliveryEnabled: true,
      deliveryFee: 900,
      onlineCardEnabled: true,
    });
    // Location B has no hub: it cannot receive orders.
    expect(restaurant.locations.find((l) => l.id === tenant.locationB)?.status).toEqual({
      state: 'CLOSED',
      reason: 'SETTING_CLOSED',
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/public/restaurants/nope' })).statusCode,
    ).toBe(404);
  });

  it('serves the published menu with an ETag, without signing in', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/locations/${tenant.locationA}/menu`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<PublishedMenu>();
    expect(body.categories[0]?.products.map((p) => p.nameEn)).toEqual(
      expect.arrayContaining(['Burger', 'Cola']),
    );
    const again = await app.inject({
      method: 'GET',
      url: `/api/v1/public/locations/${tenant.locationA}/menu`,
      headers: { 'if-none-match': res.headers.etag as string },
    });
    expect(again.statusCode).toBe(304);
  });

  it('lets only online-ordering managers change the settings', async () => {
    const cashier = bearer(await login(app, tenant.cashier.email));
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/locations/${tenant.locationA}/online-ordering`,
      headers: cashier,
      payload: { state: 'PAUSED' },
    });
    expect(res.statusCode).toBe(403);
    const updated = await settings({
      openingHours: [{ day: 0, open: '18:00', close: '02:00' }],
    });
    expect(updated.openingHours).toEqual([{ day: 0, open: '18:00', close: '02:00' }]);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/v1/locations/${tenant.locationA}/online-ordering`,
          headers: owner,
          payload: { state: 'OFFLINE' },
        })
      ).statusCode,
    ).toBe(400);
  });
});

// --- Online ordering states ----------------------------------------------------------------------

describe('online-ordering state', () => {
  it('refuses orders when the restaurant closed or paused online ordering', async () => {
    await settings({ state: 'CLOSED' });
    const closed = await placeRaw(webOrder());
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({
      code: 'ONLINE_ORDERING_DISABLED',
      details: { state: 'CLOSED', reason: 'SETTING_CLOSED' },
    });
    await settings({ state: 'PAUSED' });
    expect((await placeRaw(webOrder())).json()).toMatchObject({
      code: 'ONLINE_ORDERING_DISABLED',
      details: { state: 'PAUSED' },
    });
    expect(await prisma.order.count()).toBe(0);
  });

  it('refuses orders outside the opening hours', async () => {
    // A one-minute window a few hours from now, in the location timezone (Asia/Riyadh).
    const later = new Date(Date.now() + 6 * 60 * 60_000);
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(later);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      local.find((p) => p.type === 'weekday')?.value ?? '',
    );
    const hh = local.find((p) => p.type === 'hour')?.value ?? '00';
    await settings({ openingHours: [{ day, open: `${hh}:00`, close: `${hh}:01` }] });
    expect((await placeRaw(webOrder())).json()).toMatchObject({
      code: 'ONLINE_ORDERING_DISABLED',
      details: { state: 'CLOSED', reason: 'OUTSIDE_HOURS' },
    });
  });

  it('answers RESTAURANT_OFFLINE when the hub heartbeat is stale', async () => {
    await heartbeat(minutes(4));
    const res = await placeRaw(webOrder());
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'RESTAURANT_OFFLINE' });
    const location = (
      await app.inject({ method: 'GET', url: `/api/v1/public/locations/${tenant.locationA}` })
    ).json<PublicLocation>();
    expect(location.status).toEqual({ state: 'OFFLINE', reason: 'HUB_OFFLINE' });

    // The hub comes back (any authenticated sync call refreshes the heartbeat).
    await heartbeat();
    expect((await placeRaw(webOrder())).statusCode).toBe(201);
  });

  it('refuses a disabled fulfillment and a payment option that does not fit', async () => {
    await settings({ deliveryEnabled: false });
    const delivery = await placeRaw(
      webOrder({
        fulfillment: 'DELIVERY',
        deliveryAddress: { line1: 'King Fahd Rd 10' },
        payment: { option: 'CASH_ON_DELIVERY' },
      }),
    );
    expect(delivery.json()).toMatchObject({
      code: 'ONLINE_ORDERING_DISABLED',
      details: { reason: 'FULFILLMENT_UNAVAILABLE' },
    });
    const mismatch = await placeRaw(webOrder({ payment: { option: 'CASH_ON_DELIVERY' } }));
    expect(mismatch.statusCode).toBe(400);
  });
});

// --- Creating orders -----------------------------------------------------------------------------

describe('POST /orders', () => {
  it('re-prices everything on the server and ignores browser totals', async () => {
    const request = webOrder({
      fulfillment: 'DELIVERY',
      deliveryAddress: { line1: 'King Fahd Rd 10', city: 'Riyadh' },
      payment: { option: 'CASH_ON_DELIVERY' },
    });
    // A tampered browser: invented prices and totals everywhere.
    const tampered = {
      ...request,
      total: 1,
      subtotal: 1,
      deliveryFee: 0,
      items: request.items.map((i) => ({ ...i, unitPrice: 1, total: 1, price: 1 })),
    };
    const res = await placeRaw(tampered);
    expect(res.statusCode).toBe(201);
    const { order } = res.json<WebOrderCreated>();

    const published = (
      await app.inject({ method: 'GET', url: `/api/v1/public/locations/${tenant.locationA}/menu` })
    ).json<PublishedMenu>();
    const expected = quoteOrder({
      menu: { taxes: published.taxes, categories: published.categories },
      taxInclusive: published.taxInclusive,
      items: request.items.map((i) => ({
        lineId: i.id,
        productId: i.productId,
        variantId: i.variantId ?? null,
        modifierIds: i.modifierIds ?? [],
        quantity: i.quantity,
      })),
      fees: [{ feeId: 'delivery', amount: 900, taxes: [] }],
    }).pricing;
    expect(order).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'UNPAID',
      paymentOption: 'CASH_ON_DELIVERY',
      fulfillmentType: 'DELIVERY',
      subtotal: expected.subtotal,
      taxTotal: expected.tax,
      feeTotal: 900,
      total: expected.total,
      deliveryAddress: { line1: 'King Fahd Rd 10', city: 'Riyadh', line2: null, notes: null },
    });
    expect(order.total).toBe(2 * (2500 + 300) + 800 + 900);
    expect(order.orderNumber).toBe('W-001');

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({
      channel: 'WEBSITE',
      source: 'WEBSITE',
      status: 'PLACED',
      customerEmail: 'sara@example.com',
      createdById: null,
    });
    // The restaurant has the configured time to accept it.
    expect(row.acceptBy!.getTime() - row.placedAt!.getTime()).toBe(minutes(10));
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toEqual([
      expect.objectContaining({ toStatus: 'PLACED', actorType: 'CUSTOMER', source: 'WEBSITE' }),
    ]);
    expect((await place()).order.orderNumber).toBe('W-002');
  });

  it('validates products, availability and modifiers with the domain rules', async () => {
    const noDoneness = await placeRaw(
      webOrder({ items: [{ id: newId(), productId: menu.burger.id, quantity: 1 }] }),
    );
    expect(noDoneness.statusCode).toBe(422);
    expect(noDoneness.json()).toMatchObject({
      code: 'INVALID_MODIFIER_SELECTION',
      details: { reason: 'BELOW_MIN' },
    });
    await prisma.locationProduct.create({
      data: { locationId: tenant.locationA, productId: menu.burger.id, isAvailable: false },
    });
    expect((await placeRaw(webOrder())).json()).toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    expect(await prisma.order.count()).toBe(0);
  });

  it('is idempotent: a resend returns the same order and token, never a duplicate', async () => {
    const request = webOrder();
    const first = await placeRaw(request);
    const [second, third] = await Promise.all([placeRaw(request), placeRaw(request)]);
    expect(first.statusCode).toBe(201);
    expect([second.statusCode, third.statusCode]).toEqual([200, 200]);
    expect(second.json<WebOrderCreated>()).toEqual(first.json<WebOrderCreated>());
    expect(await prisma.order.count()).toBe(1);

    // Someone else cannot reuse the id to read the order.
    const other = await placeRaw({ ...request, customer: { name: 'X', phone: '+966511111111' } });
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ code: 'CONFLICT', details: { reason: 'ID_IN_USE' } });
  });

  it('takes an online card payment through the mock provider, with no drawer', async () => {
    const { order } = await place({
      payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' },
    });
    expect(order).toMatchObject({ paymentStatus: 'PAID', paymentOption: 'ONLINE_CARD' });
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toEqual([
      expect.objectContaining({
        type: 'CHARGE',
        status: 'CAPTURED',
        methodType: 'ONLINE',
        provider: 'mock-online',
        shiftId: null,
        amount: order.total,
        reference: null,
      }),
    ]);
    expect(payments[0]?.providerRef).toMatch(/^mock_/);
  });

  it('creates nothing when the card is declined', async () => {
    const res = await placeRaw(
      webOrder({ payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_decline' } }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'PAYMENT_FAILED',
      details: { reason: 'CARD_DECLINED' },
    });
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('offers no online card without a configured gateway', async () => {
    const plain = await startApp({
      ONLINE_PAYMENT_PROVIDER: 'none',
      WEB_ORDER_TIMEOUT_SWEEP_SECONDS: '0',
    });
    try {
      const res = await plain.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        payload: webOrder({ payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' } }),
      });
      expect(res.json()).toMatchObject({
        code: 'PAYMENT_FAILED',
        details: { reason: 'PROVIDER_NOT_CONFIGURED' },
      });
      const location = (
        await plain.app.inject({
          method: 'GET',
          url: `/api/v1/public/locations/${tenant.locationA}`,
        })
      ).json<PublicLocation>();
      expect(location.onlineCardEnabled).toBe(false);
    } finally {
      await plain.app.close();
      await plain.prisma.$disconnect();
    }
  });
});

// --- Tracking ------------------------------------------------------------------------------------

describe('GET /orders/track', () => {
  it('shows the order to the holder of its token, and nothing to anyone else', async () => {
    const { order, trackingToken } = await place();
    const res = await track(trackingToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const tracked = res.json<PublicOrder>();
    expect(tracked).toMatchObject({
      id: order.id,
      orderNumber: 'W-001',
      status: 'PLACED',
      timeline: [expect.objectContaining({ status: 'PLACED' })],
    });
    // No staff or internal fields.
    expect(tracked).not.toHaveProperty('createdById');
    expect(tracked).not.toHaveProperty('customerPhone');

    const forged = `${order.id}.${'A'.repeat(32)}`;
    for (const token of [forged, `${trackingToken}x`, 'garbage']) {
      expect((await track(token)).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/orders/track' })).statusCode).toBe(404);
  });

  it('is rate limited per client', async () => {
    const limited = await startApp({ TRACKING_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        codes.push(
          (
            await limited.app.inject({
              method: 'GET',
              url: '/api/v1/orders/track',
              headers: { 'x-tracking-token': 'garbage' },
            })
          ).statusCode,
        );
      }
      expect(codes).toEqual([404, 404, 404, 429, 429]);
      // Other endpoints keep their own budget.
      expect(
        (await limited.app.inject({ method: 'GET', url: `/api/v1/public/restaurants/${slug}` }))
          .statusCode,
      ).toBe(200);
    } finally {
      await limited.app.close();
      await limited.prisma.$disconnect();
    }
  });
});

// --- Change feed: ORDER topic --------------------------------------------------------------------

describe('ORDER entries on the change feed', () => {
  it('announces a new website order to its location’s hub, in the creating transaction', async () => {
    const { cursor } = await pull('');
    const { order } = await place();
    const page = await pull(cursor);
    expect(page.changes).toEqual([expect.objectContaining({ topic: 'ORDER', entityId: order.id })]);
    const entry = await prisma.changeLog.findFirstOrThrow({ where: { topic: 'ORDER' } });
    expect(entry.locationId).toBe(tenant.locationA);

    // The hub fetches it in its outbox shape.
    const aggregate = await cloudAggregate(order.id);
    expect(aggregate).toMatchObject({
      id: order.id,
      channel: 'WEBSITE',
      status: 'PLACED',
      fulfillmentType: 'PICKUP',
    });
    expect(aggregate.acceptBy).not.toBeNull();
    expect(aggregate.items).toHaveLength(2);
  });

  it('does not show one location’s orders to another location’s hub', async () => {
    const { order } = await place();
    const other = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/locations/${tenant.locationB}/devices`,
        headers: owner,
        payload: { name: 'Hub B', type: 'GATEWAY' },
      })
    ).json<PairedDevice>();
    const headers = { authorization: `Device ${other.credential}` };
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/sync/orders/${order.id}`,
      headers,
    });
    expect(res.statusCode).toBe(404);
    const feed = await app.inject({ method: 'GET', url: '/api/v1/sync/pull?cursor=0', headers });
    expect(feed.json<SyncPullResponse>().changes.filter((c) => c.topic === 'ORDER')).toEqual([]);
  });

  it('does not announce orders the hubs created, nor echo their pushes', async () => {
    const { cursor } = await pull('');
    const staff = bearer(await login(app, tenant.owner.email));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: staff,
      payload: {
        id: newId(),
        channel: 'TAKEAWAY',
        status: 'CONFIRMED',
        items: [menu.colaLine()],
      },
    });
    expect(res.statusCode).toBe(201);
    const { order } = await place();
    const accepted = decided(await cloudAggregate(order.id), 'CONFIRMED');
    await push([orderOp(accepted, 1, accepted.version - 1)]);
    const page = await pull(cursor);
    expect(page.changes.map((c) => c.entityId)).toEqual([order.id]);
  });
});

// --- Ownership hand-over -------------------------------------------------------------------------

describe('ownership hand-over', () => {
  it('hands a website order to the hub when the restaurant accepts it', async () => {
    const { order, trackingToken } = await place();
    const cloud = await cloudAggregate(order.id);
    const accepted = decided(cloud, 'CONFIRMED');
    expect(statusesOf(await push([orderOp(accepted, 1, cloud.version)]))).toEqual(['APPLIED']);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ status: 'CONFIRMED', version: cloud.version + 1 });
    const ledger = await prisma.processedOperation.findFirstOrThrow({
      where: { entityId: order.id },
    });
    expect(ledger).toMatchObject({ status: 'APPLIED', rowVersion: cloud.version + 1 });
    // The customer sees the restaurant's decision.
    expect((await track(trackingToken)).json<PublicOrder>()).toMatchObject({
      status: 'CONFIRMED',
      timeline: [
        expect.objectContaining({ status: 'PLACED' }),
        expect.objectContaining({ status: 'CONFIRMED' }),
      ],
    });

    // From now on the hub owns it: later changes follow the normal rules.
    const preparing = {
      ...accepted,
      status: 'PREPARING' as const,
      version: accepted.version + 1,
    };
    expect(statusesOf(await push([orderOp(preparing, 2, cloud.version)]))).toEqual(['APPLIED']);
    expect((await track(trackingToken)).json<PublicOrder>().status).toBe('PREPARING');
    // …and the timeout no longer applies.
    expect(await sweeper().cancelExpired(new Date(Date.now() + minutes(60)))).toBe(0);
  });

  it('refuses hub changes that cross the cloud’s ownership', async () => {
    const { order } = await place();
    const cloud = await cloudAggregate(order.id);
    const accepted = decided(cloud, 'CONFIRMED');

    // Without the version it was based on, or based on another version.
    const noBase = await push([orderOp(accepted, 1)]);
    const stale = await push([orderOp(accepted, 1, cloud.version + 5)]);
    // An edit before the restaurant decided (still PLACED).
    const edited = await push([
      orderOp({ ...cloud, notes: 'Changed', version: 2 }, 1, cloud.version),
    ]);
    for (const results of [noBase, stale, edited]) {
      expect(results).toEqual([
        expect.objectContaining({ status: 'CONFLICT', code: 'SYNC_CONFLICT' }),
      ]);
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PLACED',
    );
    // A hub cannot invent a website order either.
    const invented = { ...accepted, id: newId(), items: [], taxes: [], statusHistory: [] };
    expect(await push([orderOp(invented, 1)])).toEqual([
      expect.objectContaining({ status: 'REJECTED' }),
    ]);
  });

  it('cancels and voids a rejected order, and tells the hub', async () => {
    const { order, trackingToken } = await place({
      payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' },
    });
    const cloud = await cloudAggregate(order.id);
    const { cursor } = await pull('');
    const rejected = decided(cloud, 'CANCELLED', 'TOO_BUSY');
    expect(statusesOf(await push([orderOp(rejected, 1, cloud.version)]))).toEqual(['APPLIED']);

    const payments = await prisma.payment.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments.map((p) => [p.type, p.status, p.refundOfId])).toEqual([
      ['CHARGE', 'CAPTURED', null],
      ['REFUND', 'CAPTURED', payments[0]?.id],
    ]);
    expect(payments[1]?.reason).toBe('VOID: TOO_BUSY');
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      version: rejected.version,
    });
    // The void is announced so the hub merges it.
    expect((await pull(cursor)).changes).toEqual([
      expect.objectContaining({ topic: 'ORDER', entityId: order.id }),
    ]);
    expect((await track(trackingToken)).json<PublicOrder>()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'TOO_BUSY',
      paymentStatus: 'REFUNDED',
    });
  });
});

// --- Acceptance timeout --------------------------------------------------------------------------

describe('acceptance timeout', () => {
  it('cancels unaccepted orders after the deadline (with a grace period) and voids the payment', async () => {
    const { order, trackingToken } = await place({
      payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' },
    });
    const pending = await place();
    const { cursor } = await pull('');
    const acceptBy = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).acceptBy!;

    // At the deadline, and within the grace period, nothing happens.
    expect(await sweeper().cancelExpired(new Date(acceptBy.getTime() + 10_000))).toBe(0);
    expect(await sweeper().cancelExpired(new Date(acceptBy.getTime() + 31_000))).toBe(2);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true, statusHistory: true },
    });
    expect(row).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'ACCEPTANCE_TIMEOUT',
      paymentStatus: 'REFUNDED',
    });
    expect(row.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'PLACED',
      toStatus: 'CANCELLED',
      actorType: 'SYSTEM',
      source: 'SYSTEM',
    });
    expect(row.payments.map((p) => p.type).sort()).toEqual(['CHARGE', 'REFUND']);
    expect((await pull(cursor)).changes.map((c) => c.entityId).sort()).toEqual(
      [order.id, pending.order.id].sort(),
    );
    expect((await track(trackingToken)).json<PublicOrder>()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'ACCEPTANCE_TIMEOUT',
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'order.cancelled', entityId: order.id },
    });
    expect(audit).toMatchObject({ actorType: 'SYSTEM' });

    // An acceptance arriving after the cloud cancelled is a conflict, not an overwrite.
    const cloud = await cloudAggregate(pending.order.id);
    const late = decided({ ...cloud, status: 'PLACED', version: 1 }, 'CONFIRMED');
    expect(await push([orderOp(late, 1, 1)])).toEqual([
      expect.objectContaining({ status: 'CONFLICT', code: 'SYNC_CONFLICT' }),
    ]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pending.order.id } })).status).toBe(
      'CANCELLED',
    );
  });
});

// --- Staff in the cloud --------------------------------------------------------------------------

describe('website orders handled by staff in the cloud', () => {
  it('cannot be edited before acceptance; acceptance is announced on the feed', async () => {
    const { order } = await place();
    const staff = owner;
    const current = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/locations/${tenant.locationA}/orders/${order.id}`,
        headers: staff,
      })
    ).json<{ version: number; fulfillmentType: string; acceptBy: string }>();
    expect(current.fulfillmentType).toBe('PICKUP');
    expect(typeof current.acceptBy).toBe('string');
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/locations/${tenant.locationA}/orders/${order.id}`,
      headers: staff,
      payload: { version: current.version, channel: 'TAKEAWAY', items: [menu.colaLine()] },
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ details: { reason: 'AWAITING_ACCEPTANCE' } });

    const { cursor } = await pull('');
    const accept = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/orders/${order.id}/transitions`,
      headers: staff,
      payload: { to: 'CONFIRMED' },
    });
    expect(accept.statusCode).toBe(200);
    expect((await pull(cursor)).changes).toEqual([
      expect.objectContaining({ topic: 'ORDER', entityId: order.id }),
    ]);
  });
});

function statusesOf(results: SyncOperationResult[]) {
  return results.map((r) => r.status);
}
