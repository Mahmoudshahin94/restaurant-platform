import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Prisma, type PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type {
  LocationSnapshot,
  PairedDevice,
  SyncIssue,
  SyncKitchenTicket,
  SyncOperationResult,
  SyncOrder,
  SyncPullResponse,
  SyncPushResponse,
  SyncShift,
} from '@pos/validation';
import {
  syncAuditLogSchema,
  syncCashTransactionSchema,
  syncKitchenTicketSchema,
  syncOrderDiscountSchema,
  syncOrderItemModifierSchema,
  syncOrderItemSchema,
  syncOrderSchema,
  syncOrderStatusHistorySchema,
  syncOrderTaxSchema,
  syncPaymentSchema,
  syncShiftSchema,
  syncTicketItemSchema,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';
import { type SyncBuilders, op, syncBuilders } from './sync-fixture';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let menu: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Record<string, string>;
let hub: Record<string, string>;
let deviceId: string;
let cashMethodId: string;
let registerId: string;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma);
  menu = await createMenuFixture(prisma, tenant);
  cashMethodId = (
    await prisma.paymentMethod.create({
      data: { tenantId: tenant.tenantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
    })
  ).id;
  registerId = (
    await prisma.cashRegister.create({
      data: { locationId: tenant.locationA, nameEn: 'Drawer 1', nameAr: 'الدرج 1' },
    })
  ).id;
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
});

// --- Payload builders (test/sync-fixture.ts) ------------------------------------------------------

let builders: SyncBuilders;
beforeEach(() => {
  builders = syncBuilders({ tenant, menu, cashMethodId, registerId });
});
const now = () => builders.now();
const orderRow = (overrides?: Partial<SyncOrder>) => builders.orderRow(overrides);
const shiftRow = (overrides?: Partial<SyncShift>) => builders.shiftRow(overrides);
const paid = (order: SyncOrder, shift: SyncShift) => builders.paid(order, shift);
const ticketRow = (order: SyncOrder, overrides?: Partial<SyncKitchenTicket>) =>
  builders.ticketRow(order, overrides);

async function push(
  operations: { operationId: string }[],
  extra: Record<string, unknown> = {},
  headers = hub,
): Promise<SyncOperationResult[]> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers,
    payload: { operations, ...extra },
  });
  expect(res.statusCode).toBe(200);
  return res.json<SyncPushResponse>().results;
}

const statuses = (results: SyncOperationResult[]) => results.map((r) => r.status);

// --- Push ----------------------------------------------------------------------------------------

