import { createHash } from 'node:crypto';
import { newId } from '@pos/domain';
import type { ApiErrorBody, ResolvedBranding, ResolvedLocales } from '@pos/shared-types';
import type {
  CatalogLookup,
  HubStatus,
  KitchenTicket,
  Order,
  PublishedMenu,
  Shift,
  TenantContextDto,
  TokenResponse,
} from '@pos/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asHubTx } from '../src/database/hub-database';
import { PrismaService, TenantContext, TenantScopeError } from '@pos/server';
import { CASHIER_PIN, PASSWORD, buildSnapshot, withVersion } from './snapshot-fixture';
import { FakeCloud, type TestHub, bearer, pair, removeDir, startHub } from './harness';

let cloud: FakeCloud;
let hub: TestHub;
let fixture: Awaited<ReturnType<typeof buildSnapshot>>;

beforeEach(async () => {
  fixture = await buildSnapshot();
  cloud = new FakeCloud();
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  await cloud.start();
  hub = await startHub();
});
afterEach(async () => {
  await hub.close();
  await cloud.stop();
  removeDir(hub.dataDir);
});

const api = '/api/v1';
const loc = () => `${api}/locations/${fixture.ids.locationId}`;
const outbox = () =>
  asHubTx(hub.app.get(PrismaService)).syncOperation.findMany({ orderBy: { createdAt: 'asc' } });
/** Business entities only: every staff action also queues its audit entry (ADR 0016). */
const businessOutbox = async () => (await outbox()).filter((o) => o.entityType !== 'AuditLog');

async function provision(): Promise<void> {
  await pair(hub, cloud);
  expect(await hub.snapshots.syncNow()).toBe('applied');
}

async function signIn(email: string): Promise<Record<string, string>> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${api}/auth/login`,
    payload: { email, password: PASSWORD, client: 'native' },
  });
  expect(res.statusCode).toBe(200);
  return { ...bearer(res.json<TokenResponse>().accessToken), 'x-client-source': 'POS' };
}

async function pinSignIn(pin = CASHIER_PIN, code = '1001') {
  return hub.app.inject({
    method: 'POST',
    url: `${api}/auth/pin`,
    payload: { employeeCode: code, pin },
  });
}

async function placeOrder(headers: Record<string, string>, productIds: string[]): Promise<Order> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${loc()}/orders`,
    headers,
    payload: {
      id: newId(),
      channel: 'TAKEAWAY',
      status: 'CONFIRMED',
      items: productIds.map((productId) => ({
        id: newId(),
        productId,
        quantity: 1,
        modifierIds: productId === fixture.ids.burger ? [fixture.ids.medium] : [],
      })),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Order>();
}

describe('provisioning', () => {
  it('refuses to serve until it has its location from the cloud', async () => {
    const status = await hub.app.inject({ method: 'GET', url: `${api}/hub/status` });
    expect(status.json<HubStatus>()).toMatchObject({ paired: false, cloud: 'UNKNOWN' });
    const login = await hub.app.inject({
      method: 'POST',
      url: `${api}/auth/login`,
      payload: { email: 'owner@hub.test', password: PASSWORD },
    });
    expect(login.statusCode).toBe(503);
    expect(login.json<ApiErrorBody>().code).toBe('HUB_NOT_PROVISIONED');

    await provision();
    const after = (
      await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })
    ).json<HubStatus>();
    expect(after).toMatchObject({
      paired: true,
      cloud: 'ONLINE',
      locationId: fixture.ids.locationId,
      snapshotVersion: cloud.snapshot?.version,
      pendingOperations: 0,
    });
    expect(JSON.stringify(after)).not.toContain(cloud.credential);
  });

  it('serves the synced menu, staff and floor from SQLite', async () => {
    await provision();
    const owner = await signIn('owner@hub.test');
    const menu = await hub.app.inject({ method: 'GET', url: `${loc()}/menu`, headers: owner });
    const products = menu
      .json<PublishedMenu>()
      .categories.flatMap((c) => c.products.map((p) => p.nameEn))
      .sort();
    expect(products).toEqual(['Burger', 'Cola', 'Fries']);
    const floor = await hub.app.inject({ method: 'GET', url: `${loc()}/floor`, headers: owner });
    expect(floor.statusCode).toBe(200);
  });
});

