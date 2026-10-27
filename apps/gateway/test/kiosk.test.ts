import { newId } from '@pos/domain';
import { MockPaymentTerminal, PrismaService } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import type {
  KioskAttendant,
  KioskContext,
  KioskPaymentOutcome,
  KitchenTicket,
  Order,
  PairedTerminal,
  PublishedMenu,
  Shift,
  TokenResponse,
} from '@pos/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asHubTx } from '../src/database/hub-database';
import { FakeCloud, type TestHub, bearer, pair, removeDir, startHub } from './harness';
import {
  CASHIER_PIN,
  KIOSK_CODE,
  PASSWORD,
  buildSnapshot,
  moduleOverride,
  pendingTerminal,
  withVersion,
} from './snapshot-fixture';

/**
 * The self-service kiosk at its location hub (ADR 0022): pairing with the admin's code, the
 * kiosk's narrow routes, and its orders going through the same order, payment and kitchen code as
 * the POS's, with the cloud reachable or not.
 */
let cloud: FakeCloud;
let hub: TestHub;
let fixture: Awaited<ReturnType<typeof buildSnapshot>>;
let kioskRow: Record<string, unknown>;

const api = '/api/v1';
const loc = () => `${api}/locations/${fixture.ids.locationId}`;
const db = () => asHubTx(hub.app.get(PrismaService));

beforeEach(async () => {
  fixture = await buildSnapshot();
  kioskRow = pendingTerminal(fixture.ids);
  fixture.tables.devices = [kioskRow];
  // A restaurant: the kiosk needs SELF_CHECKOUT, which its business type does not switch on.
  fixture.tables.featureOverrides = [moduleOverride(fixture.ids, 'SELF_CHECKOUT', true)];
  cloud = new FakeCloud();
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  await cloud.start();
  hub = await startHub();
  await pair(hub, cloud);
  expect(await hub.snapshots.syncNow()).toBe('applied');
});
afterEach(async () => {
  await hub.close();
  await cloud.stop();
  removeDir(hub.dataDir);
});

async function resync(): Promise<void> {
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  expect(await hub.snapshots.syncNow()).toBe('applied');
}

async function pairKiosk(code = KIOSK_CODE): Promise<Record<string, string>> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${api}/terminals/pair`,
    payload: { code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` },
  });
  expect(res.statusCode).toBe(200);
  return {
    authorization: `Device ${res.json<PairedTerminal>().credential}`,
    'x-madar-client-version': '1.0.0',
  };
}

