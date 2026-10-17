import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type { ApiErrorBody, Permission } from '@pos/shared-types';
import type { DailySummary, Order, OrderPayment, Shift } from '@pos/validation';
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
let cash: { id: string };
let card: { id: string };
let registerId: string;

const CASHIER: Permission[] = [
  'orders.view',
  'orders.create',
  'orders.update',
  'payments.create',
  'shifts.manage',
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
  tenant = await createTenant(prisma, CASHIER);
  menu = await createMenuFixture(prisma, tenant);
  cash = await prisma.paymentMethod.create({
    data: { restaurantId: tenant.restaurantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
  });
  card = await prisma.paymentMethod.create({
    data: { restaurantId: tenant.restaurantId, type: 'CARD', nameEn: 'Mada', nameAr: 'مدى' },
  });
  registerId = (
    await prisma.cashRegister.create({
      data: { locationId: tenant.locationA, nameEn: 'Drawer 1', nameAr: 'الدرج 1' },
    })
  ).id;
  owner = bearer(await login(app, tenant.owner.email));
  cashier = bearer(await login(app, tenant.cashier.email));
});

const loc = () => `/api/v1/locations/${tenant.locationA}`;

async function openShift(openingFloat = 10_000, headers = cashier): Promise<Shift> {
  const res = await app.inject({
    method: 'POST',
    url: `${loc()}/shifts`,
    headers,
    payload: { id: newId(), cashRegisterId: registerId, openingFloat },
  });
  if (res.statusCode !== 200) throw new Error(`open shift ${res.statusCode} ${res.body}`);
  return res.json<Shift>();
}

async function createOrder(
  items: Record<string, unknown>[] = [menu.burgerLine()],
  extra: Record<string, unknown> = {},
): Promise<Order> {
  const res = await app.inject({
    method: 'POST',
    url: `${loc()}/orders`,
    headers: cashier,
    payload: { id: newId(), channel: 'TAKEAWAY', items, ...extra },
  });
  if (res.statusCode !== 201) throw new Error(`order ${res.statusCode} ${res.body}`);
  return res.json<Order>();
}

function pay(order: Order, payload: Record<string, unknown>, headers = cashier) {
  return app.inject({
    method: 'POST',
    url: `${loc()}/orders/${order.id}/payments`,
    headers,
    payload: { id: newId(), ...payload },
  });
}

function refund(
  order: Order,
  paymentId: string,
  payload: Record<string, unknown>,
  headers = owner,
) {
  return app.inject({
    method: 'POST',
    url: `${loc()}/orders/${order.id}/payments/${paymentId}/refunds`,
    headers,
    payload: { id: newId(), ...payload },
  });
}

const transition = (order: Order, payload: Record<string, unknown>, headers = cashier) =>
  app.inject({ method: 'POST', url: `${loc()}/orders/${order.id}/transitions`, headers, payload });

const getShift = async (id: string) =>
  (
    await app.inject({ method: 'GET', url: `${loc()}/shifts/${id}`, headers: cashier })
  ).json<Shift>();