describe('signing in at the hub', () => {
  beforeEach(provision);

  it('accepts the employee code and PIN of an active employee', async () => {
    const res = await pinSignIn();
    expect(res.statusCode).toBe(200);
    const body = res.json<TokenResponse>();
    expect(body.user.email).toBe('cashier@hub.test');
    expect(body.refreshToken).toBeTruthy();
  });

  it('locks an employee code after five wrong PINs', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await pinSignIn('0000')).json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await pinSignIn();
    expect(locked.statusCode).toBe(429);
    expect(locked.json<ApiErrorBody>().code).toBe('RATE_LIMITED');
    expect((await pinSignIn(CASHIER_PIN, '9999')).json<ApiErrorBody>().code).toBe(
      'INVALID_CREDENTIALS',
    );
  });
  it('signs nobody in when an employee code matches staff of two tenants (ADR 0017)', async () => {
    // Cannot come from the cloud (snapshots of another tenant are refused); written directly.
    const db = hub.app.get(PrismaService);
    const stray = newId();
    await db.tenant.create({
      data: {
        id: stray,
        slug: 'stray',
        nameEn: 'S',
        nameAr: 'S',
        currencyCode: 'SAR',
        timezone: 'UTC',
      },
    });
    await db.employee.create({
      data: { tenantId: stray, employeeCode: '1001', displayName: 'Other', pinHash: 'x' },
    });
    expect((await pinSignIn()).json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
  });
});

