import { newId } from '@pos/domain';
import { PrismaService, RealtimeBus } from '@pos/server';
import type { RealtimeEvent } from '@pos/shared-types';
import type {
  HubStatus,
  HubSyncOperation,
  Order,
  PublishedMenu,
  Shift,
  TokenResponse,
} from '@pos/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asHubTx } from '../src/database/hub-database';
import { FakeCloud, type TestHub, bearer, pair, removeDir, startHub } from './harness';
import { CASHIER_PIN, PASSWORD, buildSnapshot, withVersion } from './snapshot-fixture';

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

async function placeOrder(headers: Record<string, string>): Promise<Order> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${loc()}/orders`,
    headers,
    payload: {
      id: newId(),
      channel: 'TAKEAWAY',
      status: 'CONFIRMED',
      items: [{ id: newId(), productId: fixture.ids.cola, quantity: 1 }],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Order>();
}

async function editNotes(headers: Record<string, string>, order: Order, notes: string) {
  const current = (
    await hub.app.inject({ method: 'GET', url: `${loc()}/orders/${order.id}`, headers })
  ).json<Order>();
  const res = await hub.app.inject({
    method: 'PUT',
    url: `${loc()}/orders/${order.id}`,
    headers,
    payload: {
      version: current.version,
      channel: current.channel,
      notes,
      items: current.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
        modifierIds: i.modifiers.map((m) => m.modifierId),
      })),
    },
  });
  expect(res.statusCode).toBe(200);
}

async function status(): Promise<HubStatus> {
  return (await hub.app.inject({ method: 'GET', url: `${api}/hub/status` })).json<HubStatus>();
}

const types = (ops: { entityType: string }[]) => ops.map((o) => o.entityType);

describe('pushing the outbox', () => {
  it('sends orders taken offline once the cloud is back, exactly once', async () => {
    const cashier = await signIn('cashier@hub.test');
    await cloud.stop();
    const first = await placeOrder(cashier);
    const second = await placeOrder(cashier);

    // Offline: nothing leaves, the operations wait, and the POS is told.
    expect(await hub.engine.pushNow()).toMatchObject({ completed: 0 });
    expect(await status()).toMatchObject({ state: 'OFFLINE', cloud: 'OFFLINE' });
    expect((await status()).pendingOperations).toBeGreaterThanOrEqual(2);
    expect((await status()).nextAttemptAt).not.toBeNull();
    expect(events.map((e) => e.type)).toContain('sync.status_changed');

    await cloud.start();
    await pair(hub, cloud);
    hub.state.invalidate();
    await hub.engine.syncNow();
    const sent = cloud.pushed.filter((o) => o.entityType === 'Order').map((o) => o.entityId);
    expect(sent.sort()).toEqual([first.id, second.id].sort());
    expect(await status()).toMatchObject({
      state: 'ONLINE',
      cloud: 'ONLINE',
      pendingOperations: 0,
      failedOperations: 0,
    });
    expect((await status()).syncedOperations).toBeGreaterThan(0);
    expect(events.map((e) => e.type)).toContain('sync.completed');

    // Nothing is sent twice.
    const pushes = cloud.pushes.length;
    await hub.engine.syncNow();
    expect(cloud.pushes.length).toBe(pushes);
    expect(await db().syncOperation.count({ where: { status: { not: 'COMPLETED' } } })).toBe(0);
  });

  it('coalesces an order edited several times into one upload of its newest state', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier);
    await editNotes(cashier, order, 'no ice');
    await editNotes(cashier, order, 'no ice, extra lemon');
    const ops = await db().syncOperation.findMany({ where: { entityId: order.id } });
    expect(ops).toHaveLength(3);

    await hub.engine.pushNow();
    const sent = cloud.pushed.filter((o) => o.entityId === order.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ entityVersion: 3, payload: { notes: 'no ice, extra lemon' } });
    expect(
      await db().syncOperation.count({ where: { entityId: order.id, status: 'COMPLETED' } }),
    ).toBe(3);
  });

  it('sends a shift before the orders paid in it, and orders before their kitchen tickets', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier);
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
        tendered: order.total,
      },
    });
    expect(paid.statusCode).toBe(200);
    // The order with a burger also gets kitchen tickets.
    const withTickets = await hub.app.inject({
      method: 'POST',
      url: `${loc()}/orders`,
      headers: cashier,
      payload: {
        id: newId(),
        channel: 'TAKEAWAY',
        status: 'CONFIRMED',
        items: [
          {
            id: newId(),
            productId: fixture.ids.burger,
            quantity: 1,
            modifierIds: [fixture.ids.medium],
          },
        ],
      },
    });
    expect(withTickets.statusCode).toBe(201);

    await hub.engine.pushNow();
    const order1 = cloud.pushed.findIndex((o) => o.entityId === order.id);
    const shiftAt = cloud.pushed.findIndex((o) => o.entityId === shift.id);
    expect(shiftAt).toBeLessThan(order1);
    const ticketAt = cloud.pushed.findIndex((o) => o.entityType === 'KitchenTicket');
    const ticketOrderAt = cloud.pushed.findIndex(
      (o) => o.entityId === withTickets.json<Order>().id,
    );
    expect(ticketOrderAt).toBeLessThan(ticketAt);
    // The payment carries its cash movement.
    const pushedOrder = cloud.pushed[order1]?.payload as {
      payments: { cash: { type: string }[] }[];
    };
    expect(pushedOrder.payments[0]?.cash.map((c) => c.type)).toEqual(['SALE']);
    expect(types(cloud.pushed).sort()).toEqual(['KitchenTicket', 'Order', 'Order', 'Shift']);
  });

  it('keeps a refused operation as FAILED, holds back only its entity, and retries on request', async () => {
    const cashier = await signIn('cashier@hub.test');
    const refused = await placeOrder(cashier);
    const fine = await placeOrder(cashier);
    cloud.answer = (op) =>
      op.entityId === refused.id
        ? { status: 'CONFLICT', code: 'SYNC_CONFLICT', message: 'changed in the cloud' }
        : null;

    await hub.engine.pushNow();
    expect(await status()).toMatchObject({ state: 'SYNC_ERROR', failedOperations: 1 });
    expect(events.find((e) => e.type === 'sync.failed')?.payload).toMatchObject({ failed: 1 });

    // A later change to the refused order stays behind it; other orders keep flowing.
    await editNotes(cashier, refused, 'later change');
    await editNotes(cashier, fine, 'also later');
    const before = cloud.pushed.length;
    await hub.engine.pushNow();
    expect(cloud.pushed.slice(before).map((o) => o.entityId)).toEqual([fine.id]);

    const failed = (
      await hub.app.inject({
        method: 'GET',
        url: `${api}/hub/sync/operations?status=FAILED`,
        headers: cashier,
      })
    ).json<{ items: HubSyncOperation[] }>().items;
    expect(failed).toEqual([
      expect.objectContaining({
        entityId: refused.id,
        label: refused.orderNumber,
        errorCode: 'SYNC_CONFLICT',
        errorMessage: 'changed in the cloud',
      }),
    ]);

    // Retrying needs sync.view (a manager), not just orders.view.
    const denied = await hub.app.inject({
      method: 'POST',
      url: `${api}/hub/sync/operations/${failed[0]?.id ?? ''}/retry`,
      headers: cashier,
    });
    expect(denied.statusCode).toBe(403);

    cloud.answer = () => null;
    const manager = await signIn('owner@hub.test');
    const retried = await hub.app.inject({
      method: 'POST',
      url: `${api}/hub/sync/operations/${failed[0]?.id ?? ''}/retry`,
      headers: manager,
    });
    expect(retried.statusCode).toBe(200);
    await hub.engine.pushNow();
    // The newest state of the refused order went, covering the failed operation.
    const last = cloud.pushed.at(-1);
    expect(last).toMatchObject({ entityId: refused.id, payload: { notes: 'later change' } });
    expect(await status()).toMatchObject({ state: 'ONLINE', failedOperations: 0 });

    const missing = await hub.app.inject({
      method: 'POST',
      url: `${api}/hub/sync/operations/${newId()}/retry`,
      headers: manager,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('waits and retries when the cloud asks to, and gives up after repeated RETRY answers', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier);
    cloud.answer = () => ({ status: 'RETRY', code: 'SYNC_DEPENDENCY_MISSING', message: 'later' });
    await hub.engine.pushNow();
    const op = await db().syncOperation.findFirstOrThrow({ where: { entityId: order.id } });
    expect(op).toMatchObject({ status: 'PENDING', retryCount: 1 });
    expect(op.nextRetryAt?.getTime()).toBeGreaterThan(Date.now());

    // Each "Sync now" clears the wait; after ten RETRY answers the operation is FAILED.
    for (let i = 0; i < 9; i += 1) await hub.engine.syncNow();
    expect(
      await db().syncOperation.findFirstOrThrow({ where: { entityId: order.id } }),
    ).toMatchObject({ status: 'FAILED', retryCount: 10, errorCode: 'SYNC_DEPENDENCY_MISSING' });
  });

  it('treats HTTP 500 as the cloud being away, and a refused credential as a sync error', async () => {
    const cashier = await signIn('cashier@hub.test');
    await placeOrder(cashier);
    cloud.mode = 'error';
    await hub.engine.pushNow();
    expect(await status()).toMatchObject({ state: 'OFFLINE' });
    expect(await db().syncOperation.count({ where: { status: 'PENDING' } })).toBeGreaterThan(0);
    expect(await db().syncOperation.count({ where: { status: 'PROCESSING' } })).toBe(0);

    cloud.mode = 'reject';
    await hub.engine.syncNow();
    expect(await status()).toMatchObject({ state: 'SYNC_ERROR' });
    expect((await status()).lastError).toContain('re-pair');

    cloud.mode = 'up';
    await hub.engine.syncNow();
    expect(await status()).toMatchObject({ state: 'ONLINE', pendingOperations: 0 });
  });

  it('resends operations a crash left in flight; the cloud answers DUPLICATE', async () => {
    const cashier = await signIn('cashier@hub.test');
    const order = await placeOrder(cashier);
    await hub.engine.pushNow();
    // Simulate a crash after the cloud applied it but before the hub recorded the answer.
    await db().syncOperation.updateMany({
      where: { entityId: order.id },
      data: { status: 'PROCESSING' },
    });
    const dataDir = hub.dataDir;
    await hub.close();
    hub = await startHub(dataDir);
    expect(await db().syncOperation.count({ where: { status: 'PROCESSING' } })).toBe(0);
    await hub.engine.pushNow();
    expect(await db().syncOperation.count({ where: { status: 'COMPLETED' } })).toBeGreaterThan(0);
    expect(cloud.pushed.filter((o) => o.entityId === order.id)).toHaveLength(2);
    expect(await status()).toMatchObject({ pendingOperations: 0, failedOperations: 0 });
  });
});

describe('following the change feed', () => {
  it('starts at the head, then refreshes its configuration when the cloud reports a change', async () => {
    cloud.addChange();
    cloud.addChange();
    await hub.engine.syncNow();
    expect(await hub.state.get('cursor')).toBe('2');

    const fries = fixture.tables.products.find((p) => p.id === fixture.ids.fries);
    if (fries) fries.price = 1250;
    cloud.snapshot = withVersion(fixture.ids, fixture.tables);
    cloud.addChange();
    await hub.engine.syncNow();
    expect(await hub.state.get('cursor')).toBe('3');
    expect(events.map((e) => e.type)).toContain('menu.updated');

    const owner = await signIn('owner@hub.test');
    const menu = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/menu`, headers: owner })
    ).json<PublishedMenu>();
    const price = menu.categories.flatMap((c) => c.products).find((p) => p.nameEn === 'Fries');
    expect(price?.price).toBe(1250);
  });

  it('keeps its cursor when the snapshot cannot be fetched, so the change is not lost', async () => {
    await hub.engine.syncNow();
    expect(await hub.state.get('cursor')).toBe('0');
    cloud.addChange();
    const snapshot = cloud.snapshot;
    cloud.snapshot = null;
    cloud.mode = 'up';
    // The feed answers but the snapshot request fails (no snapshot → invalid body).
    await hub.engine.syncNow();
    expect(await hub.state.get('cursor')).toBe('0');
    cloud.snapshot = snapshot;
    await hub.engine.syncNow();
    expect(await hub.state.get('cursor')).toBe('1');
  });

  it('runs on its own when enabled: an order placed offline reaches the cloud after reconnecting', async () => {
    const dataDir = hub.dataDir;
    await hub.close();
    hub = await startHub(dataDir, { HUB_SYNC_ENABLED: 'true' });
    const pin = await hub.app.inject({
      method: 'POST',
      url: `${api}/auth/pin`,
      payload: { employeeCode: '1001', pin: CASHIER_PIN },
    });
    const cashier = bearer(pin.json<TokenResponse>().accessToken);
    await cloud.stop();
    const order = await placeOrder(cashier);
    await expect.poll(async () => (await status()).state, { timeout: 5000 }).toBe('OFFLINE');

    await cloud.start();
    await pair(hub, cloud);
    await expect
      .poll(() => cloud.pushed.some((o) => o.entityId === order.id), { timeout: 10_000 })
      .toBe(true);
    await expect.poll(async () => (await status()).state, { timeout: 5000 }).toBe('ONLINE');
  });
});