describe('POST /sync/push', () => {
  it('applies a new order with its lines exactly once, and answers DUPLICATE on a repeat', async () => {
    const order = orderRow();
    const first = op('Order', order, 1);
    expect(statuses(await push([first]))).toEqual(['APPLIED']);

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { modifiers: true } }, taxes: true, statusHistory: true },
    });
    expect(stored).toMatchObject({ orderNumber: order.orderNumber, total: 2800, version: 1 });
    expect(stored.items[0]?.modifiers.map((m) => m.nameEn)).toEqual(['Cheese']);
    expect(stored.items[0]?.stationIds).toEqual([menu.grill.id]);
    expect(stored.taxes).toHaveLength(1);
    expect(stored.statusHistory).toHaveLength(1);

    expect(await push([first])).toEqual([
      { operationId: first.operationId, status: 'DUPLICATE', code: null, message: null },
    ]);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);
    expect(await prisma.processedOperation.findMany()).toMatchObject([
      { operationId: first.operationId, status: 'APPLIED', attempts: 1, rowVersion: 1 },
    ]);
  });

  it('never applies one operation twice under concurrent delivery', async () => {
    const order = orderRow();
    const once = op('Order', order, 1);
    const results = await Promise.all([push([once]), push([once]), push([once])]);
    expect(statuses(results.flat()).sort()).toEqual(['APPLIED', 'DUPLICATE', 'DUPLICATE']);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.processedOperation.count()).toBe(1);
  });

  it('replaces lines, appends history and stores payments with their cash movements', async () => {
    const shift = shiftRow();
    const order = orderRow();
    expect(statuses(await push([op('Shift', shift, 1), op('Order', order, 1)]))).toEqual([
      'APPLIED',
      'APPLIED',
    ]);

    // The hub edits the order (a different line), it is paid and completed.
    const newItemId = newId();
    const edited: SyncOrder = {
      ...order,
      version: 2,
      items: [
        {
          ...order.items[0]!,
          id: newItemId,
          quantity: 2,
          modifiers: [],
        },
      ],
    };
    const settled = paid(edited, shift);
    const completed: SyncOrder = {
      ...settled,
      status: 'COMPLETED',
      completedAt: now(),
      version: settled.version + 1,
      statusHistory: [
        ...settled.statusHistory,
        {
          ...settled.statusHistory[0]!,
          id: newId(),
          fromStatus: 'CONFIRMED',
          toStatus: 'COMPLETED',
        },
      ],
    };
    // The shift's own aggregate also lists the sale movement; it must not be stored twice.
    const shiftAfter: SyncShift = {
      ...shift,
      cash: [...shift.cash, ...completed.payments[0]!.cash],
    };
    expect(statuses(await push([op('Order', completed, 2), op('Shift', shiftAfter, 2)]))).toEqual([
      'APPLIED',
      'APPLIED',
    ]);

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, statusHistory: true, payments: { include: { cash: true } } },
    });
    expect(stored).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID', version: 4 });
    expect(stored.items.map((i) => [i.id, i.quantity])).toEqual([[newItemId, 2]]);
    expect(stored.statusHistory).toHaveLength(2);
    expect(stored.payments).toHaveLength(1);
    expect(stored.payments[0]?.cash).toHaveLength(1);
    expect(await prisma.cashTransaction.count({ where: { shiftId: shift.id } })).toBe(2);
    expect(await prisma.orderItemModifier.count()).toBe(0);
  });

  it('accepts operations queued by a Phase 5 hub, whose payments carry no cash movements', async () => {
    const shift = shiftRow();
    const settled = paid(orderRow(), shift);
    const sale = settled.payments[0]!.cash;
    const legacy = {
      ...settled,
      payments: settled.payments.map(({ cash: _cash, ...payment }) => payment),
    };
    expect(statuses(await push([op('Shift', shift, 1), op('Order', legacy, 1)]))).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    expect(await prisma.cashTransaction.count({ where: { paymentId: { not: null } } })).toBe(0);
    // The shift's next upload brings the sale movement, now that its payment is in the cloud.
    expect(
      statuses(await push([op('Shift', { ...shift, cash: [...shift.cash, ...sale] }, 2)])),
    ).toEqual(['APPLIED']);
    expect(await prisma.cashTransaction.count({ where: { shiftId: shift.id } })).toBe(2);
  });

  it('stores kitchen tickets after their order, and asks to retry a ticket that came first', async () => {
    const order = orderRow();
    const ticket = ticketRow(order);
    const early = op('KitchenTicket', ticket, 1);
    expect(await push([early])).toEqual([
      expect.objectContaining({ status: 'RETRY', code: 'SYNC_DEPENDENCY_MISSING' }),
    ]);
    // A RETRY is not a decision about the operation: nothing is recorded.
    expect(await prisma.processedOperation.count()).toBe(0);

    expect(statuses(await push([op('Order', order, 1), early]))).toEqual(['APPLIED', 'APPLIED']);
    const started: SyncKitchenTicket = {
      ...ticket,
      status: 'PREPARING',
      startedAt: now(),
      version: 2,
    };
    expect(statuses(await push([op('KitchenTicket', started, 2)]))).toEqual(['APPLIED']);
    expect(
      await prisma.kitchenTicket.findUniqueOrThrow({
        where: { id: ticket.id },
        include: { items: true },
      }),
    ).toMatchObject({ status: 'PREPARING', version: 2, items: [{ quantity: 1 }] });
  });

  it('refuses a change older than the cloud’s copy, and records it for administrators', async () => {
    const order = orderRow();
    await push([op('Order', order, 1), op('Order', { ...order, version: 2, notes: 'v2' }, 2)]);
    const stale = op('Order', { ...order, version: 2, notes: 'replayed' }, 2);
    expect(await push([stale])).toEqual([
      expect.objectContaining({ status: 'CONFLICT', code: 'SYNC_CONFLICT' }),
    ]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).notes).toBe('v2');

    const issues = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/sync/issues`,
      headers: owner,
    });
    expect(issues.json<SyncIssue[]>()).toEqual([
      expect.objectContaining({
        operationId: stale.operationId,
        status: 'CONFLICT',
        errorCode: 'SYNC_CONFLICT',
        deviceId,
      }),
    ]);
    const cashier = bearer(await login(app, tenant.cashier.email));
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/sync/issues`,
      headers: cashier,
    });
    expect(denied.statusCode).toBe(403);
  });

  it('refuses to overwrite an order changed in the cloud or never synchronized from the hub', async () => {
    const order = orderRow();
    await push([op('Order', order, 1)]);
    await prisma.order.update({
      where: { id: order.id },
      data: { notes: 'edited in the cloud', version: 2 },
    });
    expect(await push([op('Order', { ...order, version: 2, notes: 'hub' }, 2)])).toEqual([
      expect.objectContaining({ status: 'CONFLICT', code: 'SYNC_CONFLICT' }),
    ]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).notes).toBe(
      'edited in the cloud',
    );

    // An order that exists in the cloud but never came from this hub.
    const cloudOrder = orderRow();
    const {
      items: _i,
      taxes: _t,
      discounts: _d,
      statusHistory: _h,
      payments: _p,
      deliveryAddress: _a,
      ...row
    } = cloudOrder;
    await prisma.order.create({ data: { ...row, businessDate: new Date(row.businessDate) } });
    expect(await push([op('Order', cloudOrder, 1)])).toEqual([
      expect.objectContaining({ status: 'CONFLICT' }),
    ]);
  });

  it('rejects data for another location or tenant, and malformed operations, one by one', async () => {
    const elsewhere = orderRow({ locationId: tenant.locationB });
    const malformed = { ...op('Order', orderRow(), 1), payload: { id: newId(), total: 'free' } };
    const unknown = { ...op('Order', orderRow(), 1), operationType: 'ORDER_DELETE' };
    const good = orderRow();
    const results = await push([
      op('Order', elsewhere, 1),
      malformed,
      unknown,
      op('Order', good, 1),
    ]);
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['REJECTED', 'SYNC_SCOPE_MISMATCH'],
      ['REJECTED', 'VALIDATION_FAILED'],
      ['REJECTED', 'VALIDATION_FAILED'],
      ['APPLIED', null],
    ]);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.processedOperation.count({ where: { status: 'REJECTED' } })).toBe(3);

    // The database's own rules still apply: a manual cash movement needs a reason.
    const shift = shiftRow();
    shift.cash[0]!.reason = null;
    expect((await push([op('Shift', shift, 1)]))[0]).toMatchObject({
      status: 'REJECTED',
      code: 'SYNC_REJECTED',
    });

    const otherTenant = await createTenant(prisma);
    const foreign = orderRow({ tenantId: otherTenant.tenantId });
    expect((await push([op('Order', foreign, 1)]))[0]?.code).toBe('SYNC_SCOPE_MISMATCH');
  });

  it('applies a refused operation once its cause is fixed', async () => {
    const taken = orderRow();
    await push([op('Order', taken, 1)]);
    // Same order number on the same business day: the cloud's unique index refuses it.
    const clash = op('Order', orderRow({ orderNumber: taken.orderNumber }), 1);
    expect((await push([clash]))[0]?.status).toBe('CONFLICT');

    await prisma.order.update({ where: { id: taken.id }, data: { orderNumber: 'LOCA-RENAMED' } });
    expect(statuses(await push([clash]))).toEqual(['APPLIED']);
    expect(
      await prisma.processedOperation.findUniqueOrThrow({
        where: { operationId: clash.operationId },
      }),
    ).toMatchObject({ status: 'APPLIED', attempts: 2, errorCode: null });
  });

  it('authenticates the hub, and keeps its reported outbox on the device', async () => {
    const order = orderRow();
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      payload: { operations: [op('Order', order, 1)] },
    });
    expect(anonymous.statusCode).toBe(401);
    const asStaff = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: owner,
      payload: { operations: [op('Order', order, 1)] },
    });
    expect(asStaff.statusCode).toBe(401);

    await push([op('Order', order, 1)], { outbox: { pending: 3, failed: 1 } });
    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.metadata).toMatchObject({ outbox: { pending: 3, failed: 1 } });

    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: hub,
      payload: { operations: [] },
    });
    expect(empty.statusCode).toBe(400);
  });
});

