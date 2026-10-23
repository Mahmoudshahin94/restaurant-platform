import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type { ApiErrorBody, Permission, RealtimeEvent } from '@pos/shared-types';
import type { KitchenSettings, KitchenTicket, Order } from '@pos/validation';
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
let fryer: { id: string };
let fries: { id: string };
let loadedFries: { id: string };
let cashier: Record<string, string>;
let kitchen: Record<string, string>;
let kitchenToken: string;

const CASHIER: Permission[] = [
  'orders.view',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'locations.view',
  'products.view',
];

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma, CASHIER);
  menu = await createMenuFixture(prisma, tenant);
  const { tenantId } = tenant;
  const category = await prisma.category.findFirstOrThrow({ where: { tenantId } });
  fryer = await prisma.kitchenStation.create({
    data: { tenantId, code: 'FRYER', nameEn: 'Fryer', nameAr: 'المقلاة', sortOrder: 2 },
  });
  fries = await prisma.product.create({
    data: {
      tenantId,
      categoryId: category.id,
      nameEn: 'Fries',
      nameAr: 'بطاطس',
      price: 900,
      stations: { create: [{ kitchenStationId: fryer.id }] },
    },
  });
  // Assembled on the grill, fried at the fryer: one line, two stations.
  loadedFries = await prisma.product.create({
    data: {
      tenantId,
      categoryId: category.id,
      nameEn: 'Loaded fries',
      nameAr: 'بطاطس محملة',
      price: 1500,
      stations: {
        create: [{ kitchenStationId: fryer.id }, { kitchenStationId: menu.grill.id }],
      },
    },
  });
  cashier = bearer(await login(app, tenant.cashier.email));
  const kitchenEmail = await createKitchenUser();
  kitchenToken = await login(app, kitchenEmail);
  kitchen = { ...bearer(kitchenToken), 'x-client-source': 'KDS' };
});

async function createKitchenUser(): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: tenant.cashier.id } });
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.tenantId,
      name: 'Kitchen',
      permissions: {
        create: (['kitchen.view', 'kitchen.update'] as const).map((permissionKey) => ({
          permissionKey,
        })),
      },
    },
  });
  const email = `kitchen-${newId()}@test.local`;
  await prisma.user.create({
    data: {
      tenantId: tenant.tenantId,
      email,
      passwordHash: user.passwordHash,
      displayName: 'Kitchen',
      roles: { create: { roleId: role.id, locationId: tenant.locationA } },
    },
  });
  return email;
}

const loc = () => `/api/v1/locations/${tenant.locationA}`;
const line = (productId: string, quantity = 1, notes: string | null = null) => ({
  id: newId(),
  productId,
  quantity,
  notes,
});

async function createOrder(
  items: Record<string, unknown>[],
  status: 'PLACED' | 'CONFIRMED' = 'CONFIRMED',
): Promise<Order> {
  const res = await app.inject({
    method: 'POST',
    url: `${loc()}/orders`,
    headers: cashier,
    payload: { id: newId(), channel: 'TAKEAWAY', status, items },
  });
  if (res.statusCode !== 201) throw new Error(`order ${res.statusCode} ${res.body}`);
  return res.json<Order>();
}

const getOrder = async (id: string) =>
  (
    await app.inject({ method: 'GET', url: `${loc()}/orders/${id}`, headers: cashier })
  ).json<Order>();

async function tickets(query = ''): Promise<KitchenTicket[]> {
  const res = await app.inject({
    method: 'GET',
    url: `${loc()}/kitchen/tickets${query}`,
    headers: kitchen,
  });
  expect(res.statusCode).toBe(200);
  return res.json<KitchenTicket[]>();
}

const ticketOf = async (order: Order, stationId: string) => {
  const found = (await tickets()).find((t) => t.orderId === order.id && t.stationId === stationId);
  if (!found) throw new Error('ticket not found');
  return found;
};

const move = (ticket: KitchenTicket, to: string, headers = kitchen) =>
  app.inject({
    method: 'POST',
    url: `${loc()}/kitchen/tickets/${ticket.id}/transitions`,
    headers,
    payload: { to, version: ticket.version },
  });

