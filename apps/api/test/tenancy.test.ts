import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type { ApiErrorBody } from '@pos/shared-types';
import type { Location, Restaurant } from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let ownerToken: string;
let cashierToken: string;

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
  ownerToken = await login(app, tenant.owner.email);
  cashierToken = await login(app, tenant.cashier.email);
});

describe('health', () => {
  it('serves /health and /ready outside the versioned prefix and echoes request ids', async () => {
    const health = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'req-12345678' },
    });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-request-id']).toBe('req-12345678');
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.json()).toEqual({ status: 'ready', database: 'ok' });
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('NOT_FOUND');
  });

  it('sets security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('restaurants', () => {
  it('lets any member read their restaurant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/restaurants/${tenant.restaurantId}`,
      headers: bearer(cashierToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Restaurant>().currencyCode).toBe('SAR');
  });

  it('hides other tenants', async () => {
    const other = await createTenant(prisma);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/restaurants/${other.restaurantId}`,
      headers: bearer(ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('RESTAURANT_NOT_FOUND');
  });

  it('requires settings.manage to update, enforced server-side', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/restaurants/${tenant.restaurantId}`,
      headers: bearer(cashierToken),
      payload: { nameEn: 'Hacked' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json<ApiErrorBody>();
    expect(body.code).toBe('INSUFFICIENT_PERMISSION');
    expect(body.details.missing).toEqual(['settings.manage']);
  });

  it('updates and audits with actor, request id and before/after values', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/restaurants/${tenant.restaurantId}`,
      headers: { ...bearer(ownerToken), 'x-request-id': 'audit-req-0001' },
      payload: { nameEn: 'Renamed', timezone: 'Asia/Dubai' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Restaurant>().timezone).toBe('Asia/Dubai');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'restaurant.updated' },
    });
    expect(audit.actorId).toBe(tenant.owner.id);
    expect(audit.requestId).toBe('audit-req-0001');
    expect(audit.source).toBe('ADMIN');
    expect(audit.metadata).toMatchObject({
      changes: { nameEn: 'Renamed' },
      before: { nameEn: 'Test Restaurant' },
    });
  });

  it('does not allow changing the currency', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/restaurants/${tenant.restaurantId}`,
      headers: bearer(ownerToken),
      payload: { currencyCode: 'USD' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('locations', () => {
  it('lists every location for restaurant-wide roles and only assigned ones otherwise', async () => {
    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/restaurants/${tenant.restaurantId}/locations`,
      headers: bearer(ownerToken),
    });
    expect(all.json<Location[]>()).toHaveLength(2);

    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/restaurants/${tenant.restaurantId}/locations`,
      headers: bearer(cashierToken),
    });
    expect(mine.json<Location[]>().map((l) => l.id)).toEqual([tenant.locationA]);
  });

  it('scopes location access to role assignments', async () => {
    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}`,
      headers: bearer(cashierToken),
    });
    expect(own.statusCode).toBe(200);

    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationB}`,
      headers: bearer(cashierToken),
    });
    expect(other.statusCode).toBe(404);
    expect(other.json<ApiErrorBody>().code).toBe('LOCATION_NOT_FOUND');
  });

  it('treats malformed and foreign ids as not found', async () => {
    for (const id of ['not-a-uuid', newId()]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/locations/${id}`,
        headers: bearer(ownerToken),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('creates a location with validation, audit and unique codes', async () => {
    const payload = {
      code: 'jed1',
      nameEn: 'Jeddah',
      nameAr: 'جدة',
      timezone: 'Asia/Riyadh',
      taxInclusive: false,
    };
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/restaurants/${tenant.restaurantId}/locations`,
      headers: bearer(ownerToken),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const location = created.json<Location>();
    expect(location.code).toBe('JED1');
    expect(location.onlineOrderingState).toBe('CLOSED');
    expect(
      await prisma.auditLog.count({ where: { action: 'location.created', entityId: location.id } }),
    ).toBe(1);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/restaurants/${tenant.restaurantId}/locations`,
      headers: bearer(ownerToken),
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<ApiErrorBody>().code).toBe('CONFLICT');

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/restaurants/${tenant.restaurantId}/locations`,
      headers: bearer(ownerToken),
      payload: { ...payload, code: 'x', timezone: 'Nowhere/Land' },
    });
    expect(invalid.statusCode).toBe(400);
    const issues = invalid.json<ApiErrorBody>().details.issues as { path: string[] }[];
    expect(issues.map((i) => i.path[0]).sort()).toEqual(['code', 'timezone']);
  });

  it('lets a location-scoped manager edit only their location', async () => {
    const manager = await createTenant(prisma, ['settings.manage', 'locations.view']);
    const token = await login(app, manager.cashier.email);
    const own = await app.inject({
      method: 'PATCH',
      url: `/api/v1/locations/${manager.locationA}`,
      headers: bearer(token),
      payload: { phone: '+966500000000' },
    });
    expect(own.statusCode).toBe(200);
    const restaurantWide = await app.inject({
      method: 'POST',
      url: `/api/v1/restaurants/${manager.restaurantId}/locations`,
      headers: bearer(token),
      payload: { code: 'NEW1', nameEn: 'n', nameAr: 'n', timezone: 'UTC', taxInclusive: true },
    });
    expect(restaurantWide.statusCode).toBe(403);
  });
});