// --- Pull ----------------------------------------------------------------------------------------

async function pull(query: string): Promise<SyncPullResponse> {
  const res = await app.inject({ method: 'GET', url: `/api/v1/sync/pull?${query}`, headers: hub });
  expect(res.statusCode).toBe(200);
  return res.json<SyncPullResponse>();
}

describe('hub audit trail (ADR 0016)', () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: newId(),
    tenantId: tenant.tenantId,
    locationId: tenant.locationA,
    actorType: 'USER',
    actorId: tenant.cashier.id,
    source: 'POS',
    action: 'auth.pin_login',
    entityType: 'User',
    entityId: tenant.cashier.id,
    metadata: { employeeCode: '1001' },
    requestId: 'hub-req-1',
    createdAt: '2026-10-23T08:00:00.000Z',
    ...overrides,
  });

  it('stores the hub’s audit entries once, under the hub’s location', async () => {
    const signIn = entry();
    const system = entry({
      tenantId: null,
      locationId: null,
      actorType: 'SYSTEM',
      actorId: null,
      source: null,
      action: 'auth.pin_login_failed',
      metadata: { reason: 'BAD_PIN', pin: '1234', nested: { refreshToken: 'rt-value' } },
    });
    const first = op('AuditLog', signIn, 1);
    expect(statuses(await push([first, op('AuditLog', system, 1)]))).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    expect(statuses(await push([first]))).toEqual(['DUPLICATE']);

    const stored = await prisma.auditLog.findMany({
      where: { id: { in: [signIn.id, system.id] } },
      orderBy: { action: 'asc' },
    });
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      action: 'auth.pin_login',
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      actorId: tenant.cashier.id,
      source: 'POS',
      requestId: 'hub-req-1',
      createdAt: new Date('2026-10-23T08:00:00.000Z'),
    });
    // Rows without a tenant are the hub's own; secrets are redacted again on the way in.
    expect(stored[1]).toMatchObject({
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      source: 'HUB',
      metadata: { reason: 'BAD_PIN', pin: '[REDACTED]', nested: { refreshToken: '[REDACTED]' } },
    });

    // The owner reads them in the cloud's audit log.
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenant.tenantId}/audit-logs?action=auth.pin_login`,
      headers: owner,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).toContain(signIn.id);
  });

  it('refuses entries of another location or tenant, and never rewrites one', async () => {
    const otherTenant = await createTenant(prisma);
    const results = await push([
      op('AuditLog', entry({ locationId: tenant.locationB }), 1),
      op('AuditLog', entry({ tenantId: otherTenant.tenantId }), 1),
      op('AuditLog', entry({ action: '' }), 1),
    ]);
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['REJECTED', 'SYNC_SCOPE_MISMATCH'],
      ['REJECTED', 'SYNC_SCOPE_MISMATCH'],
      ['REJECTED', 'VALIDATION_FAILED'],
    ]);

    // A new operation for an entry already stored changes nothing.
    const original = entry();
    await push([op('AuditLog', original, 1)]);
    expect(statuses(await push([op('AuditLog', { ...original, action: 'forged' }, 2)]))).toEqual([
      'APPLIED',
    ]);
    const stored = await prisma.auditLog.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored.action).toBe('auth.pin_login');
  });
});

describe('GET /sync/pull', () => {
  it('starts a new hub at the head of its tenant’s feed', async () => {
    const head = await pull('');
    expect(head.changes).toEqual([]);
    const max = await prisma.changeLog.aggregate({
      where: { tenantId: tenant.tenantId },
      _max: { seq: true },
    });
    expect(head.cursor).toBe(String(max._max.seq));
  });

  it('records one CONFIG change per transaction, for that tenant only', async () => {
    const { cursor } = await pull('');
    expect((await pull(`cursor=${cursor}`)).changes).toEqual([]);

    // A price change through the admin API (one transaction, several rows).
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${tenant.tenantId}/products/${menu.burger.id}`,
      headers: owner,
      payload: { price: 2700 },
    });
    expect(res.statusCode).toBe(200);
    // Another tenant's change is not visible to this hub.
    await createTenant(prisma);
    // A write that changes nothing is not a change.
    await prisma.product.update({ where: { id: menu.cola.id }, data: { price: 600 } });

    const next = await pull(`cursor=${cursor}`);
    expect(next.changes).toEqual([expect.objectContaining({ topic: 'CONFIG', entityId: null })]);
    expect(next.cursor).toBe(next.changes[0]?.seq);
    expect(next.hasMore).toBe(false);
    expect((await pull(`cursor=${next.cursor}`)).changes).toEqual([]);
  });

  it('pages through the feed with limit', async () => {
    const { cursor } = await pull('');
    for (const price of [1, 2, 3]) {
      await prisma.product.update({ where: { id: menu.cola.id }, data: { price: 600 + price } });
    }
    const first = await pull(`cursor=${cursor}&limit=2`);
    expect(first.changes).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const rest = await pull(`cursor=${first.cursor}&limit=2`);
    expect(rest.changes).toHaveLength(1);
    expect(rest.hasMore).toBe(false);
  });

  it('holds a long poll until a change arrives', async () => {
    const { cursor } = await pull('');
    const started = Date.now();
    const waiting = pull(`cursor=${cursor}&wait=10`);
    setTimeout(() => {
      // Prisma queries run when awaited or `then`-ed.
      void prisma.category
        .updateMany({ where: { tenantId: tenant.tenantId }, data: { nameEn: 'Mains!' } })
        .then(() => undefined);
    }, 300);
    const answer = await waiting;
    expect(answer.changes).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5000);

    const idle = Date.now();
    expect((await pull(`cursor=${answer.cursor}&wait=1`)).changes).toEqual([]);
    expect(Date.now() - idle).toBeGreaterThanOrEqual(900);
  });

  it('validates the cursor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?cursor=abc',
      headers: hub,
    });
    expect(res.statusCode).toBe(400);
  });
});

