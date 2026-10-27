import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type {
  AuditLogEntry,
  CashRegisterAdmin,
  CustomerDetail,
  CustomerSummary,
  Dashboard,
  Order,
  OrderSummary,
  Paginated,
  PairedDevice,
  PaymentListItem,
  PaymentMethodAdmin,
  Shift,
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
import { op, syncBuilders } from './sync-fixture';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let menu: Awaited<ReturnType<typeof createMenuFixture>>;
let owner: Record<string, string>;
let cashier: Record<string, string>;
let cashId: string;
let registerId: string;
let base: string;

beforeAll(async () => {
  ({ app, prisma } = await startApp({ DEV_PAYMENT_PROVIDERS: 'mock-online' }));
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma, [
    'orders.view',
    'orders.create',
    'orders.update',
    'orders.cancel',
    'payments.view',
    'payments.create',
    'shifts.manage',
    'locations.view',
    'products.view',
  ]);
  menu = await createMenuFixture(prisma, tenant);
  cashId = (
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
  cashier = bearer(await login(app, tenant.cashier.email));
  base = `/api/v1/tenants/${tenant.tenantId}`;
});

// The caller names the response type, as with light-my-request's `json<T>()`.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const locA = () => `/api/v1/locations/${tenant.locationA}`;

async function createOrder(extra: Record<string, unknown> = {}, at = locA()): Promise<Order> {
  const res = await call<Order>('POST', `${at}/orders`, owner, {
    id: newId(),
    channel: 'TAKEAWAY',
    items: [menu.burgerLine()],
    ...extra,
  });
  if (res.status !== 201)
    throw new Error(`order ${String(res.status)} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function openShift(): Promise<Shift> {
  return (
    await call<Shift>('POST', `${locA()}/shifts`, owner, {
      id: newId(),
      cashRegisterId: registerId,
      openingFloat: 0,
    })
  ).body;
}

async function payCash(order: Order, shift: Shift) {
  return call<{ order: Order }>('POST', `${locA()}/orders/${order.id}/payments`, owner, {
    id: newId(),
    shiftId: shift.id,
    paymentMethodId: cashId,
    amount: order.total,
    tendered: order.total,
  });
}

/** An online card charge as the website records it (captured by the mock provider). */
async function onlineCharge(order: Order, amount = order.total) {
  const method = await prisma.paymentMethod.create({
    data: {
      tenantId: tenant.tenantId,
      type: 'ONLINE',
      nameEn: 'Online',
      nameAr: 'إلكتروني',
    },
  });
  const charge = await prisma.payment.create({
    data: {
      id: newId(),
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      orderId: order.id,
      shiftId: null,
      paymentMethodId: method.id,
      methodType: 'ONLINE',
      methodNameEn: 'Online',
      methodNameAr: 'إلكتروني',
      type: 'CHARGE',
      status: 'CAPTURED',
      provider: 'mock-online',
      providerRef: `mock_${newId()}`,
      amount,
    },
  });
  await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
  return charge;
}

// --- Payment setup -------------------------------------------------------------------------------

describe('payment methods and cash drawers', () => {
  it('manages tenders with archive instead of delete, keeping one cash method', async () => {
    const card = await call<PaymentMethodAdmin>('POST', `${base}/payment-methods`, owner, {
      type: 'CARD',
      nameEn: 'Mada',
      nameAr: 'مدى',
      sortOrder: 2,
    });
    expect(card.status).toBe(201);
    const renamed = await call<PaymentMethodAdmin>(
      'PATCH',
      `${base}/payment-methods/${card.body.id}`,
      owner,
      { nameEn: 'Mada card', type: 'CASH' },
    );
    expect(renamed.body).toMatchObject({ nameEn: 'Mada card', type: 'CARD' }); // type is fixed
    const archived = await call<PaymentMethodAdmin>(
      'POST',
      `${base}/payment-methods/${card.body.id}/archive`,
      owner,
    );
    expect(archived.body.archivedAt).not.toBeNull();
    // The POS list hides archived tenders; the admin list keeps them.
    const pos = await call<{ id: string }[]>('GET', `${base}/payment-methods`, cashier);
    expect(pos.body.map((m) => m.id)).not.toContain(card.body.id);
    const all = await call<PaymentMethodAdmin[]>('GET', `${base}/payment-methods/all`, owner);
    expect(all.body.map((m) => m.id)).toContain(card.body.id);

    expect(await call('POST', `${base}/payment-methods/${cashId}/archive`, owner)).toMatchObject({
      status: 409,
      body: { details: { reason: 'LAST_CASH_METHOD' } },
    });
    expect(
      (
        await call('POST', `${base}/payment-methods`, cashier, {
          type: 'CASH',
          nameEn: 'X',
          nameAr: 'س',
        })
      ).status,
    ).toBe(403);
    const actions = (
      await prisma.auditLog.findMany({
        where: { entityType: 'PaymentMethod' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'payment_method.created',
      'payment_method.updated',
      'payment_method.archived',
    ]);
  });

  it('adds drawers per location and refuses to archive one with an open shift', async () => {
    const drawer = await call<CashRegisterAdmin>('POST', `${locA()}/cash-registers`, owner, {
      nameEn: 'Drawer 2',
      nameAr: 'الدرج 2',
    });
    expect(drawer.body).toMatchObject({ locationId: tenant.locationA, openShiftId: null });
    const shift = await openShift();
    expect(
      await call('POST', `${locA()}/cash-registers/${registerId}/archive`, owner),
    ).toMatchObject({ status: 409, body: { details: { reason: 'SHIFT_OPEN' } } });
    const list = await call<CashRegisterAdmin[]>('GET', `${locA()}/cash-registers/all`, owner);
    expect(list.body.find((r) => r.id === registerId)?.openShiftId).toBe(shift.id);
    expect(
      (await call('POST', `${locA()}/cash-registers/${drawer.body.id}/archive`, owner)).status,
    ).toBe(200);
    // Another location's drawer is not found through this location.
    const elsewhere = `/api/v1/locations/${tenant.locationB}/cash-registers/${registerId}`;
    expect((await call('PATCH', elsewhere, owner, { nameEn: 'X' })).body).toMatchObject({
      code: 'CASH_REGISTER_NOT_FOUND',
    });
  });
});

// --- Dashboard and searches ----------------------------------------------------------------------

describe('dashboard', () => {
  it('shows today per location, limited to the caller’s locations, with the hub link', async () => {
    const shift = await openShift();
    const paidOrder = await createOrder();
    await payCash(paidOrder, shift);
    const cancelled = await createOrder();
    await call('POST', `${locA()}/orders/${cancelled.id}/transitions`, owner, {
      to: 'CANCELLED',
      reason: 'Customer left',
    });
    await createOrder({}, `/api/v1/locations/${tenant.locationB}`);

    const dashboard = await call<Dashboard>('GET', `${base}/dashboard`, owner);
    expect(dashboard.status).toBe(200);
    const a = dashboard.body.locations.find((l) => l.locationId === tenant.locationA);
    expect(a).toMatchObject({
      orders: { count: 2, cancelled: 1 },
      sales: { total: paidOrder.total, paid: paidOrder.total },
      openShifts: 1,
      sync: { hub: 'NOT_PAIRED', openIssues: 0 },
    });
    expect(dashboard.body.locations).toHaveLength(2);

    const paired = await call<PairedDevice>('POST', `${locA()}/devices`, owner, {
      name: 'Hub',
      type: 'GATEWAY',
    });
    await prisma.device.update({
      where: { id: paired.body.device.id },
      data: {
        lastSeenAt: new Date(),
        metadata: { outbox: { pending: 3, failed: 1, reportedAt: new Date().toISOString() } },
      },
    });
    const withHub = await call<Dashboard>('GET', `${base}/dashboard`, owner);
    expect(
      withHub.body.locations.find((l) => l.locationId === tenant.locationA)?.sync,
    ).toMatchObject({ hub: 'ONLINE', pending: 3, failed: 1 });

    // A cashier of location A sees only A, and nothing about synchronization.
    const mine = await call<Dashboard>('GET', `${base}/dashboard`, cashier);
    expect(mine.body.locations.map((l) => l.locationId)).toEqual([tenant.locationA]);
    expect(mine.body.locations[0]?.sync).toBeNull();
  });
});

describe('order, customer and payment searches', () => {
  it('filters orders across locations with paging, within the caller’s reach', async () => {
    const sara = await createOrder({
      channel: 'PHONE',
      customerName: 'Sara',
      customerPhone: '0501234567',
    });
    await createOrder();
    await createOrder({}, `/api/v1/locations/${tenant.locationB}`);

    const all = await call<Paginated<OrderSummary>>('GET', `${base}/orders?pageSize=2`, owner);
    expect(all.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(all.body.items).toHaveLength(2);
    const phone = await call<Paginated<OrderSummary>>(
      'GET',
      `${base}/orders?channel=PHONE&search=sar`,
      owner,
    );
    expect(phone.body.items.map((o) => o.id)).toEqual([sara.id]);
    expect(phone.body.items[0]).toMatchObject({ itemCount: 1, status: 'PLACED' });
    const byNumber = await call<Paginated<OrderSummary>>(
      'GET',
      `${base}/orders?search=${encodeURIComponent(sara.orderNumber)}&status=CONFIRMED,PLACED`,
      owner,
    );
    expect(byNumber.body.total).toBe(1);

    const mine = await call<Paginated<OrderSummary>>('GET', `${base}/orders`, cashier);
    expect(mine.body.total).toBe(2);
    expect(
      (await call('GET', `${base}/orders?locationId=${tenant.locationB}`, cashier)).status,
    ).toBe(404);
    expect((await call('GET', `${base}/orders?status=NOPE`, owner)).status).toBe(400);
    expect((await call('GET', `${base}/orders?from=2026-10-10&to=2026-10-01`, owner)).status).toBe(
      400,
    );
  });

  it('groups customers by phone without putting the phone number in URLs', async () => {
    await createOrder({ channel: 'PHONE', customerName: 'Sara', customerPhone: '0501234567 ' });
    await createOrder({ channel: 'PHONE', customerName: 'Sara A.', customerPhone: '0501234567' });
    await createOrder({ channel: 'PHONE', customerName: 'Omar', customerPhone: '0777000111' });

    const list = await call<Paginated<CustomerSummary>>('GET', `${base}/customers`, owner);
    expect(list.body.total).toBe(2);
    const sara = list.body.items.find((c) => c.phone === '0501234567');
    expect(sara).toMatchObject({ name: 'Sara A.', orderCount: 2 });
    expect(sara?.key).toMatch(/^[a-f0-9]{64}$/);
    const detail = await call<CustomerDetail>('GET', `${base}/customers/${sara?.key ?? ''}`, owner);
    expect(detail.body.orders).toHaveLength(2);
    const search = await call<Paginated<CustomerSummary>>(
      'GET',
      `${base}/customers?search=oma`,
      owner,
    );
    expect(search.body.items.map((c) => c.name)).toEqual(['Omar']);
    expect((await call('GET', `${base}/customers`, cashier)).status).toBe(403);
    expect((await call('GET', `${base}/customers/0501`, owner)).status).toBe(400);
  });

  it('lists payments with what is still refundable', async () => {
    const shift = await openShift();
    const order = await createOrder();
    await payCash(order, shift);
    const list = await call<Paginated<PaymentListItem>>('GET', `${base}/payments`, owner);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        orderNumber: order.orderNumber,
        type: 'CHARGE',
        methodType: 'CASH',
        amount: order.total,
        refundable: order.total,
      }),
    ]);
    const refunds = await call<Paginated<PaymentListItem>>(
      'GET',
      `${base}/payments?type=REFUND`,
      owner,
    );
    expect(refunds.body.total).toBe(0);
  });
});

// --- Refunds from the admin portal ---------------------------------------------------------------

describe('admin refunds', () => {
  it('refunds online card charges through the provider, append-only and idempotent', async () => {
    const order = await createOrder();
    const charge = await onlineCharge(order);
    const cursorBefore = await prisma.changeLog.count({ where: { topic: 'ORDER' } });
    const body = { id: newId(), amount: 1000, reason: 'Cold food' };
    const first = await call<PaymentListItem>(
      'POST',
      `${locA()}/payments/${charge.id}/refunds`,
      owner,
      body,
    );
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ type: 'REFUND', amount: 1000, refundOfId: charge.id });
    const again = await call<PaymentListItem>(
      'POST',
      `${locA()}/payments/${charge.id}/refunds`,
      owner,
      body,
    );
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.payment.count({ where: { refundOfId: charge.id } })).toBe(1);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ paymentStatus: 'PARTIALLY_REFUNDED', version: order.version });
    // The hub hears about it (it merges online payments only).
    expect(await prisma.changeLog.count({ where: { topic: 'ORDER' } })).toBe(cursorBefore + 1);
    expect(
      await prisma.auditLog.count({ where: { action: 'payment.refunded', entityId: order.id } }),
    ).toBe(1);

    const tooMuch = await call('POST', `${locA()}/payments/${charge.id}/refunds`, owner, {
      id: newId(),
      amount: order.total,
      reason: 'All of it',
    });
    expect(tooMuch).toMatchObject({
      status: 422,
      body: { details: { reason: 'EXCEEDS_REFUNDABLE' } },
    });
    // The cashier has no payments.refund.
    expect(
      (
        await call('POST', `${locA()}/payments/${charge.id}/refunds`, cashier, {
          id: newId(),
          amount: 1,
          reason: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('sends cash and card refunds to the till', async () => {
    const shift = await openShift();
    const order = await createOrder();
    await payCash(order, shift);
    const charge = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const res = await call('POST', `${locA()}/payments/${charge.id}/refunds`, owner, {
      id: newId(),
      amount: 100,
      reason: 'Wrong item',
    });
    expect(res).toMatchObject({ status: 422, body: { details: { reason: 'IN_STORE_METHOD' } } });
  });

  it('refuses cloud changes to orders the location’s hub owns', async () => {
    const paired = await call<PairedDevice>('POST', `${locA()}/devices`, owner, {
      name: 'Hub',
      type: 'GATEWAY',
    });
    const b = syncBuilders({ tenant, menu, cashMethodId: cashId, registerId });
    const shift = b.shiftRow();
    const order = b.paid(b.orderRow(), shift);
    const push = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: { authorization: `Device ${paired.body.credential}` },
      payload: { operations: [op('Shift', shift, 1), op('Order', order, 1)] },
    });
    expect(push.json<{ results: { status: string }[] }>().results.map((r) => r.status)).toEqual([
      'APPLIED',
      'APPLIED',
    ]);
    const cancel = await call('POST', `${locA()}/orders/${order.id}/transitions`, owner, {
      to: 'CANCELLED',
      reason: 'From the office',
    });
    expect(cancel, JSON.stringify(cancel.body)).toMatchObject({
      status: 409,
      body: { details: { reason: 'OWNED_BY_LOCATION' } },
    });
    // The hub's shift holds drawer 1; the cloud's own shift uses another drawer.
    const drawer2 = await prisma.cashRegister.create({
      data: { locationId: tenant.locationA, nameEn: 'Drawer 2', nameAr: 'الدرج 2' },
    });
    const cloudShift = (
      await call<Shift>('POST', `${locA()}/shifts`, owner, {
        id: newId(),
        cashRegisterId: drawer2.id,
        openingFloat: 0,
      })
    ).body;
    const refund = await call(
      'POST',
      `${locA()}/orders/${order.id}/payments/${order.payments[0]?.id ?? ''}/refunds`,
      owner,
      { id: newId(), shiftId: cloudShift.id, amount: 100, reason: 'From the office' },
    );
    expect(refund).toMatchObject({
      status: 409,
      body: { details: { reason: 'OWNED_BY_LOCATION' } },
    });
  });
});

// --- Audit log -----------------------------------------------------------------------------------

describe('audit log', () => {
  it('filters entries, hides other scopes and never shows secrets', async () => {
    await createOrder();
    await call('PATCH', `/api/v1/tenants/${tenant.tenantId}`, owner, { nameEn: 'Renamed' });
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        actorType: 'SYSTEM',
        action: 'test.legacy',
        entityType: 'Test',
        metadata: { pinHash: 'leaked', nested: { refreshToken: 'abc', note: 'kept' } },
      },
    });

    const page = await call<Paginated<AuditLogEntry>>('GET', `${base}/audit-logs`, owner);
    expect(page.status).toBe(200);
    const actions = page.body.items.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['order.created', 'tenant.updated', 'auth.login']),
    );
    const legacy = page.body.items.find((e) => e.action === 'test.legacy');
    expect(legacy?.metadata).toEqual({
      pinHash: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', note: 'kept' },
    });
    const orders = await call<Paginated<AuditLogEntry>>(
      'GET',
      `${base}/audit-logs?action=order.&locationId=${tenant.locationA}`,
      owner,
    );
    expect(orders.body.items.every((e) => e.action.startsWith('order.'))).toBe(true);
    expect(orders.body.items[0]).toMatchObject({ actorName: 'Owner', source: 'ADMIN' });

    // A location auditor sees that location's entries only, not tenant-level ones.
    const auditor = await prisma.role.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Auditor A',
        permissions: { create: [{ permissionKey: 'audit.view' }] },
      },
    });
    await prisma.userRole.create({
      data: { userId: tenant.cashier.id, roleId: auditor.id, locationId: tenant.locationA },
    });
    const scoped = await call<Paginated<AuditLogEntry>>('GET', `${base}/audit-logs`, cashier);
    expect(scoped.body.items.every((e) => e.locationId === tenant.locationA)).toBe(true);
    expect(scoped.body.items.map((e) => e.action)).not.toContain('tenant.updated');
    expect(
      (await call('GET', `${base}/audit-logs?locationId=${tenant.locationB}`, cashier)).status,
    ).toBe(404);
  });
});