const transitionOrder = (order: Order, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `${loc()}/orders/${order.id}/transitions`,
    headers: cashier,
    payload,
  });

describe('routing orders to stations', () => {
  it('sends a confirmed order to every station its items belong to, once per station', async () => {
    const order = await createOrder([
      menu.burgerLine(2),
      line(fries.id, 1, 'Extra salt'),
      line(loadedFries.id),
      menu.colaLine(),
    ]);

    const all = (await tickets()).filter((t) => t.orderId === order.id);
    expect(all.map((t) => t.stationCode).sort()).toEqual(['FRYER', 'GRILL']);
    const grill = all.find((t) => t.stationCode === 'GRILL')!;
    const fryerTicket = all.find((t) => t.stationCode === 'FRYER')!;
    expect(grill).toMatchObject({
      status: 'NEW',
      priority: 'NORMAL',
      orderNumber: order.orderNumber,
      channel: 'TAKEAWAY',
      revision: 1,
    });
    expect(grill.items.map((i) => [i.nameEn, i.quantity])).toEqual([
      ['Burger', 2],
      ['Loaded fries', 1],
    ]);
    expect(grill.items[0]!.modifiers.map((m) => m.nameEn)).toEqual(['Medium', 'Cheese']);
    expect(fryerTicket.items.map((i) => [i.nameEn, i.notes])).toEqual([
      ['Fries', 'Extra salt'],
      ['Loaded fries', null],
    ]);
    // Cola has no station: nothing to prepare, so it is not on any screen.
    expect(all.flatMap((t) => t.items).some((i) => i.nameEn === 'Cola')).toBe(false);
    expect((await getOrder(order.id)).tickets.map((t) => t.status)).toEqual(['NEW', 'NEW']);
  });

  it('waits for acceptance: placed orders reach the kitchen when confirmed', async () => {
    const order = await createOrder([menu.burgerLine()], 'PLACED');
    expect((await tickets()).filter((t) => t.orderId === order.id)).toHaveLength(0);
    await transitionOrder(order, { to: 'CONFIRMED' });
    expect((await tickets()).filter((t) => t.orderId === order.id)).toHaveLength(1);
  });

  it('filters by station and scopes to the location and kitchen permissions', async () => {
    await createOrder([menu.burgerLine(), line(fries.id)]);
    const fryerOnly = await tickets(`?stationIds=${fryer.id}`);
    expect(fryerOnly.map((t) => t.stationCode)).toEqual(['FRYER']);

    const settings = await app.inject({
      method: 'GET',
      url: `${loc()}/kitchen/settings`,
      headers: kitchen,
    });
    expect(settings.json<KitchenSettings>()).toMatchObject({ warnMinutes: 8, lateMinutes: 15 });
    expect(settings.json<KitchenSettings>().stations.map((s) => s.code)).toEqual([
      'GRILL',
      'FRYER',
    ]);

    // The cashier has no kitchen permission; the kitchen user has no access to location B.
    const denied = await app.inject({
      method: 'GET',
      url: `${loc()}/kitchen/tickets`,
      headers: cashier,
    });
    expect(denied.statusCode).toBe(403);
    const otherLocation = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationB}/kitchen/tickets`,
      headers: kitchen,
    });
    expect(otherLocation.statusCode).toBe(404);
  });
});

describe('kitchen progress drives the order', () => {
  it('moves the order to PREPARING and READY as stations work, recording the KDS as source', async () => {
    const order = await createOrder([menu.burgerLine(), line(fries.id)]);
    const grill = await ticketOf(order, menu.grill.id);
    const fryerTicket = await ticketOf(order, fryer.id);

    const started = await move(grill, 'PREPARING');
    expect(started.json<KitchenTicket>()).toMatchObject({ status: 'PREPARING', version: 2 });
    expect(started.json<KitchenTicket>().startedAt).not.toBeNull();
    expect((await getOrder(order.id)).status).toBe('PREPARING');

    await move(started.json<KitchenTicket>(), 'READY');
    expect((await getOrder(order.id)).status).toBe('PREPARING');
    // A quick station can go straight to ready.
    await move(fryerTicket, 'READY');
    const ready = await getOrder(order.id);
    expect(ready.status).toBe('READY');
    expect(ready.statusHistory.slice(-2)).toMatchObject([
      { fromStatus: 'CONFIRMED', toStatus: 'PREPARING', source: 'KDS' },
      { fromStatus: 'PREPARING', toStatus: 'READY', source: 'KDS' },
    ]);

    // Undoing a "ready" takes the order back to PREPARING.
    const fryerReady = await ticketOf(order, fryer.id);
    await move(fryerReady, 'PREPARING');
    expect((await getOrder(order.id)).status).toBe('PREPARING');
  });

  it('rejects skipped steps, stale screens and staff edits of kitchen statuses', async () => {
    const order = await createOrder([menu.burgerLine()]);
    const grill = await ticketOf(order, menu.grill.id);
    const skip = await move(grill, 'COMPLETED');
    expect(skip.statusCode).toBe(409);
    expect(skip.json<ApiErrorBody>()).toMatchObject({
      code: 'INVALID_TICKET_STATE',
      details: { reason: 'NOT_ALLOWED' },
    });

    await move(grill, 'PREPARING');
    const stale = await move(grill, 'READY');
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ApiErrorBody>().details).toMatchObject({ reason: 'STALE_VERSION' });

    const manual = await transitionOrder(order, { to: 'READY' });
    expect(manual.json<ApiErrorBody>().details).toMatchObject({ reason: 'SYSTEM_ONLY' });
    const cashierMove = await move(await ticketOf(order, menu.grill.id), 'READY', cashier);
    expect(cashierMove.statusCode).toBe(403);
  });

  it('moves the order to READY exactly once when two stations finish at the same moment', async () => {
    const order = await createOrder([menu.burgerLine(), line(fries.id)]);
    const [a, b] = await Promise.all([ticketOf(order, menu.grill.id), ticketOf(order, fryer.id)]);
    const results = await Promise.all([move(a, 'READY'), move(b, 'READY')]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    const after = await getOrder(order.id);
    expect(after.status).toBe('READY');
    expect(after.statusHistory.filter((h) => h.toStatus === 'READY')).toHaveLength(1);
    expect(after.statusHistory.filter((h) => h.toStatus === 'PREPARING')).toHaveLength(1);
  });

  it('clears ready tickets on handover and lets the kitchen recall a bumped ticket', async () => {
    const order = await createOrder([menu.burgerLine()]);
    await move(await ticketOf(order, menu.grill.id), 'READY');
    const unpaid = await transitionOrder(order, { to: 'COMPLETED' });
    // Completion still needs payment (covered by the payments suite); settle it directly here.
    expect(unpaid.json<ApiErrorBody>().details).toMatchObject({ reason: 'UNPAID' });
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });

    expect((await transitionOrder(order, { to: 'COMPLETED' })).statusCode).toBe(200);
    expect((await tickets()).filter((t) => t.orderId === order.id)).toHaveLength(0);
    const bumped = await tickets('?view=completed');
    expect(bumped.map((t) => [t.orderId, t.status])).toEqual([[order.id, 'COMPLETED']]);

    const recalled = await move(bumped[0]!, 'READY');
    expect(recalled.json<KitchenTicket>().status).toBe('READY');
    expect((await getOrder(order.id)).status).toBe('COMPLETED');
    const restarted = await move(recalled.json<KitchenTicket>(), 'PREPARING');
    expect(restarted.json<ApiErrorBody>().details).toMatchObject({ reason: 'ORDER_CLOSED' });
  });
});

describe('orders changing after they reach the kitchen', () => {
  it('rewrites untouched tickets on edit, adds and cancels stations, and flags the change', async () => {
    const burger = menu.burgerLine();
    const order = await createOrder([burger, line(fries.id)]);
    const edit = await app.inject({
      method: 'PUT',
      url: `${loc()}/orders/${order.id}`,
      headers: cashier,
      payload: {
        version: order.version,
        channel: 'TAKEAWAY',
        items: [{ ...burger, quantity: 3 }],
      },
    });
    expect(edit.statusCode).toBe(200);

    const active = (await tickets()).filter((t) => t.orderId === order.id);
    const grill = active.find((t) => t.stationCode === 'GRILL')!;
    expect(grill).toMatchObject({ revision: 2 });
    expect(grill.items.map((i) => i.quantity)).toEqual([3]);
    // The fryer lost all its items: its ticket is cancelled and stays visible until dismissed.
    const fryerTicket = active.find((t) => t.stationCode === 'FRYER')!;
    expect(fryerTicket.status).toBe('CANCELLED');
    const dismissed = await app.inject({
      method: 'POST',
      url: `${loc()}/kitchen/tickets/${fryerTicket.id}/dismiss`,
      headers: kitchen,
      payload: { version: fryerTicket.version },
    });
    expect(dismissed.statusCode).toBe(200);
    expect((await tickets()).some((t) => t.id === fryerTicket.id)).toBe(false);

    // An edit that does not change what the cook sees does not flag the ticket again.
    const again = await app.inject({
      method: 'PUT',
      url: `${loc()}/orders/${order.id}`,
      headers: cashier,
      payload: {
        version: edit.json<Order>().version,
        channel: 'TAKEAWAY',
        customerName: 'Sara',
        items: [{ ...burger, quantity: 3 }],
      },
    });
    expect(again.statusCode).toBe(200);
    expect((await ticketOf(order, menu.grill.id)).revision).toBe(2);
  });

  it('locks the order against edits once the kitchen starts', async () => {
    const burger = menu.burgerLine();
    const order = await createOrder([burger]);
    await move(await ticketOf(order, menu.grill.id), 'PREPARING');
    const current = await getOrder(order.id);
    const edit = await app.inject({
      method: 'PUT',
      url: `${loc()}/orders/${order.id}`,
      headers: cashier,
      payload: { version: current.version, channel: 'TAKEAWAY', items: [burger, line(fries.id)] },
    });
    expect(edit.json<ApiErrorBody>().details).toMatchObject({ reason: 'NOT_MODIFIABLE' });
  });

  it('cancels every live ticket when the order is cancelled', async () => {
    const order = await createOrder([menu.burgerLine(), line(fries.id)]);
    await move(await ticketOf(order, menu.grill.id), 'PREPARING');
    const cancel = await transitionOrder(order, { to: 'CANCELLED', reason: 'Customer left' });
    expect(cancel.statusCode).toBe(200);
    const after = (await tickets()).filter((t) => t.orderId === order.id);
    expect(after.map((t) => t.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(after.every((t) => t.orderStatus === 'CANCELLED')).toBe(true);
    const work = await move(after[0]!, 'READY');
    expect(work.statusCode).toBe(409);
  });

  it('does not complete a confirmed order while the kitchen still has it', async () => {
    const order = await createOrder([menu.burgerLine()]);
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    const complete = await transitionOrder(order, { to: 'COMPLETED' });
    expect(complete.json<ApiErrorBody>().details).toMatchObject({ reason: 'KITCHEN_PENDING' });
    // Orders with nothing to prepare can still be handed over directly.
    const drinks = await createOrder([menu.colaLine()]);
    await prisma.order.update({ where: { id: drinks.id }, data: { paymentStatus: 'PAID' } });
    expect((await transitionOrder(drinks, { to: 'COMPLETED' })).statusCode).toBe(200);
  });
});

describe('kitchen screen tools', () => {
  it('rushes tickets from the kitchen or the POS and shows them first', async () => {
    const first = await createOrder([line(fries.id)]);
    const second = await createOrder([line(fries.id)]);
    const rush = await app.inject({
      method: 'POST',
      url: `${loc()}/orders/${second.id}/kitchen-priority`,
      headers: cashier,
      payload: { priority: 'RUSH' },
    });
    expect(rush.statusCode).toBe(200);
    expect((await tickets()).map((t) => t.orderId)).toEqual([second.id, first.id]);

    const ticket = await ticketOf(second, fryer.id);
    const normal = await app.inject({
      method: 'POST',
      url: `${loc()}/kitchen/tickets/${ticket.id}/priority`,
      headers: kitchen,
      payload: { priority: 'NORMAL', version: ticket.version },
    });
    expect(normal.json<KitchenTicket>().priority).toBe('NORMAL');
    expect((await tickets()).map((t) => t.orderId)).toEqual([first.id, second.id]);
  });

  it('strikes individual lines', async () => {
    const order = await createOrder([line(fries.id), line(fries.id, 2)]);
    const ticket = await ticketOf(order, fryer.id);
    const done = await app.inject({
      method: 'POST',
      url: `${loc()}/kitchen/tickets/${ticket.id}/items/${ticket.items[1]!.id}/done`,
      headers: kitchen,
      payload: { done: true },
    });
    expect(done.json<KitchenTicket>().items.map((i) => i.doneAt !== null)).toEqual([false, true]);
  });
});

describe('realtime socket', () => {
  type ServerMessage =
    | { type: 'ready'; locationId: string }
    | { type: 'event'; event: RealtimeEvent }
    | { type: 'pong' };

  /** Connects, authenticates and collects messages until the socket closes. */
  function connect(token: string, locationId: string) {
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('not listening');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/realtime`);
    const messages: ServerMessage[] = [];
    const closed = new Promise<number>((resolve) => {
      socket.addEventListener('close', (e) => {
        resolve(e.code);
      });
    });
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', token, locationId }));
    });
    socket.addEventListener('message', (e) => {
      messages.push(JSON.parse(String(e.data)) as ServerMessage);
    });
    const waitFor = async (predicate: (m: ServerMessage[]) => boolean, ms = 3000) => {
      const until = Date.now() + ms;
      while (!predicate(messages)) {
        if (Date.now() > until) throw new Error(`timeout; got ${JSON.stringify(messages)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    return { socket, messages, closed, waitFor };
  }

  const eventsOf = (messages: ServerMessage[]) =>
    messages.flatMap((m) => (m.type === 'event' ? [m.event] : []));

  it('streams order and ticket events of the location after authentication', async () => {
    const client = connect(kitchenToken, tenant.locationA);
    await client.waitFor((m) => m.some((x) => x.type === 'ready'));

    const order = await createOrder([menu.burgerLine()]);
    await client.waitFor((m) => eventsOf(m).some((e) => e.type === 'kitchen.ticket_created'));
    const ticket = await ticketOf(order, menu.grill.id);
    await move(ticket, 'READY');
    await client.waitFor((m) => eventsOf(m).some((e) => e.type === 'kitchen.ticket_ready'));
    await client.waitFor((m) =>
      eventsOf(m).some(
        (e) =>
          e.type === 'order.updated' &&
          (e as RealtimeEvent<'order.updated'>).payload.status === 'READY',
      ),
    );

    const types = eventsOf(client.messages).map((e) => e.type);
    expect(types.slice(0, 2)).toEqual(['order.created', 'kitchen.ticket_created']);
    const created = eventsOf(client.messages)[1] as RealtimeEvent<'kitchen.ticket_created'>;
    expect(created).toMatchObject({
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      payload: { orderId: order.id, orderNumber: order.orderNumber, stationId: menu.grill.id },
    });
    client.socket.close();
  });

  it('rejects bad tokens, foreign locations and malformed messages', async () => {
    expect(await connect('not-a-token', tenant.locationA).closed).toBe(4401);
    expect(await connect(kitchenToken, tenant.locationB).closed).toBe(4403);

    const other = await createTenant(prisma);
    const outsider = await login(app, other.owner.email);
    expect(await connect(outsider, tenant.locationA).closed).toBe(4403);

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('not listening');
    const raw = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/realtime`);
    const code = new Promise<number>((resolve) => {
      raw.addEventListener('close', (e) => {
        resolve(e.code);
      });
    });
    raw.addEventListener('open', () => {
      raw.send('{"type":"auth","token":5}');
    });
    expect(await code).toBe(4400);
  });

  it('does not leak events between locations', async () => {
    const owner = await login(app, tenant.owner.email);
    const otherLocation = connect(owner, tenant.locationB);
    await otherLocation.waitFor((m) => m.some((x) => x.type === 'ready'));
    await createOrder([menu.burgerLine()]);
    const here = connect(owner, tenant.locationA);
    await here.waitFor((m) => m.some((x) => x.type === 'ready'));
    await createOrder([menu.burgerLine()]);
    await here.waitFor((m) => eventsOf(m).length >= 2);
    expect(eventsOf(otherLocation.messages)).toEqual([]);
    otherLocation.socket.close();
    here.socket.close();
  });
});
