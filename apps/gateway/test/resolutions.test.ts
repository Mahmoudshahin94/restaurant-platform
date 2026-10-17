import { newId } from '@pos/domain';
import { PrismaService } from '@pos/server';
import type { Order, Shift, SyncOrder, TokenResponse } from '@pos/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asHubTx } from '../src/database/hub-database';
import { FakeCloud, type TestHub, bearer, pair, removeDir, startHub } from './harness';
import { PASSWORD, buildSnapshot, withVersion } from './snapshot-fixture';

/**
 * Decisions an administrator made in the cloud about changes it refused (ADR 0014), as the hub
 * receives them on the change feed (`RESOLUTION` topic).
 */
let cloud: FakeCloud;
let hub: TestHub;
let fixture: Awaited<ReturnType<typeof buildSnapshot>>;
let cashier: Record<string, string>;

beforeEach(async () => {
  fixture = await buildSnapshot();
  cloud = new FakeCloud();
  cloud.snapshot = withVersion(fixture.ids, fixture.tables);
  await cloud.start();
  hub = await startHub();
  await pair(hub, cloud);
  expect(await hub.snapshots.syncNow()).toBe('applied');
  await hub.engine.syncNow(); // takes the head of the feed
  const res = await hub.app.inject({
    method: 'POST',
    url: `${api}/auth/login`,
    payload: { email: 'cashier@hub.test', password: PASSWORD, client: 'native' },
  });
  cashier = { ...bearer(res.json<TokenResponse>().accessToken), 'x-client-source': 'POS' };
});
afterEach(async () => {
  await hub.close();
  await cloud.stop();
  removeDir(hub.dataDir);
});

const api = '/api/v1';
const loc = () => `${api}/locations/${fixture.ids.locationId}`;
const db = () => asHubTx(hub.app.get(PrismaService));

async function placeOrder(): Promise<Order> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `${loc()}/orders`,
    headers: cashier,
    payload: {
      id: newId(),
      channel: 'TAKEAWAY',
      status: 'CONFIRMED',
      notes: 'Taken at the till',
      items: [{ id: newId(), productId: fixture.ids.cola, quantity: 1 }],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Order>();
}

async function payCash(order: Order): Promise<void> {
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
      tendered: order.total,
    },
  });
  expect(paid.statusCode).toBe(200);
}

/** The cloud refuses every change of `orderId` as a conflict, so it fails on the hub. */
async function refuseOrder(orderId: string): Promise<string> {
  cloud.answer = (op) =>
    op.entityId === orderId
      ? { status: 'CONFLICT', code: 'SYNC_CONFLICT', message: 'Changed in the cloud' }
      : null;
  await hub.engine.pushNow();
  const failed = await db().syncOperation.findFirstOrThrow({
    where: { entityId: orderId, status: 'FAILED' },
  });
  cloud.answer = () => null;
  return failed.operationId;
}

/** The cloud's copy of the order: what the hub pushed, as changed in the cloud since. */
function cloudCopy(orderId: string, changes: Partial<SyncOrder>): SyncOrder {
  const sent = cloud.pushed.filter((o) => o.entityId === orderId).at(-1);
  const payload = sent?.payload as SyncOrder;
  return { ...payload, payments: [], paymentStatus: 'UNPAID', ...changes };
}

describe('resolutions from the cloud', () => {
  it('sends a refused change again when asked (the cloud applied it or fixed the cause)', async () => {
    const order = await placeOrder();
    const operationId = await refuseOrder(order.id);
    const before = cloud.pushes.length;

    cloud.publishResolution({
      operationId,
      entityType: 'Order',
      entityId: order.id,
      action: 'RESEND',
      order: null,
    });
    await hub.engine.syncNow();

    const op = await db().syncOperation.findFirstOrThrow({ where: { operationId } });
    expect(op).toMatchObject({ status: 'COMPLETED', errorCode: null });
    expect(cloud.pushes.length).toBeGreaterThan(before);
    expect(cloud.pushed.at(-1)?.operationId).toBe(operationId);
  });

  it('takes the cloud’s version and marks its own change superseded', async () => {
    const order = await placeOrder();
    const operationId = await refuseOrder(order.id);
    const kept = cloudCopy(order.id, { notes: 'Kept in the cloud', version: 5 });
    const pushesBefore = cloud.pushes.length;

    cloud.publishResolution({
      operationId,
      entityType: 'Order',
      entityId: order.id,
      action: 'ADOPT_CLOUD',
      order: kept,
    });
    await hub.engine.syncNow();

    const local = await db().order.findUniqueOrThrow({ where: { id: order.id } });
    expect(local).toMatchObject({ notes: 'Kept in the cloud', version: 5 });
    expect(await db().syncOperation.findFirstOrThrow({ where: { operationId } })).toMatchObject({
      status: 'COMPLETED',
      errorCode: 'SYNC_SUPERSEDED',
    });
    expect(await db().inboundOrder.findUnique({ where: { orderId: order.id } })).toMatchObject({
      cloudVersion: 5,
    });
    // Nothing left to send for it.
    expect(cloud.pushes.length).toBe(pushesBefore);

    // The next change made here builds on the cloud's version and says so.
    const current = (
      await hub.app.inject({ method: 'GET', url: `${loc()}/orders/${order.id}`, headers: cashier })
    ).json<Order>();
    const edit = await hub.app.inject({
      method: 'PUT',
      url: `${loc()}/orders/${order.id}`,
      headers: cashier,
      payload: {
        version: current.version,
        channel: current.channel,
        notes: 'After adopting',
        items: current.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          variantId: i.variantId,
          modifierIds: i.modifiers.map((m) => m.modifierId),
          quantity: i.quantity,
          notes: i.notes,
        })),
        discountIds: [],
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    await hub.engine.pushNow();
    expect(cloud.pushed.at(-1)).toMatchObject({
      entityId: order.id,
      baseVersion: 5,
      payload: { notes: 'After adopting', version: 6 },
    });
  });

  it('keeps money taken at the till when adopting, and sends it on the cloud’s version', async () => {
    const order = await placeOrder();
    const operationId = await refuseOrder(order.id);
    await payCash(order); // a payment the cloud's copy has never seen
    const kept = cloudCopy(order.id, { notes: 'Kept in the cloud', version: 5 });

    cloud.publishResolution({
      operationId,
      entityType: 'Order',
      entityId: order.id,
      action: 'ADOPT_CLOUD',
      order: kept,
    });
    await hub.engine.syncNow();

    const local = await db().order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(local).toMatchObject({ notes: 'Kept in the cloud', paymentStatus: 'PAID' });
    expect(local.payments).toHaveLength(1);
    const resent = cloud.pushed.filter((o) => o.entityId === order.id).at(-1);
    expect(resent).toMatchObject({ baseVersion: 5, payload: { paymentStatus: 'PAID' } });
    expect((resent?.payload as SyncOrder).payments).toHaveLength(1);
  });

  it('ignores decisions the cloud does not serve to this hub', async () => {
    cloud.addChange('RESOLUTION', newId());
    await hub.engine.syncNow();
    expect(await hub.state.get('cursor')).toBe(String(cloud.changes.length));
  });
});