describe('running a location on the hub', () => {
  beforeEach(provision);

  it('takes an order through payment, kitchen and handover, recording each change in the outbox', async () => {
    const cashier = await signIn('cashier@hub.test');
    const kitchen = { ...(await signIn('kitchen@hub.test')), 'x-client-source': 'KDS' };
    const order = await placeOrder(cashier, [fixture.ids.burger, fixture.ids.fries]);
    expect(order.tickets.map((t) => t.stationNameEn).sort()).toEqual(['Fryer', 'Grill']);
    expect(order.orderNumber).toBe('MAIN-001');

    const shift = (
      await hub.app.inject({
        method: 'POST',
        url: `${loc()}/shifts`,
        headers: cashier,
        payload: { id: newId(), cashRegisterId: fixture.ids.drawer, openingFloat: 10_000 },
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
        tendered: 5000,
      },
    });
    expect(paid.json<{ order: Order }>().order.paymentStatus).toBe('PAID');

    const tickets = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/kitchen/tickets`, headers: kitchen })
    ).json<KitchenTicket[]>();
    await Promise.all(
      tickets.map((t) =>
        hub.app.inject({
          method: 'POST',
          url: `${loc()}/kitchen/tickets/${t.id}/transitions`,
          headers: kitchen,
          payload: { to: 'READY', version: t.version },
        }),
      ),
    );
    const ready = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/orders/${order.id}`, headers: cashier })
    ).json<Order>();
    expect(ready.status).toBe('READY');
    expect(ready.statusHistory.filter((h) => h.toStatus === 'READY')).toHaveLength(1);

    const done = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders/${order.id}/transitions`,
      headers: cashier,
      payload: { to: 'COMPLETED' },
    });
    expect(done.json<Order>().status).toBe('COMPLETED');

    const ops = await outbox();
    const types = ops.map((o) => o.operationType);
    expect(types.filter((t) => t === 'ORDER_UPSERT').length).toBeGreaterThanOrEqual(4);
    expect(types).toContain('SHIFT_UPSERT');
    expect(types).toContain('KITCHEN_TICKET_UPSERT');
    // entityVersion is the hub's per-entity change sequence; the payload carries the row version.
    const orderOps = ops.filter((o) => o.entityId === order.id);
    expect(orderOps.map((o) => o.entityVersion)).toEqual(orderOps.map((_, i) => i + 1));
    const lastOrderOp = orderOps.at(-1);
    expect(lastOrderOp?.status).toBe('PENDING');
    expect(lastOrderOp?.payload).toMatchObject({
      status: 'COMPLETED',
      version: done.json<Order>().version,
    });
    expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
  });

  it('writes nothing to the outbox when a change is rejected', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier, [fixture.ids.cola]);
    const before = (await businessOutbox()).length;
    const shift = (
      await hub.app.inject({
        method: 'POST',
        url: `${loc()}/shifts`,
        headers: cashier,
        payload: { id: newId(), cashRegisterId: fixture.ids.drawer, openingFloat: 0 },
      })
    ).json<Shift>();
    const afterShift = (await businessOutbox()).length;
    const all = (await outbox()).length;
    expect(afterShift).toBe(before + 1);
    const overpay = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders/${order.id}/payments`,
      headers: cashier,
      payload: {
        id: newId(),
        shiftId: shift.id,
        paymentMethodId: fixture.ids.card,
        amount: order.total + 100,
        reference: 'AUTH1',
      },
    });
    expect(overpay.statusCode).toBe(422);
    // Neither the payment nor its audit entry reached the outbox: the transaction rolled back.
    expect((await outbox()).length).toBe(all);
  });

  it('creates an order once when the POS resends it, also concurrently', async () => {
    const cashier = await signIn('cashier@hub.test');
    const payload = {
      id: newId(),
      channel: 'TAKEAWAY',
      status: 'CONFIRMED',
      items: [{ id: newId(), productId: fixture.ids.cola, quantity: 2 }],
    };
    const send = () =>
      hub.app.inject({ method: 'POST', url: `${loc()}/orders`, headers: cashier, payload });
    const first = await send();
    expect(first.statusCode).toBe(201);
    // A retry after a lost response, then two terminals' retries racing each other.
    const [again, racing1, racing2] = await Promise.all([send(), send(), send()]);
    for (const res of [again, racing1, racing2]) {
      expect(res.statusCode).toBeLessThan(300);
      expect(res.json<Order>()).toMatchObject({
        id: payload.id,
        orderNumber: first.json<Order>().orderNumber,
      });
    }
    const db = asHubTx(hub.app.get(PrismaService));
    expect(await db.order.count({ where: { id: payload.id } })).toBe(1);
    expect(await db.orderItem.count({ where: { orderId: payload.id } })).toBe(1);
    const ops = (await businessOutbox()).filter((o) => o.entityId === payload.id);
    expect(ops).toHaveLength(1);
  });

  it('never over-collects when two terminals pay the same order at once', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier, [fixture.ids.fries]);
    const shift = (
      await hub.app.inject({
        method: 'POST',
        url: `${loc()}/shifts`,
        headers: cashier,
        payload: { id: newId(), cashRegisterId: fixture.ids.drawer, openingFloat: 0 },
      })
    ).json<Shift>();
    const pay = () =>
      hub.app.inject({
        method: 'POST',
        url: `${loc()}/orders/${order.id}/payments`,
        headers: cashier,
        payload: {
          id: newId(),
          shiftId: shift.id,
          paymentMethodId: fixture.ids.card,
          amount: order.total,
          reference: 'AUTH',
        },
      });
    const results = await Promise.all([pay(), pay(), pay()]);
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const final = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/orders/${order.id}`, headers: cashier })
    ).json<Order>();
    expect(final.paidTotal).toBe(order.total);
  });

  it('keeps cloud-managed settings read-only', async () => {
    const owner = await signIn('owner@hub.test');
    const write = await hub.app.inject({
      method: 'POST',
      url: `${api}/tenants/${fixture.ids.tenantId}/categories`,
      headers: owner,
      payload: { nameEn: 'New', nameAr: 'جديد' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json<ApiErrorBody>().code).toBe('MANAGED_IN_CLOUD');
    const read = await hub.app.inject({
      method: 'GET',
      url: `${api}/tenants/${fixture.ids.tenantId}/categories`,
      headers: owner,
    });
    expect(read.statusCode).toBe(200);
  });
});

describe('the tenant-scoped client on SQLite (ADR 0017)', () => {
  beforeEach(provision);

  it('limits queries to the tenant in scope and refuses writes for another', async () => {
    const db = hub.app.get(PrismaService);
    const { tenantId } = fixture.ids;
    // Outside a request the hub works on its own (single-tenant) database.
    const all = await db.product.count();
    expect(all).toBeGreaterThan(0);
    expect(await TenantContext.runInTenant(tenantId, () => db.product.count())).toBe(all);
    expect(await TenantContext.runInTenant(newId(), () => db.product.count())).toBe(0);
    await expect(
      TenantContext.runInTenant(tenantId, () =>
        db.category.create({ data: { tenantId: newId(), nameEn: 'x', nameAr: 'x' } }),
      ),
    ).rejects.toThrow(TenantScopeError);
  });
});

describe('without the Internet', () => {
  beforeEach(provision);

  it('keeps taking orders when the cloud is unreachable, and says so', async () => {
    await cloud.stop();
    expect(await hub.snapshots.syncNow()).toBe('offline');
    const status = (
      await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })
    ).json<HubStatus>();
    expect(status.cloud).toBe('OFFLINE');

    const cashier = await pinSignIn();
    expect(cashier.statusCode).toBe(200);
    const headers = bearer(cashier.json<TokenResponse>().accessToken);
    const order = await placeOrder(headers, [fixture.ids.burger]);
    expect(order.status).toBe('CONFIRMED');
    const pending = (
      await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })
    ).json<HubStatus>();
    expect(pending.pendingOperations).toBeGreaterThan(0);
    await cloud.start();
  });

  it('survives a restart with all its data', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier, [fixture.ids.cola]);
    const dataDir = hub.dataDir;
    await hub.close();
    await cloud.stop();
    hub = await startHub(dataDir);
    const again = await signIn('cashier@hub.test');
    const res = await hub.app.inject({
      method: 'GET',
      url: `${loc()}/orders/${order.id}`,
      headers: again,
    });
    expect(res.json<Order>().orderNumber).toBe(order.orderNumber);
    await cloud.start();
  });
});

describe('configuration from the cloud', () => {
  beforeEach(provision);

  it('applies changes on the next pull and skips unchanged snapshots', async () => {
    expect(await hub.snapshots.syncNow()).toBe('unchanged');
    const fries = fixture.tables.products.find((p) => p.id === fixture.ids.fries);
    if (fries) fries.price = 1100;
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('applied');
    const owner = await signIn('owner@hub.test');
    const menu = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/menu`, headers: owner })
    ).json<PublishedMenu>();
    const price = menu.categories.flatMap((c) => c.products).find((p) => p.nameEn === 'Fries');
    expect(price?.price).toBe(1100);
  });

  it('refuses a snapshot holding another tenant’s rows, keeping its last copy (ADR 0017)', async () => {
    const fries = fixture.tables.products.find((p) => p.id === fixture.ids.fries);
    if (fries) Object.assign(fries, { tenantId: newId(), price: 1 });
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('rejected');
    const status = (
      await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })
    ).json<HubStatus>();
    expect(status.lastError).toMatch(/another tenant/);
    const owner = await signIn('owner@hub.test');
    const menu = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/menu`, headers: owner })
    ).json<PublishedMenu>();
    const kept = menu.categories.flatMap((c) => c.products).find((p) => p.nameEn === 'Fries');
    expect(kept?.price).not.toBe(1);
  });

  it('continues the cloud’s order numbers for the day, and never goes backwards', async () => {
    const cashier = await signIn('cashier@hub.test');
    const first = await placeOrder(cashier, [fixture.ids.cola]);
    expect(first.orderNumber).toBe('MAIN-001');
    // The cloud had numbered 41 orders today before this hub was paired.
    fixture.tables.orderCounters = [
      { locationId: fixture.ids.locationId, businessDate: first.businessDate, lastNumber: 41 },
    ];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('applied');
    expect((await placeOrder(cashier, [fixture.ids.cola])).orderNumber).toBe('MAIN-042');

    fixture.tables.orderCounters = [
      { locationId: fixture.ids.locationId, businessDate: first.businessDate, lastNumber: 3 },
    ];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('applied');
    expect((await placeOrder(cashier, [fixture.ids.cola])).orderNumber).toBe('MAIN-043');
  });

  it('deactivates staff the cloud no longer sends, and keeps their past orders', async () => {
    const cashier = await signIn('cashier@hub.test');
    await placeOrder(cashier, [fixture.ids.cola]);
    fixture.tables.users = fixture.tables.users.filter((u) => u.id !== fixture.ids.cashier);
    fixture.tables.userRoles = fixture.tables.userRoles.filter(
      (r) => r.userId !== fixture.ids.cashier,
    );
    fixture.tables.employees = [];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('applied');
    const login = await hub.app.inject({
      method: 'POST',
      url: `${api}/auth/login`,
      payload: { email: 'cashier@hub.test', password: PASSWORD },
    });
    expect(login.json<ApiErrorBody>().code).toBe('ACCOUNT_DISABLED');
    expect((await pinSignIn()).json<ApiErrorBody>().code).toBe('INVALID_CREDENTIALS');
  });

  it('keeps serving its last copy when the cloud rejects its credential', async () => {
    cloud.mode = 'reject';
    expect(await hub.snapshots.syncNow()).toBe('rejected');
    const status = (
      await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })
    ).json<HubStatus>();
    expect(status.lastError).toMatch(/re-pair/);
    expect((await pinSignIn()).statusCode).toBe(200);
  });
});

describe('modules at the hub (ADR 0018)', () => {
  beforeEach(async () => {
    const { tenantId, locationId } = fixture.ids;
    // The tenant has no kitchen display, this location no tables, and its plan no modifiers.
    fixture.tables.featureOverrides = [
      {
        id: newId(),
        tenantId,
        locationId: null,
        deviceId: null,
        scope: 'tenant',
        feature: 'KDS',
        enabled: false,
      },
      {
        id: newId(),
        tenantId,
        locationId,
        deviceId: null,
        scope: `location:${locationId}`,
        feature: 'TABLES',
        enabled: false,
      },
    ];
    fixture.tables.tenantEntitlements = [
      { tenantId, feature: 'MODIFIERS', entitled: false, tenantConfigurable: false },
    ];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    await provision();
  });

  it('enforces the cloud’s modules with the cloud unreachable', async () => {
    await cloud.stop();
    expect(await hub.snapshots.syncNow()).toBe('offline');
    const owner = await signIn('owner@hub.test');

    const context = await hub.app.inject({
      method: 'GET',
      url: `${api}/tenants/${fixture.ids.tenantId}/context?locationId=${fixture.ids.locationId}`,
      headers: owner,
    });
    const { features } = context.json<TenantContextDto>();
    expect(features.KDS).toMatchObject({ enabled: false, source: 'TENANT' });
    expect(features.TABLES).toMatchObject({ enabled: false, source: 'LOCATION' });
    expect(features.MODIFIERS).toMatchObject({ enabled: false, entitled: false });

    for (const url of [`${loc()}/kitchen/tickets`, `${loc()}/floor`]) {
      const refused = await hub.app.inject({ method: 'GET', url, headers: owner });
      expect(refused.statusCode, url).toBe(403);
      expect(refused.json<ApiErrorBody>().code).toBe('FEATURE_DISABLED');
    }

    // Dine-in without a table, a burger without its required doneness, and no kitchen ticket.
    const res = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders`,
      headers: owner,
      payload: {
        id: newId(),
        channel: 'DINE_IN',
        status: 'CONFIRMED',
        items: [{ id: newId(), productId: fixture.ids.burger, quantity: 1 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<Order>().tickets).toEqual([]);
    await cloud.start();
  });

  it('follows the cloud when the modules change', async () => {
    fixture.tables.featureOverrides = [];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('applied');
    const owner = await signIn('owner@hub.test');
    const tickets = await hub.app.inject({
      method: 'GET',
      url: `${loc()}/kitchen/tickets`,
      headers: owner,
    });
    expect(tickets.statusCode).toBe(200);
  });
});