async function signIn(email: string): Promise<Record<string, string>> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${api}/auth/login`,
    payload: { email, password: PASSWORD, client: 'native' },
  });
  return { ...bearer(res.json<TokenResponse>().accessToken), 'x-client-source': 'POS' };
}

async function kioskOrder(
  kiosk: Record<string, string>,
  payment: 'TERMINAL' | 'COUNTER',
  items: { productId: string; modifierIds?: string[]; barcode?: string }[] = [
    { productId: fixture.ids.burger, modifierIds: [fixture.ids.medium] },
    { productId: fixture.ids.cola },
  ],
) {
  return hub.app.inject({
    method: 'POST',
    url: `${loc()}/kiosk/orders`,
    headers: kiosk,
    payload: {
      id: newId(),
      payment,
      customerName: 'Lina',
      items: items.map((i) => ({ id: newId(), quantity: 1, ...i })),
    },
  });
}

const pay = (kiosk: Record<string, string>, orderId: string, id = newId()) =>
  hub.app.inject({
    method: 'POST',
    url: `${loc()}/kiosk/orders/${orderId}/payments`,
    headers: kiosk,
    payload: { id },
  });

describe('pairing a terminal with its hub', () => {
  it('pairs once with the code from the admin, without the cloud, and reports it through the outbox', async () => {
    await cloud.stop();
    const wrong = await hub.app.inject({
      method: 'POST',
      url: `${api}/terminals/pair`,
      payload: { code: 'WRNG-CODE' },
    });
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json<ApiErrorBody>().code).toBe('PAIRING_CODE_INVALID');

    const kiosk = await pairKiosk();
    const me = await hub.app.inject({ method: 'GET', url: `${api}/terminals/me`, headers: kiosk });
    expect(me.json()).toMatchObject({ id: kioskRow.id, type: 'KIOSK', name: 'Kiosk 1' });

    // Single use: the code no longer pairs anything.
    const again = await hub.app.inject({
      method: 'POST',
      url: `${api}/terminals/pair`,
      payload: { code: KIOSK_CODE },
    });
    expect(again.json<ApiErrorBody>().code).toBe('PAIRING_CODE_INVALID');

    const stored = await db().device.findUniqueOrThrow({ where: { id: String(kioskRow.id) } });
    expect(stored).toMatchObject({
      status: 'ACTIVE',
      pairingCodeHash: null,
      pairingExpiresAt: null,
      appVersion: '1.0.0',
    });
    expect(stored.credentialHash).toMatch(/^[0-9a-f]{64}$/);
    const reports = await db().syncOperation.findMany({ where: { entityType: 'Device' } });
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(reports.at(-1)?.payload).toMatchObject({ status: 'ACTIVE', appVersion: '1.0.0' });
    expect(JSON.stringify(reports.map((r) => r.payload))).not.toMatch(/credential|pairingCode/i);
  });

  it('refuses an expired code', async () => {
    fixture.tables.devices = [pendingTerminal(fixture.ids, { code: 'OLDC0DE2', expiresInMs: -1 })];
    await resync();
    const res = await hub.app.inject({
      method: 'POST',
      url: `${api}/terminals/pair`,
      payload: { code: 'OLDC0DE2' },
    });
    expect(res.json<ApiErrorBody>().code).toBe('PAIRING_CODE_INVALID');
  });

  it('keeps a pairing through a snapshot older than it, and locks the kiosk out once disabled', async () => {
    const kiosk = await pairKiosk();
    // The cloud has not heard of the pairing yet: its snapshot still says PENDING, with the code.
    fixture.tables.featureOverrides.push(moduleOverride(fixture.ids, 'TABLES', true));
    await resync();
    expect(
      (await hub.app.inject({ method: 'GET', url: `${api}/kiosk/context`, headers: kiosk }))
        .statusCode,
    ).toBe(200);
    const pairAgain = await hub.app.inject({
      method: 'POST',
      url: `${api}/terminals/pair`,
      payload: { code: KIOSK_CODE },
    });
    expect(pairAgain.json<ApiErrorBody>().code).toBe('PAIRING_CODE_INVALID');

    // An administrator disabled it in the cloud.
    fixture.tables.devices = [
      { ...kioskRow, status: 'DISABLED', pairingCodeHash: null, pairingExpiresAt: null },
    ];
    await resync();
    const locked = await hub.app.inject({
      method: 'GET',
      url: `${api}/kiosk/context`,
      headers: kiosk,
    });
    expect(locked.statusCode).toBe(401);
  });
});

describe('the kiosk at a restaurant', () => {
  it('reads its context: kiosk branding, the money and the modules of this location and device', async () => {
    const kiosk = await pairKiosk();
    const res = await hub.app.inject({
      method: 'GET',
      url: `${api}/kiosk/context`,
      headers: kiosk,
    });
    expect(res.statusCode).toBe(200);
    const context = res.json<KioskContext>();
    expect(context.device).toMatchObject({ id: kioskRow.id, locationId: fixture.ids.locationId });
    expect(context.location.code).toBe('MAIN');
    expect(context.context.features.SELF_CHECKOUT).toMatchObject({ enabled: true });
    const menu = await hub.app.inject({
      method: 'GET',
      url: `${loc()}/kiosk/menu`,
      headers: kiosk,
    });
    expect(
      menu
        .json<PublishedMenu>()
        .categories.flatMap((c) => c.products.map((p) => p.nameEn))
        .sort(),
    ).toEqual(['Burger', 'Cola', 'Fries']);
  });

  it('sends an order paid at the kiosk to the kitchen screen, priced like the POS', async () => {
    const kiosk = await pairKiosk();
    const placed = await kioskOrder(kiosk, 'TERMINAL');
    expect(placed.statusCode).toBe(201);
    const order = placed.json<Order>();
    expect(order).toMatchObject({
      channel: 'KIOSK',
      source: 'KIOSK',
      status: 'PLACED',
      paymentStatus: 'UNPAID',
      customerName: 'Lina',
      createdById: null,
      // The server's prices: burger 25.00 + cola 6.00, tax included.
      total: 3100,
    });
    expect(order.tickets).toEqual([]);

    const paid = await pay(kiosk, order.id);
    expect(paid.statusCode).toBe(200);
    const outcome = paid.json<KioskPaymentOutcome>();
    expect(outcome.payment).toMatchObject({
      status: 'CAPTURED',
      methodType: 'CARD',
      shiftId: null,
      deviceId: kioskRow.id,
      amount: 3100,
    });
    expect(outcome.payment.reference).toMatch(/^MT\d{6}$/);
    expect(outcome.order).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect(outcome.order.statusHistory.map((h) => [h.toStatus, h.source, h.actorId])).toEqual([
      ['PLACED', 'KIOSK', kioskRow.id],
      ['CONFIRMED', 'KIOSK', kioskRow.id],
    ]);

    // The kitchen sees it on its screen, station by station.
    const kitchen = { ...(await signIn('kitchen@hub.test')), 'x-client-source': 'KDS' };
    const tickets = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/kitchen/tickets`, headers: kitchen })
    ).json<KitchenTicket[]>();
    expect(tickets.filter((t) => t.orderId === order.id).map((t) => t.stationNameEn)).toEqual([
      'Grill',
    ]);

    // The cloud receives the order with its drawer-less card payment, after the kiosk's pairing.
    const ops = await db().syncOperation.findMany({ orderBy: { createdAt: 'asc' } });
    const last = ops.filter((o) => o.entityId === order.id).at(-1);
    expect(last?.payload).toMatchObject({
      channel: 'KIOSK',
      source: 'KIOSK',
      payments: [{ deviceId: kioskRow.id, shiftId: null, provider: 'mock-terminal' }],
    });
    expect(ops.findIndex((o) => o.entityType === 'Device')).toBeLessThan(
      ops.findIndex((o) => o.entityId === order.id),
    );
  });

  it('never charges twice: the same order and payment ids replay their first answer', async () => {
    const kiosk = await pairKiosk();
    const id = newId();
    const body = {
      id,
      payment: 'TERMINAL',
      items: [{ id: newId(), productId: fixture.ids.cola, quantity: 2 }],
    };
    const first = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/kiosk/orders`,
      headers: kiosk,
      payload: body,
    });
    const second = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/kiosk/orders`,
      headers: kiosk,
      payload: body,
    });
    expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
    const paymentId = newId();
    const a = (await pay(kiosk, id, paymentId)).json<KioskPaymentOutcome>();
    const b = (await pay(kiosk, id, paymentId)).json<KioskPaymentOutcome>();
    expect(b.payment.id).toBe(a.payment.id);
    expect(b.order.status).toBe('CONFIRMED');
    expect(await db().payment.count({ where: { orderId: id } })).toBe(1);
    // Paid in full: a new payment intent is refused.
    const third = await pay(kiosk, id);
    expect(third.json<ApiErrorBody>()).toMatchObject({
      code: 'PAYMENT_FAILED',
      details: { reason: 'ALREADY_PAID' },
    });
  });

  it('records a declined card and leaves the order waiting; another attempt pays it', async () => {
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'TERMINAL')).json<Order>();
    MockPaymentTerminal.declineNext();
    const declined = (await pay(kiosk, order.id)).json<KioskPaymentOutcome>();
    expect(declined.payment.status).toBe('FAILED');
    expect(declined.order).toMatchObject({ status: 'PLACED', paymentStatus: 'UNPAID' });
    const retried = (await pay(kiosk, order.id)).json<KioskPaymentOutcome>();
    expect(retried.payment.status).toBe('CAPTURED');
    expect(retried.order.status).toBe('CONFIRMED');
  });

  it('lets the customer walk away: the kiosk cancels its own unpaid order', async () => {
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'TERMINAL')).json<Order>();
    const res = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/kiosk/orders/${order.id}/cancel`,
      headers: kiosk,
    });
    expect(res.json<Order>()).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'KIOSK_CANCELLED',
    });
  });

  it('waits for a cashier when the customer pays at the counter, then goes to the kitchen', async () => {
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'COUNTER')).json<Order>();
    expect(order).toMatchObject({ status: 'PLACED', paymentStatus: 'UNPAID' });

    // The POS lists it among open orders, takes the money in its drawer and confirms it.
    const pin = await hub.app.inject({
      method: 'POST',
      url: `${api}/auth/pin`,
      payload: { employeeCode: '1001', pin: CASHIER_PIN },
    });
    const cashier = { ...bearer(pin.json<TokenResponse>().accessToken), 'x-client-source': 'POS' };
    const open = await hub.app.inject({
      method: 'GET',
      url: `${loc()}/orders?status=PLACED`,
      headers: cashier,
    });
    expect(open.json<Order[]>().map((o) => [o.id, o.channel])).toContainEqual([order.id, 'KIOSK']);
    const shift = (
      await hub.app.inject({
        method: 'POST',
        url: `${loc()}/shifts`,
        headers: cashier,
        payload: { id: newId(), cashRegisterId: fixture.ids.drawer, openingFloat: 0 },
      })
    ).json<Shift>();
    const paid = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders/${order.id}/payments`,
      headers: cashier,
      payload: {
        id: newId(),
        shiftId: shift.id,
        paymentMethodId: fixture.ids.cash,
        amount: order.total,
      },
    });
    expect(paid.json<{ order: Order }>().order.paymentStatus).toBe('PAID');
    const confirmed = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders/${order.id}/transitions`,
      headers: cashier,
      payload: { to: 'CONFIRMED' },
    });
    expect(confirmed.json<Order>()).toMatchObject({ status: 'CONFIRMED' });
    expect(confirmed.json<Order>().tickets).toHaveLength(1);
    // The kiosk no longer has anything to do with it: its own cancel is refused.
    const cancel = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/kiosk/orders/${order.id}/cancel`,
      headers: kiosk,
    });
    expect(cancel.json<ApiErrorBody>().code).toBe('INVALID_ORDER_STATE');
  });

  it("does not see another kiosk's orders", async () => {
    const other = pendingTerminal(fixture.ids, { code: 'SECOND22', name: 'Kiosk 2' });
    fixture.tables.devices.push(other);
    await resync();
    const first = await pairKiosk();
    const second = await pairKiosk('SECOND22');
    const order = (await kioskOrder(first, 'TERMINAL')).json<Order>();
    const res = await pay(second, order.id);
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('ORDER_NOT_FOUND');
    expect(await db().payment.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('keeps taking and paying orders with the cloud out of reach', async () => {
    await cloud.stop();
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'TERMINAL')).json<Order>();
    const outcome = (await pay(kiosk, order.id)).json<KioskPaymentOutcome>();
    expect(outcome.order.status).toBe('CONFIRMED');
    const pending = await db().syncOperation.count({
      where: { entityId: order.id, status: 'PENDING' },
    });
    expect(pending).toBeGreaterThan(0);
  });
});

