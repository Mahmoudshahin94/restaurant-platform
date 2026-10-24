import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import type { ApiErrorBody } from '@pos/shared-types';
import type { Device, LocationSnapshot, PairedDevice } from '@pos/validation';
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
let owner: Record<string, string>;
let menu: Awaited<ReturnType<typeof createMenuFixture>>;

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
  owner = bearer(await login(app, tenant.owner.email));
});

const devicesUrl = (locationId = tenant.locationA) => `/api/v1/locations/${locationId}/devices`;

async function pair(name = 'Main hub'): Promise<PairedDevice & { credential: string }> {
  const res = await app.inject({
    method: 'POST',
    url: devicesUrl(),
    headers: owner,
    payload: { name, type: 'GATEWAY' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<PairedDevice & { credential: string }>();
}

const snapshot = (credential: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/sync/snapshot',
    headers: { authorization: `Device ${credential}`, ...headers },
  });

describe('pairing a location hub', () => {
  it('issues a one-time credential to devices.manage and stores only its hash', async () => {
    const paired = await pair();
    expect(paired.device).toMatchObject({ type: 'GATEWAY', status: 'ACTIVE', name: 'Main hub' });
    expect(paired.pairing).toBeNull();
    const [deviceId, secret] = paired.credential.split('.');
    expect(deviceId).toBe(paired.device.id);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: paired.device.id } });
    expect(row.credentialHash).not.toContain(secret);
    expect(
      await prisma.auditLog.count({ where: { action: 'device.paired', entityId: deviceId } }),
    ).toBe(1);

    const listed = await app.inject({ method: 'GET', url: devicesUrl(), headers: owner });
    expect(listed.json<Device[]>().map((d) => d.id)).toEqual([paired.device.id]);
    expect(JSON.stringify(listed.json())).not.toContain('credential');

    const cashier = bearer(await login(app, tenant.cashier.email));
    const denied = await app.inject({
      method: 'POST',
      url: devicesUrl(),
      headers: cashier,
      payload: { name: 'x', type: 'GATEWAY' },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('location snapshot', () => {
  it('gives the hub its own location with catalog, floor and staff', async () => {
    const paired = await pair();
    const res = await snapshot(paired.credential);
    expect(res.statusCode).toBe(200);
    const body = res.json<LocationSnapshot>();
    expect(body).toMatchObject({
      format: 6,
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
    });
    const { tables } = body;
    expect(tables.locations.map((l) => l.id)).toEqual([tenant.locationA]);
    expect(tables.products.map((p) => p.nameEn).sort()).toEqual(['Burger', 'Cola']);
    expect(tables.productStations).toHaveLength(1);
    expect(tables.diningTables.map((t) => t.label).sort()).toEqual(['T1', 'T2']);
    expect(tables.taxes.map((t) => t.id)).toEqual([menu.vat.id]);
    // Staff of this location (and tenant-wide) with their hashes, for offline sign-in.
    const emails = tables.users.map((u) => u.email).sort();
    expect(emails).toEqual([tenant.cashier.email, tenant.owner.email].sort());
    expect(tables.users.every((u) => typeof u.passwordHash === 'string')).toBe(true);
    expect(
      tables.userRoles.every((r) => r.locationId === null || r.locationId === tenant.locationA),
    ).toBe(true);
  });

  it('leaves out other locations and staff who only work there', async () => {
    const other = await prisma.user.create({
      data: {
        tenantId: tenant.tenantId,
        email: `b-only-${Date.now()}@test.local`,
        passwordHash: 'x',
        displayName: 'B only',
        roles: {
          create: {
            roleId: (await prisma.role.findFirstOrThrow({ where: { name: 'Cashier' } })).id,
            locationId: tenant.locationB,
          },
        },
      },
    });
    const body = (await snapshot((await pair()).credential)).json<LocationSnapshot>();
    expect(body.tables.users.some((u) => u.id === other.id)).toBe(false);
    expect(body.tables.locations.some((l) => l.id === tenant.locationB)).toBe(false);
  });

  it('includes the location’s recent order counters, so a hub paired mid-day continues them', async () => {
    const { credential } = await pair();
    const today = new Date(new Date().toISOString().slice(0, 10));
    const old = new Date(today.getTime() - 10 * 24 * 60 * 60_000);
    await prisma.orderCounter.createMany({
      data: [
        { locationId: tenant.locationA, businessDate: today, lastNumber: 41 },
        { locationId: tenant.locationA, businessDate: old, lastNumber: 90 },
        { locationId: tenant.locationB, businessDate: today, lastNumber: 7 },
      ],
    });
    const body = (await snapshot(credential)).json<LocationSnapshot>();
    expect(body.tables.orderCounters).toEqual([
      { locationId: tenant.locationA, businessDate: today.toISOString(), lastNumber: 41 },
    ]);
  });

  it('answers 304 when the hub already has the current version', async () => {
    const { credential } = await pair();
    const first = await snapshot(credential);
    const etag = first.headers.etag as string;
    expect((await snapshot(credential, { 'if-none-match': etag })).statusCode).toBe(304);
    await prisma.product.update({ where: { id: menu.cola.id }, data: { price: 700 } });
    expect((await snapshot(credential, { 'if-none-match': etag })).statusCode).toBe(200);
  });

  it('rejects missing, wrong and revoked credentials and staff tokens', async () => {
    const { device, credential } = await pair();
    expect((await snapshot('nonsense')).statusCode).toBe(401);
    expect((await snapshot(`${device.id}.wrong-secret`)).statusCode).toBe(401);
    const staff = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/snapshot',
      headers: owner,
    });
    expect(staff.statusCode).toBe(401);

    const disabled = await app.inject({
      method: 'POST',
      url: `${devicesUrl()}/${device.id}/disable`,
      headers: owner,
    });
    expect(disabled.json<Device>().status).toBe('DISABLED');
    const revoked = await snapshot(credential);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json<ApiErrorBody>().code).toBe('UNAUTHENTICATED');
  });
});