describe('shifts', () => {
  it('opens one shift per drawer, idempotently', async () => {
    const shift = await openShift();
    expect(shift).toMatchObject({
      status: 'OPEN',
      openingFloat: 10_000,
      cashRegisterNameEn: 'Drawer 1',
    });

    const replay = await app.inject({
      method: 'POST',
      url: `${loc()}/shifts`,
      headers: cashier,
      payload: { id: shift.id, cashRegisterId: registerId, openingFloat: 10_000 },
    });
    expect(replay.json<Shift>().id).toBe(shift.id);

    const second = await app.inject({
      method: 'POST',
      url: `${loc()}/shifts`,
      headers: cashier,
      payload: { id: newId(), cashRegisterId: registerId, openingFloat: 0 },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<ApiErrorBody>().code).toBe('SHIFT_ALREADY_OPEN');
  });

  it('allows only one of several concurrent openings on the same drawer', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        app.inject({
          method: 'POST',
          url: `${loc()}/shifts`,
          headers: cashier,
          payload: { id: newId(), cashRegisterId: registerId, openingFloat: 0 },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
  });

  it('reconciles the drawer on close: float + cash sales − refunds ± pay-ins/outs', async () => {
    const shift = await openShift(10_000);
    const order = await createOrder();
    await transition(order, { to: 'CONFIRMED' });
    const paid = await pay(order, {
      shiftId: shift.id,
      paymentMethodId: cash.id,
      amount: 2800,
      tendered: 5000,
    });
    const paymentId = paid.json<{ payment: OrderPayment }>().payment.id;
    await refund(order, paymentId, { shiftId: shift.id, amount: 300, reason: 'Missing item' });

    const payOut = await app.inject({
      method: 'POST',
      url: `${loc()}/shifts/${shift.id}/cash-movements`,
      headers: cashier,
      payload: { id: newId(), type: 'PAY_OUT', amount: 1000, reason: 'Ice' },
    });
    expect(payOut.statusCode).toBe(403); // cash.manage is a manager permission
    await app.inject({
      method: 'POST',
      url: `${loc()}/shifts/${shift.id}/cash-movements`,
      headers: owner,
      payload: { id: newId(), type: 'PAY_OUT', amount: 1000, reason: 'Ice' },
    });

    const summary = (await getShift(shift.id)).summary;
    expect(summary.cash).toEqual({
      openingFloat: 10_000,
      cashSales: 2800,
      cashRefunds: 300,
      payIns: 0,
      payOuts: 1000,
      expectedCash: 11_500,
    });

    const closed = await app.inject({
      method: 'POST',
      url: `${loc()}/shifts/${shift.id}/close`,
      headers: cashier,
      payload: { countedCash: 11_450, notes: 'Short 0.50' },
    });
    expect(closed.json<Shift>()).toMatchObject({
      status: 'CLOSED',
      expectedCash: 11_500,
      countedCash: 11_450,
      cashDifference: -50,
    });
    expect(await prisma.auditLog.findFirst({ where: { action: 'shift.closed' } })).toMatchObject({
      metadata: { expectedCash: 11_500, countedCash: 11_450, difference: -50 },
    });

    const afterClose = await pay(await createOrder(), {
      shiftId: shift.id,
      paymentMethodId: cash.id,
      amount: 2800,
    });
    expect(afterClose.json<ApiErrorBody>().code).toBe('SHIFT_NOT_OPEN');
    // The drawer can be opened again.
    expect((await openShift()).status).toBe('OPEN');
  });
});

describe('taking payments', () => {
  it('takes cash with change and marks the order paid', async () => {
    const shift = await openShift();
    const order = await createOrder();
    const res = await pay(order, {
      shiftId: shift.id,
      paymentMethodId: cash.id,
      amount: 2800,
      tendered: 5000,
    });
    expect(res.statusCode).toBe(200);
    const { payment, order: updated } = res.json<{ payment: OrderPayment; order: Order }>();
    expect(payment).toMatchObject({
      type: 'CHARGE',
      methodType: 'CASH',
      amount: 2800,
      tendered: 5000,
      change: 2200,
      status: 'CAPTURED',
    });
    expect(updated).toMatchObject({ paymentStatus: 'PAID', paidTotal: 2800, balanceDue: 0 });
    expect(await prisma.cashTransaction.findUnique({ where: { id: payment.id } })).toMatchObject({
      type: 'SALE',
      amount: 2800,
    });
  });

  it('splits a bill across card and cash', async () => {
    const shift = await openShift();
    const order = await createOrder();
    const first = await pay(order, {
      shiftId: shift.id,
      paymentMethodId: card.id,
      amount: 1000,
      reference: 'APP123',
    });
    expect(first.json<{ order: Order }>().order).toMatchObject({
      paymentStatus: 'PARTIALLY_PAID',
      balanceDue: 1800,
    });
    const second = await pay(order, { shiftId: shift.id, paymentMethodId: cash.id, amount: 1800 });
    expect(second.json<{ order: Order }>().order.paymentStatus).toBe('PAID');

    const byMethod = (await getShift(shift.id)).summary.byMethod;
    expect(byMethod.map((m) => [m.nameEn, m.charges])).toEqual([
      ['Cash', 1800],
      ['Mada', 1000],
    ]);
  });

  it('enforces card rules: approval code required, card numbers never stored, no overpayment', async () => {
    const shift = await openShift();
    const order = await createOrder();
    const base = { shiftId: shift.id, paymentMethodId: card.id };
    expect(
      (await pay(order, { ...base, amount: 2800 })).json<ApiErrorBody>().details,
    ).toMatchObject({ reason: 'REFERENCE_REQUIRED' });
    const pan = await pay(order, { ...base, amount: 2800, reference: '4111 1111 1111 1111' });
    expect(pan.json<ApiErrorBody>()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reason: 'LOOKS_LIKE_CARD_NUMBER' },
    });
    expect(
      (await pay(order, { ...base, amount: 2801, reference: 'A1' })).json<ApiErrorBody>().details,
    ).toMatchObject({
      reason: 'INVALID_AMOUNT',
    });
    expect(await prisma.payment.count()).toBe(0);
  });

  it('requires an open shift of this location and the payments.create permission', async () => {
    const order = await createOrder();
    const noShift = await pay(order, { shiftId: newId(), paymentMethodId: cash.id, amount: 2800 });
    expect(noShift.json<ApiErrorBody>().code).toBe('SHIFT_NOT_FOUND');
    const viewer = await createTenant(prisma, ['orders.view', 'locations.view']);
    const viewerToken = bearer(await login(app, viewer.cashier.email));
    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${viewer.locationA}/orders/${newId()}/payments`,
      headers: viewerToken,
      payload: { id: newId(), shiftId: newId(), paymentMethodId: newId(), amount: 1 },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('is idempotent and never over-collects under concurrent requests', async () => {
    const shift = await openShift();
    const order = await createOrder();
    const payload = { id: newId(), shiftId: shift.id, paymentMethodId: cash.id, amount: 2800 };
    const [a, b] = await Promise.all([pay(order, payload), pay(order, payload)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json<{ payment: OrderPayment }>().payment.id).toBe(
      b.json<{ payment: OrderPayment }>().payment.id,
    );

    const other = await createOrder();
    const racing = await Promise.all(
      [1, 2].map(() => pay(other, { shiftId: shift.id, paymentMethodId: cash.id, amount: 2800 })),
    );
    expect(racing.map((r) => r.statusCode).sort()).toEqual([200, 422]);
    expect(await prisma.payment.count({ where: { orderId: other.id } })).toBe(1);
  });

  it('rounds the settling cash payment when the location uses cash rounding', async () => {
    await prisma.location.update({
      where: { id: tenant.locationA },
      data: { cashRoundingIncrement: 500 },
    });
    const shift = await openShift(0);
    const order = await createOrder();
    const res = await pay(order, {
      shiftId: shift.id,
      paymentMethodId: cash.id,
      amount: 2800,
      tendered: 5000,
    });
    expect(res.json<{ payment: OrderPayment }>().payment).toMatchObject({
      amount: 2800,
      roundingAdjustment: 200,
      change: 2000,
    });
    expect((await getShift(shift.id)).summary.cash.expectedCash).toBe(3000);
  });

  it('completes an order only once it is paid', async () => {
    const shift = await openShift();
    const order = await createOrder();
    await transition(order, { to: 'CONFIRMED' });
    expect(
      (await transition(order, { to: 'COMPLETED' })).json<ApiErrorBody>().details,
    ).toMatchObject({ reason: 'UNPAID' });
    await pay(order, { shiftId: shift.id, paymentMethodId: cash.id, amount: 2800 });
    const done = await transition(order, { to: 'COMPLETED' });
    expect(done.json<Order>()).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID' });
  });

  it('protects paid money: no cancelling or shrinking a paid order before a refund', async () => {
    const shift = await openShift();
    const order = await createOrder([menu.burgerLine(2)]);
    await pay(order, { shiftId: shift.id, paymentMethodId: cash.id, amount: 3000 });
    const cancel = await transition(order, { to: 'CANCELLED', reason: 'x' }, owner);
    expect(cancel.json<ApiErrorBody>().details).toMatchObject({
      reason: 'REFUND_FIRST',
      held: 3000,
    });

    const current = (
      await app.inject({ method: 'GET', url: `${loc()}/orders/${order.id}`, headers: cashier })
    ).json<Order>();
    const shrink = await app.inject({
      method: 'PUT',
      url: `${loc()}/orders/${order.id}`,
      headers: cashier,
      payload: {
        version: current.version,
        channel: 'TAKEAWAY',
        items: [menu.colaLine(1, 'small')],
      },
    });
    expect(shrink.json<ApiErrorBody>().details).toMatchObject({ reason: 'BELOW_PAID' });
  });
});

describe('refunds', () => {
  it('requires payments.refund and a reason, and never exceeds the charge', async () => {
    const shift = await openShift();
    const order = await createOrder();
    const { payment } = (
      await pay(order, { shiftId: shift.id, paymentMethodId: cash.id, amount: 2800 })
    ).json<{ payment: OrderPayment }>();

    expect(
      (await refund(order, payment.id, { shiftId: shift.id, amount: 100, reason: 'x' }, cashier))
        .statusCode,
    ).toBe(403);
    expect(
      (await refund(order, payment.id, { shiftId: shift.id, amount: 100, reason: '' })).statusCode,
    ).toBe(400);
    const tooMuch = await refund(order, payment.id, {
      shiftId: shift.id,
      amount: 2801,
      reason: 'x',
    });
    expect(tooMuch.json<ApiErrorBody>()).toMatchObject({
      code: 'REFUND_NOT_ALLOWED',
      details: { refundable: 2800 },
    });

    const partial = await refund(order, payment.id, {
      shiftId: shift.id,
      amount: 800,
      reason: 'Cold fries',
    });
    expect(partial.json<{ order: Order }>().order).toMatchObject({
      paymentStatus: 'PARTIALLY_REFUNDED',
      refundedTotal: 800,
    });
    expect(await prisma.auditLog.count({ where: { action: 'payment.refunded' } })).toBe(1);
  });

  it('turns a fully refunded completed order into REFUNDED with history', async () => {
    const shift = await openShift();
    const order = await createOrder();
    await transition(order, { to: 'CONFIRMED' });
    const { payment } = (
      await pay(order, {
        shiftId: shift.id,
        paymentMethodId: card.id,
        amount: 2800,
        reference: 'AUTH77',
      })
    ).json<{ payment: OrderPayment }>();
    await transition(order, { to: 'COMPLETED' });

    const res = await refund(order, payment.id, {
      shiftId: shift.id,
      amount: 2800,
      reason: 'Customer complaint',
    });
    const refunded = res.json<{ order: Order }>().order;
    expect(refunded).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });
    expect(refunded.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'COMPLETED',
      toStatus: 'REFUNDED',
      reason: 'Customer complaint',
    });
    // Card refunds do not touch the cash drawer.
    expect((await getShift(shift.id)).summary.cash.cashRefunds).toBe(0);
  });
});

describe('daily summary', () => {
  it('summarises orders, channels and collections for the business day', async () => {
    const shift = await openShift();
    const paid = await createOrder([menu.burgerLine(2)]);
    await pay(paid, { shiftId: shift.id, paymentMethodId: cash.id, amount: 3000 });
    await pay(paid, { shiftId: shift.id, paymentMethodId: card.id, amount: 2600, reference: 'R1' });
    const dineIn = await createOrder([menu.colaLine(1, 'small')], {
      channel: 'DINE_IN',
      tableId: menu.tables[0]!.id,
    });
    const cancelled = await createOrder();
    await transition(cancelled, { to: 'CANCELLED', reason: 'Test' }, owner);

    const res = await app.inject({
      method: 'GET',
      url: `${loc()}/reports/daily-summary`,
      headers: cashier,
    });
    const summary = res.json<DailySummary>();
    expect(summary.orders).toEqual({ count: 2, completed: 0, open: 2, cancelled: 1 });
    expect(summary.sales.total).toBe(5600 + dineIn.total);
    expect(summary.byChannel).toEqual([
      { channel: 'DINE_IN', count: 1, total: dineIn.total },
      { channel: 'TAKEAWAY', count: 1, total: 5600 },
    ]);
    expect(summary.netCollected).toBe(5600);
  });
});