describe('the kiosk card reader is the tenant’s provider (ADR 0024)', () => {
  /** A TERMINAL account of the tenant, as the snapshot brings it: no secrets, ever. */
  const terminalAccount = (locationId: string | null, status = 'ACTIVE') => ({
    id: newId(),
    tenantId: fixture.ids.tenantId,
    locationId,
    method: 'TERMINAL',
    providerKey: 'mock-terminal',
    mode: 'TEST',
    status,
    publicConfig: { terminalLabel: 'Front reader' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  async function restartWithoutDevelopmentDefault(): Promise<void> {
    await hub.close();
    removeDir(hub.dataDir);
    hub = await startHub(undefined, { DEV_PAYMENT_PROVIDERS: '' });
    await pair(hub, cloud);
    expect(await hub.snapshots.syncNow()).toBe('applied');
  }

  it('refuses card payments when the tenant has no terminal provider: pay at the counter', async () => {
    await restartWithoutDevelopmentDefault();
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'TERMINAL')).json<Order>();
    const res = await pay(kiosk, order.id);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'PAYMENT_FAILED',
      details: { reason: 'PROVIDER_NOT_CONFIGURED' },
    });
    expect(await db().payment.count()).toBe(0);
  });

  it('charges through the location’s own account and records it on the payment', async () => {
    await restartWithoutDevelopmentDefault();
    const tenantWide = terminalAccount(null, 'DISABLED');
    const here = terminalAccount(fixture.ids.locationId);
    fixture.tables.paymentProviderAccounts = [tenantWide, here];
    await resync();
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'TERMINAL')).json<Order>();
    const paid = (await pay(kiosk, order.id)).json<KioskPaymentOutcome>();
    expect(paid.payment.status).toBe('CAPTURED');
    const row = await db().payment.findUniqueOrThrow({ where: { id: paid.payment.id } });
    expect(row).toMatchObject({ provider: 'mock-terminal', providerAccountId: here.id });
    // The hub holds the account but no secret table at all.
    expect(await db().paymentProviderAccount.count()).toBe(2);
    expect('paymentProviderSecret' in db()).toBe(false);
  });
});