// --- Contract: payload schemas mirror the database rows -----------------------------------------

describe('accounts at the hub (E1)', () => {
  const snapshot = async (): Promise<LocationSnapshot> => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/snapshot', headers: hub });
    expect(res.statusCode).toBe(200);
    return res.json<LocationSnapshot>();
  };

  it("the snapshot carries the users' accounts", async () => {
    // Someone else's brand, and a member of this brand who works at the other location only.
    const elsewhere = await createTenant(prisma);
    const body = await snapshot();
    expect(body.format).toBe(9);
    const users = await prisma.user.findMany({
      where: { id: { in: body.tables.users.map((u) => String(u.id)) } },
    });
    const accounts = body.tables.accounts;
    expect(accounts.map((a) => a.id).sort()).toEqual(users.map((u) => u.accountId).sort());
    expect(accounts.map((a) => a.id)).not.toContain(
      (await prisma.user.findUniqueOrThrow({ where: { id: elsewhere.owner.id } })).accountId,
    );
    // The hash travels (offline sign-in); the last brand signed into never leaves the cloud.
    expect(accounts.every((a) => typeof a.passwordHash === 'string')).toBe(true);
    expect(accounts.every((a) => a.lastTenantId === null)).toBe(true);
    expect(users.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it("a brand cannot bring another brand's account to its hub", async () => {
    const elsewhere = await createTenant(prisma);
    const cashier = await prisma.role.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, name: 'Cashier' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenant.tenantId}/users`,
      headers: owner,
      payload: {
        email: elsewhere.owner.email,
        displayName: 'Not theirs',
        password: 'a-password-of-mine',
        roles: [{ roleId: cashier.id, locationId: tenant.locationA }],
      },
    });
    expect(res.statusCode).toBe(409);
    const body = await snapshot();
    const foreign = await prisma.account.findUniqueOrThrow({
      where: { email: elsewhere.owner.email },
    });
    expect(body.tables.accounts.map((a) => a.id)).not.toContain(foreign.id);
    // Every account the hub gets has a user in its brand.
    const ours = new Set(
      (await prisma.user.findMany({ where: { tenantId: tenant.tenantId } })).map(
        (u) => u.accountId,
      ),
    );
    expect(body.tables.accounts.every((a) => ours.has(String(a.id)))).toBe(true);
  });

  it('a password reset in the cloud reaches the hub through the change feed', async () => {
    const before = await snapshot();
    const { cursor } = await pull('');
    const reset = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenant.tenantId}/users/${tenant.cashier.id}/password`,
      headers: owner,
      payload: { password: 'A-brand-new-password-1' },
    });
    expect(reset.statusCode).toBeLessThan(300);

    const changes = (await pull(`cursor=${cursor}`)).changes;
    expect(changes).toEqual([expect.objectContaining({ topic: 'CONFIG' })]);
    const after = await snapshot();
    const hashOf = (s: LocationSnapshot) =>
      s.tables.accounts.find((a) => a.email === tenant.cashier.email)?.passwordHash;
    expect(hashOf(after)).toBeTruthy();
    expect(hashOf(after)).not.toBe(hashOf(before));
    expect(after.version).not.toBe(before.version);
  });

  it('signing in is not a configuration change', async () => {
    const { cursor } = await pull('');
    await login(app, tenant.cashier.email); // moves lastTenantId, not what a hub keeps
    expect((await pull(`cursor=${cursor}`)).changes).toEqual([]);
  });

  it('an account shared by two brands notifies both hubs when its password changes', async () => {
    const other = await createTenant(prisma);
    const account = await prisma.user.findUniqueOrThrow({ where: { id: tenant.owner.id } });
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId: other.tenantId } });
    await prisma.user.create({
      data: {
        tenantId: other.tenantId,
        accountId: account.accountId,
        email: tenant.owner.email,
        displayName: 'Shared',
        roles: { create: { roleId: role.id } },
      },
    });
    const head = async (tenantId: string) =>
      (await prisma.changeLog.aggregate({ where: { tenantId }, _max: { seq: true } }))._max.seq;
    const [a, b] = [await head(tenant.tenantId), await head(other.tenantId)];
    await prisma.account.update({ where: { id: account.accountId }, data: { passwordHash: 'x' } });
    expect(await head(tenant.tenantId)).not.toBe(a);
    expect(await head(other.tenantId)).not.toBe(b);
  });
});

