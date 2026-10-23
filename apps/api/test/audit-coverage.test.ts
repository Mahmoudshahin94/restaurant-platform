import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import { OnlinePaymentsService, PrismaService } from '@pos/server';
import type { Order, Role, Shift } from '@pos/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, bearer, createTenant, resetDatabase, startApp } from './helpers';
import { createMenuFixture } from './menu-fixture';

/**
 * The specification's audited actions (login, logout, cancellation, refund, discount, price
 * change, product change, payment correction, shift open/close, permission change, configuration
 * change), each produced through the API in the cloud and checked in the audit log, with no secret
 * in any entry.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;

beforeAll(async () => {
  ({ app, prisma } = await startApp({ ONLINE_PAYMENT_PROVIDER: 'mock' }));
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('audit coverage', () => {
  it('records every action the specification lists', async () => {
    await resetDatabase(prisma);
    const tenant = await createTenant(prisma);
    const menu = await createMenuFixture(prisma, tenant);
    const cash = await prisma.paymentMethod.create({
      data: { tenantId: tenant.tenantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
    });
    const register = await prisma.cashRegister.create({
      data: { locationId: tenant.locationA, nameEn: 'Drawer', nameAr: 'درج' },
    });
    const loc = `/api/v1/locations/${tenant.locationA}`;
    const base = `/api/v1/tenants/${tenant.tenantId}`;
    // Login (and, at the end, logout).
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: tenant.owner.email, password: PASSWORD, client: 'native' },
    });
    const session = login.json<{ accessToken: string; refreshToken: string }>();
    const owner = bearer(session.accessToken);

    const call = async <T>(
      method: 'GET' | 'POST' | 'PATCH' | 'PUT',
      url: string,
      payload?: object,
    ) => {
      const res = await app.inject({
        method,
        url,
        headers: owner,
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
      return res.json<T>();
    };

    // Product change and price change.
    await call('PATCH', `${base}/products/${menu.burger.id}`, {
      price: 2700,
      nameEn: 'Big Burger',
    });

    // Shift open, a discounted order, a payment and a refund, a cancellation, shift close.
    const shift = await call<Shift>('POST', `${loc}/shifts`, {
      id: newId(),
      cashRegisterId: register.id,
      openingFloat: 0,
    });
    const order = await call<Order>('POST', `${loc}/orders`, {
      id: newId(),
      channel: 'TAKEAWAY',
      status: 'CONFIRMED',
      items: [menu.colaLine(1)],
      discountIds: [menu.tenPercent.id],
    });
    const paid = await call<{ payment: { id: string } }>(
      'POST',
      `${loc}/orders/${order.id}/payments`,
      {
        id: newId(),
        shiftId: shift.id,
        paymentMethodId: cash.id,
        amount: order.total,
        tendered: order.total,
      },
    );
    await call('POST', `${loc}/orders/${order.id}/payments/${paid.payment.id}/refunds`, {
      id: newId(),
      shiftId: shift.id,
      amount: 100,
      reason: 'Wrong size',
    });
    const other = await call<Order>('POST', `${loc}/orders`, {
      id: newId(),
      channel: 'TAKEAWAY',
      items: [menu.colaLine(1)],
    });
    await call('POST', `${loc}/orders/${other.id}/transitions`, {
      to: 'CANCELLED',
      reason: 'Customer left',
    });
    await call('POST', `${loc}/shifts/${shift.id}/close`, { countedCash: order.total - 100 });

    // Payment correction: an online charge voided by the cloud.
    const online = await prisma.paymentMethod.create({
      data: {
        tenantId: tenant.tenantId,
        type: 'ONLINE',
        nameEn: 'Online',
        nameAr: 'إلكتروني',
      },
    });
    await prisma.payment.create({
      data: {
        id: newId(),
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        orderId: other.id,
        paymentMethodId: online.id,
        methodType: 'ONLINE',
        methodNameEn: 'Online',
        methodNameAr: 'إلكتروني',
        type: 'CHARGE',
        status: 'CAPTURED',
        provider: 'mock-online',
        providerRef: 'mock_ref',
        amount: 500,
      },
    });
    const payments = app.get(OnlinePaymentsService);
    await app.get(PrismaService).$transaction((tx) => payments.voidAll(tx, other.id, 'TOO_BUSY'));

    // Permission changes and configuration changes.
    const role = await call<Role>('POST', `${base}/roles`, {
      name: 'Lead',
      permissions: ['orders.view'],
    });
    await call('PATCH', `${base}/roles/${role.id}`, {
      permissions: ['orders.view', 'shifts.manage'],
    });
    await call('PUT', `${base}/users/${tenant.cashier.id}/roles`, {
      roles: [{ roleId: role.id, locationId: tenant.locationA }],
    });
    await call('PATCH', loc, { kdsWarnMinutes: 9 });
    await call('PATCH', base, { nameEn: 'Renamed' });
    await call('PUT', `${loc}/online-ordering`, { state: 'PAUSED' });
    await call('POST', `${base}/payment-methods`, { type: 'CARD', nameEn: 'Visa', nameAr: 'فيزا' });

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });

    const entries = await prisma.auditLog.findMany({
      where: { tenantId: tenant.tenantId },
    });
    const actions = new Set(entries.map((e) => e.action));
    for (const action of [
      'auth.login',
      'auth.logout',
      'order.cancelled',
      'payment.refunded',
      'order.discount_applied',
      'product.price_changed',
      'product.updated',
      'payment.voided',
      'shift.opened',
      'shift.closed',
      'role.created',
      'role.permissions_changed',
      'user.roles_changed',
      'location.updated',
      'tenant.updated',
      'online_ordering.updated',
      'payment_method.created',
    ]) {
      expect(actions, action).toContain(action);
    }
    // Every entry knows who acted and from where; no secret is ever stored.
    expect(entries.every((e) => e.source !== null)).toBe(true);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(session.refreshToken);
  });
});