describe('self-checkout at a store', () => {
  beforeEach(async () => {
    // No kitchen, and barcodes on the cola: a shop's self-checkout.
    fixture.tables.featureOverrides.push(
      moduleOverride(fixture.ids, 'KDS', false),
      moduleOverride(fixture.ids, 'BARCODE', true),
    );
    fixture.tables.productBarcodes = [
      {
        id: newId(),
        tenantId: fixture.ids.tenantId,
        productId: fixture.ids.cola,
        variantId: null,
        code: '5449000000996',
        symbology: 'EAN13',
        isPrimary: true,
      },
    ];
    await resync();
  });

  it('completes a scanned, paid sale at once, with nothing for a kitchen', async () => {
    const kiosk = await pairKiosk();
    const menu = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/kiosk/menu`, headers: kiosk })
    ).json<PublishedMenu>();
    const cola = menu.categories.flatMap((c) => c.products).find((p) => p.id === fixture.ids.cola);
    expect(cola?.barcodes).toEqual(['5449000000996']);

    const order = (
      await kioskOrder(kiosk, 'TERMINAL', [
        { productId: fixture.ids.cola, barcode: '5449000000996' },
        { productId: fixture.ids.fries },
      ])
    ).json<Order>();
    expect(order.items.map((i) => i.barcode)).toEqual(['5449000000996', null]);
    const outcome = (await pay(kiosk, order.id)).json<KioskPaymentOutcome>();
    expect(outcome.order).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID' });
    expect(outcome.order.completedAt).not.toBeNull();
    expect(outcome.order.statusHistory.map((h) => h.toStatus)).toEqual([
      'PLACED',
      'CONFIRMED',
      'COMPLETED',
    ]);
    expect(await db().kitchenTicket.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('refuses a scanned code that is not on the item', async () => {
    const kiosk = await pairKiosk();
    const res = await kioskOrder(kiosk, 'TERMINAL', [
      { productId: fixture.ids.fries, barcode: '5449000000996' },
    ]);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'BARCODE_NOT_FOUND',
      details: { reason: 'NOT_ON_ITEM' },
    });
  });
});

describe('modules and staff', () => {
  it('answers 403 FEATURE_DISABLED with SELF_CHECKOUT off for the location or this kiosk', async () => {
    const kiosk = await pairKiosk();
    const order = (await kioskOrder(kiosk, 'COUNTER')).json<Order>();
    for (const overrides of [
      [moduleOverride(fixture.ids, 'SELF_CHECKOUT', false)],
      [
        moduleOverride(fixture.ids, 'SELF_CHECKOUT', true),
        moduleOverride(fixture.ids, 'SELF_CHECKOUT', false, String(kioskRow.id)),
      ],
    ]) {
      fixture.tables.featureOverrides = overrides;
      await resync();
      const calls = [
        hub.app.inject({ method: 'GET', url: `${loc()}/kiosk/menu`, headers: kiosk }),
        kioskOrder(kiosk, 'TERMINAL'),
        pay(kiosk, order.id),
        hub.app.inject({
          method: 'POST',
          url: `${loc()}/kiosk/orders/${order.id}/cancel`,
          headers: kiosk,
        }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.statusCode).toBe(403);
        expect(res.json<ApiErrorBody>()).toMatchObject({
          code: 'FEATURE_DISABLED',
          details: { feature: 'SELF_CHECKOUT' },
        });
      }
      // It can still say so, and still let staff out.
      const context = await hub.app.inject({
        method: 'GET',
        url: `${api}/kiosk/context`,
        headers: kiosk,
      });
      expect(context.json<KioskContext>().context.features.SELF_CHECKOUT.enabled).toBe(false);
    }
  });

  it('lets staff with kiosk.attend out by employee code and PIN, and nobody else', async () => {
    const kiosk = await pairKiosk();
    const attend = (pin: string) =>
      hub.app.inject({
        method: 'POST',
        url: `${api}/kiosk/attendant`,
        headers: kiosk,
        payload: { employeeCode: '1001', pin },
      });
    expect((await attend('0000')).json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
    // The cashier's role lacks kiosk.attend.
    const refused = await attend(CASHIER_PIN);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'INSUFFICIENT_PERMISSION',
      details: { missing: ['kiosk.attend'] },
    });
    fixture.tables.rolePermissions.push({
      roleId: fixture.ids.cashierRole,
      permissionKey: 'kiosk.attend',
    });
    await resync();
    const res = await attend(CASHIER_PIN);
    expect(res.statusCode).toBe(200);
    expect(res.json<KioskAttendant>()).toEqual({
      employeeId: fixture.ids.employee,
      displayName: 'Cashier',
    });
    // Opening the attendant menu issues no staff session.
    expect(JSON.stringify(res.json())).not.toMatch(/token/i);
  });
});