describe('sync payload schemas', () => {
  const fieldsOf = (model: string, relations: string[] = []) => {
    const found = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
    if (!found) throw new Error(model);
    return found.fields
      .filter((f) => f.kind !== 'object' || relations.includes(f.name))
      .map((f) => f.name)
      .sort();
  };
  const keysOf = (schema: z.ZodObject) => Object.keys(schema.shape).sort();

  it.each([
    ['Order', syncOrderSchema, ['items', 'taxes', 'discounts', 'statusHistory', 'payments']],
    ['OrderItem', syncOrderItemSchema, ['modifiers']],
    ['OrderItemModifier', syncOrderItemModifierSchema, []],
    ['OrderTax', syncOrderTaxSchema, []],
    ['OrderDiscount', syncOrderDiscountSchema, []],
    ['OrderStatusHistory', syncOrderStatusHistorySchema, []],
    ['Payment', syncPaymentSchema, ['cash']],
    ['CashTransaction', syncCashTransactionSchema, []],
    ['Shift', syncShiftSchema, ['cash']],
    ['KitchenTicket', syncKitchenTicketSchema, ['items']],
    ['KitchenTicketItem', syncTicketItemSchema, []],
    ['AuditLog', syncAuditLogSchema, []],
  ] as const)('%s', (model, schema, relations) => {
    expect(keysOf(schema)).toEqual(fieldsOf(model, [...relations]));
  });
});