describe('barcodes offline (ADR 0021)', () => {
  const tee = newId();
  const size = newId();
  const small = newId();
  const medium = newId();
  const teeS = newId();
  const teeM = newId();

  /** A T-shirt in two sizes (an option axis), each with its barcode, and fries by their own. */
  function withRetailCatalog(barcodeModule: boolean) {
    const { tenantId, category, fries } = fixture.ids;
    fixture.tables.products.push({
      id: tee,
      tenantId,
      categoryId: category,
      sku: 'TEE',
      nameEn: 'T-shirt',
      nameAr: 'قميص',
      price: 6000,
    });
    fixture.tables.productVariants = [
      {
        id: teeS,
        productId: tee,
        nameEn: 'S',
        nameAr: 'ص',
        sku: 'TEE-S',
        price: 6000,
        sortOrder: 0,
      },
      {
        id: teeM,
        productId: tee,
        nameEn: 'M',
        nameAr: 'م',
        sku: 'TEE-M',
        price: 6500,
        sortOrder: 1,
      },
    ];
    fixture.tables.productOptions = [
      { id: size, productId: tee, nameEn: 'Size', nameAr: 'المقاس' },
    ];
    fixture.tables.productOptionValues = [
      { id: small, optionId: size, nameEn: 'S', nameAr: 'ص', sortOrder: 0 },
      { id: medium, optionId: size, nameEn: 'M', nameAr: 'م', sortOrder: 1 },
    ];
    fixture.tables.productVariantOptionValues = [
      { variantId: teeS, optionValueId: small },
      { variantId: teeM, optionValueId: medium },
    ];
    const code = (productId: string, variantId: string | null, value: string) => ({
      id: newId(),
      tenantId,
      productId,
      variantId,
      code: value,
      symbology: value.length === 13 ? 'EAN13' : 'CODE128',
      isPrimary: true,
    });
    fixture.tables.productBarcodes = [
      code(fries, null, '6291000000013'),
      code(tee, teeS, '6291234000018'),
      code(tee, teeM, '6291234000025'),
    ];
    fixture.tables.featureOverrides = barcodeModule
      ? [
          {
            id: newId(),
            tenantId,
            locationId: null,
            deviceId: null,
            scope: 'tenant',
            feature: 'BARCODE',
            enabled: true,
          },
        ]
      : [];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  }

  const lookup = (headers: Record<string, string>, code: string) =>
    hub.app.inject({
      method: 'GET',
      url: `${loc()}/catalog/lookup?code=${encodeURIComponent(code)}`,
      headers,
    });

  it('looks codes up by product and by variant, and sells them, with the cloud unreachable', async () => {
    withRetailCatalog(true);
    await provision();
    await cloud.stop();
    expect(await hub.snapshots.syncNow()).toBe('offline');
    const owner = await signIn('owner@hub.test');

    const menu = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/menu`, headers: owner })
    ).json<PublishedMenu>();
    const shirt = menu.categories.flatMap((c) => c.products).find((p) => p.id === tee);
    expect(shirt?.variants.map((v) => [v.sku, v.barcodes])).toEqual([
      ['TEE-S', ['6291234000018']],
      ['TEE-M', ['6291234000025']],
    ]);

    const byProduct = await lookup(owner, '6291000000013');
    expect(byProduct.statusCode).toBe(200);
    expect(byProduct.json<CatalogLookup>()).toMatchObject({
      product: { id: fixture.ids.fries, price: 900 },
      variantId: null,
      matchedBy: 'BARCODE',
    });
    const byVariant = (await lookup(owner, '6291234000025')).json<CatalogLookup>();
    expect(byVariant).toMatchObject({ product: { id: tee }, variantId: teeM });
    expect((await lookup(owner, 'TEE-S')).json<CatalogLookup>()).toMatchObject({
      variantId: teeS,
      matchedBy: 'SKU',
    });
    const unknown = await lookup(owner, '0000000000000');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().code).toBe('BARCODE_NOT_FOUND');

    // The scanned line keeps its code and SKU, here and in what the hub sends the cloud.
    const res = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders`,
      headers: owner,
      payload: {
        id: newId(),
        channel: 'TAKEAWAY',
        status: 'CONFIRMED',
        items: [
          { id: newId(), productId: tee, variantId: teeM, quantity: 1, barcode: '6291234000025' },
          { id: newId(), productId: fixture.ids.fries, quantity: 1 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json<Order>();
    expect(order.items.map((i) => [i.sku, i.barcode, i.unitPrice])).toEqual([
      ['TEE-M', '6291234000025', 6500],
      [null, '6291000000013', 900],
    ]);
    const pushed = (await businessOutbox()).find((o) => o.entityType === 'Order');
    expect(JSON.stringify(pushed?.payload)).toContain('"barcode":"6291234000025"');
    await cloud.start();
  });

  it('answers 403 without the BARCODE module and publishes no codes', async () => {
    withRetailCatalog(false);
    await provision();
    const owner = await signIn('owner@hub.test');
    const refused = await lookup(owner, '6291000000013');
    expect(refused.statusCode).toBe(403);
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { feature: 'BARCODE' },
    });
    const menu = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/menu`, headers: owner })
    ).json<PublishedMenu>();
    expect(menu.categories.flatMap((c) => c.products).every((p) => p.barcodes.length === 0)).toBe(
      true,
    );
  });

  it('follows a code moved to another variant in the cloud', async () => {
    withRetailCatalog(true);
    await provision();
    // The cloud deleted the code of S and gave it to M (a new row with the same code).
    fixture.tables.productBarcodes = fixture.tables.productBarcodes
      .filter((b) => b.variantId !== teeS && b.variantId !== teeM)
      .concat({
        id: newId(),
        tenantId: fixture.ids.tenantId,
        productId: tee,
        variantId: teeM,
        code: '6291234000018',
        symbology: 'EAN13',
        isPrimary: true,
      });
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    expect(await hub.snapshots.syncNow()).toBe('applied');
    const owner = await signIn('owner@hub.test');
    expect((await lookup(owner, '6291234000018')).json<CatalogLookup>()).toMatchObject({
      variantId: teeM,
    });
    expect((await lookup(owner, '6291234000025')).statusCode).toBe(404);
  });
});

describe('branding offline (ADR 0019)', () => {
  /** A real 1×1 PNG, and the snapshot rows that show it as the tenant's logo on the KDS. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQTX4NAAIkAXSaGkHUAAAAAElFTkSuQmCC',
    'base64',
  );
  const logoId = newId();

  function withBranding(sha256 = createHash('sha256').update(PNG).digest('hex')) {
    const { tenantId } = fixture.ids;
    fixture.tables.tenantFiles = [
      {
        id: logoId,
        tenantId,
        kind: 'LOGO',
        storageKey: `tenants/${tenantId}/logo/${logoId}.png`,
        contentType: 'image/png',
        sizeBytes: PNG.length,
        sha256,
        createdAt: new Date().toISOString(),
      },
    ];
    fixture.tables.tenantBranding = [
      {
        tenantId,
        displayNameEn: 'Hub Bistro',
        primaryColor: '#2563eb',
        themeMode: 'LIGHT',
        surfaces: { kds: { themeMode: 'DARK', logoFileId: logoId }, login: { logoFileId: logoId } },
        updatedAt: new Date().toISOString(),
      },
    ];
    cloud.snapshot = withVersion(fixture.ids, fixture.tables, [
      { id: logoId, content: PNG.toString('base64') },
    ]);
  }

  it('serves the tenant’s branding and logo from its snapshot, without the cloud', async () => {
    withBranding();
    await provision();
    await cloud.stop();
    const owner = await signIn('owner@hub.test');
    const context = (
      await hub.app.inject({
        method: 'GET',
        url: `${api}/tenants/${fixture.ids.tenantId}/context?surface=kds`,
        headers: owner,
      })
    ).json<TenantContextDto>();
    expect(context.branding).toMatchObject({
      displayNameEn: 'Hub Bistro',
      primaryColor: '#2563eb',
      themeMode: 'DARK',
      logoFileId: logoId,
    });
    const logo = await hub.app.inject({
      method: 'GET',
      url: `${api}/tenants/${fixture.ids.tenantId}/files/${logoId}/content`,
      headers: owner,
    });
    expect(logo.statusCode).toBe(200);
    expect(logo.rawPayload.equals(PNG)).toBe(true);

    // The sign-in screens, before anybody signs in.
    const login = await hub.app.inject({ method: 'GET', url: `${api}/hub/branding` });
    expect(login.json<ResolvedBranding>()).toMatchObject({
      surface: 'login',
      displayNameEn: 'Hub Bistro',
      logoFileId: logoId,
    });
    const publicLogo = await hub.app.inject({
      method: 'GET',
      url: `${api}/hub/branding/files/${logoId}`,
    });
    expect(publicLogo.rawPayload.equals(PNG)).toBe(true);
    expect(
      (await hub.app.inject({ method: 'GET', url: `${api}/hub/branding/files/${newId()}` }))
        .statusCode,
    ).toBe(404);
    await cloud.start();
  });

  it('refuses a snapshot whose file does not match its checksum', async () => {
    withBranding('0'.repeat(64));
    await pair(hub, cloud);
    expect(await hub.snapshots.syncNow()).toBe('rejected');
    const status = (
      await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })
    ).json<HubStatus>();
    expect(status.lastError).toMatch(/checksum/);
  });

  it('has no branding to show before its first snapshot', async () => {
    const res = await hub.app.inject({ method: 'GET', url: `${api}/hub/branding` });
    expect(res.statusCode).toBe(503);
  });
});

describe('currency and languages offline (ADR 0020)', () => {
  /** The tenant row of the snapshot carries its currency display and languages. */
  function withLocalization() {
    Object.assign(fixture.tables.tenants[0]!, {
      currencyCode: 'JOD',
      currencySymbol: 'JD',
      currencyDisplay: 'symbol',
      currencyFormatLocale: 'ar-JO',
      defaultLocale: 'ar',
      supportedLocales: ['ar'],
      digits: 'arab',
    });
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  }

  it("serves the tenant's currency display and languages from its snapshot, without the cloud", async () => {
    withLocalization();
    await provision();
    await cloud.stop();
    expect(await hub.snapshots.syncNow()).toBe('offline');
    const owner = await signIn('owner@hub.test');
    const context = (
      await hub.app.inject({
        method: 'GET',
        url: `${api}/tenants/${fixture.ids.tenantId}/context?surface=pos`,
        headers: owner,
      })
    ).json<TenantContextDto>();
    expect(context.currency).toEqual({
      code: 'JOD',
      decimalPlaces: 3,
      symbol: 'JD',
      display: 'symbol',
      formatLocale: 'ar-JO',
      sources: { symbol: 'TENANT', display: 'TENANT', formatLocale: 'TENANT' },
    });
    expect(context.locales).toEqual({
      default: 'ar',
      supported: ['ar'],
      digits: 'arab',
      sources: { digits: 'TENANT' },
    });

    // The sign-in screens, before anybody signs in: one language, so no switcher.
    const locales = await hub.app.inject({ method: 'GET', url: `${api}/hub/locales` });
    expect(locales.statusCode).toBe(200);
    expect(locales.json<ResolvedLocales>()).toMatchObject({ default: 'ar', supported: ['ar'] });
    await cloud.start();
  });

  it('follows the cloud when the tenant changes its languages', async () => {
    await provision();
    const before = await hub.app.inject({ method: 'GET', url: `${api}/hub/locales` });
    expect(before.json<ResolvedLocales>()).toMatchObject({
      default: 'en',
      supported: ['en', 'ar'],
      digits: 'latn',
    });
    withLocalization();
    expect(await hub.snapshots.syncNow()).toBe('applied');
    const after = await hub.app.inject({ method: 'GET', url: `${api}/hub/locales` });
    expect(after.json<ResolvedLocales>()).toMatchObject({ supported: ['ar'], digits: 'arab' });
  });

  it('has no languages to show before its first snapshot', async () => {
    const res = await hub.app.inject({ method: 'GET', url: `${api}/hub/locales` });
    expect(res.statusCode).toBe(503);
  });
});
