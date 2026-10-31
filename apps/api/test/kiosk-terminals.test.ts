import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import { hashPairingCode } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import {
  type AdminDevice,
  type LocationSnapshot,
  type PairedDevice,
  type PairingCode,
  type SyncDevice,
  type SyncOperationResult,
  type SyncOrder,
  type SyncPullResponse,
  type SyncPushResponse,
  pairTerminalSchema,
  syncDeviceSchema,
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

/**
 * The cloud's share of self-service kiosks (ADR 0022): terminals created with a one-time pairing
 * code, the code travelling to the hub with the snapshot, the hub's report of the pairing, and the
 * kiosk's orders and drawer-less card payments arriving through the outbox.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;
let hub: Record<string, string>;
let builders: ReturnType<typeof syncBuilders>;
let cardMethodId: string;

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
  const menu = await createMenuFixture(prisma, tenant);
  const cash = await prisma.paymentMethod.create({
    data: { tenantId: tenant.tenantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
  });
  cardMethodId = (
    await prisma.paymentMethod.create({
      data: { tenantId: tenant.tenantId, type: 'CARD', nameEn: 'Card', nameAr: 'بطاقة' },
    })
  ).id;
  const register = await prisma.cashRegister.create({
    data: { locationId: tenant.locationA, nameEn: 'Drawer', nameAr: 'الدرج' },
  });
  builders = syncBuilders({ tenant, menu, cashMethodId: cash.id, registerId: register.id });
  owner = bearer(await login(app, tenant.owner.email));
  const paired = (await create('Main hub', 'GATEWAY')).json<PairedDevice>();
  hub = { authorization: `Device ${paired.credential ?? ''}` };
});

const devicesUrl = (locationId = tenant.locationA) => `/api/v1/locations/${locationId}/devices`;

const create = (name: string, type: string, locationId = tenant.locationA) =>
  app.inject({
    method: 'POST',
    url: devicesUrl(locationId),
    headers: owner,
    payload: { name, type },
  });

async function kiosk(locationId = tenant.locationA): Promise<PairedDevice> {
  const res = await create('Kiosk 1', 'KIOSK', locationId);
  expect(res.statusCode).toBe(201);
  return res.json<PairedDevice>();
}

async function push(operations: unknown[]): Promise<SyncOperationResult[]> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: hub,
    payload: { operations },
  });
  expect(res.statusCode).toBe(200);
  return res.json<SyncPushResponse>().results;
}

const report = (id: string, overrides: Partial<SyncDevice> = {}): SyncDevice => ({
  id,
  tenantId: tenant.tenantId,
  locationId: tenant.locationA,
  type: 'KIOSK',
  status: 'ACTIVE',
  pairedAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  appVersion: '1.0.0',
  ...overrides,
});

describe('terminals waiting for their hub', () => {
  it('creates a kiosk with a one-time pairing code instead of a credential', async () => {
    const created = await kiosk();
    expect(created.device).toMatchObject({ type: 'KIOSK', status: 'PENDING', pairedAt: null });
    expect(created.credential).toBeNull();
    expect(created.pairing?.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } });
    // Stored as the hash of what the kiosk sends (spaces, dashes and case ignored).
    const typed = pairTerminalSchema.parse({ code: created.pairing?.code.toLowerCase() }).code;
    expect(row.pairingCodeHash).toBe(hashPairingCode(typed));
    expect(row.credentialHash).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: 'device.created', entityId: row.id } }),
    ).toBe(1);

    const listed = (await app.inject({ method: 'GET', url: devicesUrl(), headers: owner })).json<
      AdminDevice[]
    >();
    const shown = listed.find((d) => d.id === row.id);
    expect(shown).toMatchObject({ status: 'PENDING', online: false, appVersion: null });
    expect(shown?.pairingExpiresAt).toBe(created.pairing?.expiresAt);
    expect(JSON.stringify(listed)).not.toMatch(/pairingCodeHash|credentialHash/);
  });

  it('renews the code of a terminal not paired yet, and of nothing else', async () => {
    const created = await kiosk();
    const renewed = await app.inject({
      method: 'POST',
      url: `${devicesUrl()}/${created.device.id}/pairing-code`,
      headers: owner,
    });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json<PairingCode>().code).not.toBe(created.pairing?.code);
    const gateway = await prisma.device.findFirstOrThrow({ where: { type: 'GATEWAY' } });
    const refused = await app.inject({
      method: 'POST',
      url: `${devicesUrl()}/${gateway.id}/pairing-code`,
      headers: owner,
    });
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'NOT_PENDING' },
    });
    // Another location's device is not found through this location.
    const elsewhere = await app.inject({
      method: 'POST',
      url: `${devicesUrl(tenant.locationB)}/${created.device.id}/pairing-code`,
      headers: owner,
    });
    expect(elsewhere.statusCode).toBe(404);
  });

  it('sends the hub its waiting terminals with the code hash and expiry, never a credential', async () => {
    const created = await kiosk();
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/snapshot', headers: hub });
    const body = res.json<LocationSnapshot>();
    expect(body.format).toBe(9);
    const row = body.tables.devices.find((d) => d.id === created.device.id);
    expect(row).toMatchObject({ status: 'PENDING', type: 'KIOSK' });
    expect(row?.pairingCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.pairingExpiresAt).toBe(created.pairing?.expiresAt);
    expect(body.tables.devices.every((d) => !('credentialHash' in d))).toBe(true);
  });

  it('tells the hub when a terminal is added or disabled, not when it is merely seen', async () => {
    const pull = async (cursor: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/sync/pull?${cursor ? `cursor=${cursor}` : ''}`,
          headers: hub,
        })
      ).json<SyncPullResponse>();
    const { cursor } = await pull('');
    const created = await kiosk();
    const added = await pull(cursor);
    expect(added.changes.map((c) => c.topic)).toEqual(['CONFIG']);
    await prisma.device.update({
      where: { id: created.device.id },
      data: {
        lastSeenAt: new Date(),
        appVersion: '1.0.1',
        lastVersionAt: new Date(),
        metadata: { ip: '10.0.0.9' },
      },
    });
    expect((await pull(added.cursor)).changes).toEqual([]);
    await app.inject({
      method: 'POST',
      url: `${devicesUrl()}/${created.device.id}/disable`,
      headers: owner,
    });
    expect((await pull(added.cursor)).changes.map((c) => c.topic)).toEqual(['CONFIG']);
  });
});

describe("the hub's report of its terminals", () => {
  it('takes the pairing, the last contact and the version; the code is spent', async () => {
    const created = await kiosk();
    const pairedAt = new Date(Date.now() - 60_000).toISOString();
    const results = await push([
      op('Device', report(created.device.id, { pairedAt, appVersion: '1.0.0' }), 1),
    ]);
    expect(results.map((r) => r.status)).toEqual(['APPLIED']);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } });
    expect(row).toMatchObject({
      status: 'ACTIVE',
      pairedAt: new Date(pairedAt),
      appVersion: '1.0.0',
      pairingCodeHash: null,
      pairingExpiresAt: null,
    });
    // A later, older report never moves the last contact back.
    const lastSeen = row.lastSeenAt;
    await push([
      op(
        'Device',
        report(created.device.id, { lastSeenAt: new Date(0).toISOString(), appVersion: '1.1.0' }),
        2,
      ),
    ]);
    const after = await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } });
    expect(after.lastSeenAt).toEqual(lastSeen);
    expect(after.appVersion).toBe('1.1.0');
  });

  it('keeps when the terminal started running its version (ADR 0026)', async () => {
    const created = await kiosk();
    const since = new Date(Date.now() - 3_600_000).toISOString();
    await push([
      op('Device', report(created.device.id, { appVersion: '1.0.0', lastVersionAt: since }), 1),
    ]);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } });
    expect(row).toMatchObject({ appVersion: '1.0.0', lastVersionAt: new Date(since) });
    // The same version reported again keeps its date; a new one takes the report's.
    await push([op('Device', report(created.device.id, { appVersion: '1.0.0' }), 2)]);
    expect(
      (await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } })).lastVersionAt,
    ).toEqual(new Date(since));
    const updated = new Date().toISOString();
    await push([
      op('Device', report(created.device.id, { appVersion: '1.1.0', lastVersionAt: updated }), 3),
    ]);
    expect(
      await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } }),
    ).toMatchObject({ appVersion: '1.1.0', lastVersionAt: new Date(updated) });
    // The admin portal shows both.
    const listed = (await app.inject({ method: 'GET', url: devicesUrl(), headers: owner })).json<
      AdminDevice[]
    >();
    expect(listed.find((d) => d.id === created.device.id)).toMatchObject({
      appVersion: '1.1.0',
      lastVersionAt: updated,
    });
  });

  it('never brings back a terminal an administrator disabled', async () => {
    const created = await kiosk();
    await app.inject({
      method: 'POST',
      url: `${devicesUrl()}/${created.device.id}/disable`,
      headers: owner,
    });
    expect((await push([op('Device', report(created.device.id), 1)]))[0]?.status).toBe('APPLIED');
    const row = await prisma.device.findUniqueOrThrow({ where: { id: created.device.id } });
    expect(row.status).toBe('DISABLED');
  });

  it("refuses a report about another location's terminal, or about a hub", async () => {
    const other = await kiosk(tenant.locationB);
    const gateway = await prisma.device.findFirstOrThrow({ where: { type: 'GATEWAY' } });
    const results = await push([
      op('Device', report(other.device.id), 1),
      op('Device', report(gateway.id, { type: 'GATEWAY' }), 1),
    ]);
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['REJECTED', 'SYNC_SCOPE_MISMATCH'],
      ['REJECTED', 'SYNC_REJECTED'],
    ]);
  });

  it('carries no credential or pairing code (the report is a subset of the row)', () => {
    expect(Object.keys(syncDeviceSchema.shape).sort()).toEqual([
      'appVersion',
      'id',
      'lastSeenAt',
      'lastVersionAt',
      'locationId',
      'pairedAt',
      'status',
      'tenantId',
      'type',
    ]);
  });
});

describe("a kiosk's orders in the cloud", () => {
  /** A kiosk order paid at the kiosk's own card terminal, as the hub's outbox carries it. */
  function kioskOrder(deviceId: string | null): SyncOrder {
    const order = builders.orderRow({
      channel: 'KIOSK',
      source: 'KIOSK',
      tableId: null,
      guestCount: null,
      createdById: null,
      paymentStatus: 'PAID',
    });
    const at = builders.now();
    return {
      ...order,
      statusHistory: order.statusHistory.map((h) => ({
        ...h,
        actorType: 'DEVICE' as const,
        actorId: deviceId,
        source: 'KIOSK' as const,
      })),
      payments: [
        {
          id: newId(),
          tenantId: order.tenantId,
          locationId: order.locationId,
          orderId: order.id,
          providerAccountId: null,
          shiftId: null,
          deviceId,
          paymentMethodId: cardMethodId,
          methodType: 'CARD',
          methodNameEn: 'Card',
          methodNameAr: 'بطاقة',
          type: 'CHARGE',
          status: 'CAPTURED',
          provider: 'mock-terminal',
          providerRef: 'mockterm_1',
          amount: order.total,
          tendered: null,
          change: 0,
          roundingAdjustment: 0,
          reference: 'MT123456',
          refundOfId: null,
          reason: null,
          createdById: null,
          createdAt: at,
          updatedAt: at,
          cash: [],
        },
      ],
    };
  }

  it('stores a kiosk order with its drawer-less card payment, naming the kiosk', async () => {
    const created = await kiosk();
    const order = kioskOrder(created.device.id);
    expect((await push([op('Order', order, 1)]))[0]?.status).toBe('APPLIED');
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(stored).toMatchObject({ channel: 'KIOSK', source: 'KIOSK', paymentStatus: 'PAID' });
    expect(stored.payments).toMatchObject([
      { shiftId: null, deviceId: created.device.id, methodType: 'CARD', provider: 'mock-terminal' },
    ]);
  });

  it('keeps the database rule: a card payment without a shift needs its device', async () => {
    const results = await push([op('Order', kioskOrder(null), 1)]);
    expect(results.map((r) => [r.status, r.code])).toEqual([['REJECTED', 'SYNC_REJECTED']]);
    await expect(prisma.payment.count()).resolves.toBe(0);
  });

  it("refuses a payment naming another location's device", async () => {
    const other = await kiosk(tenant.locationB);
    const results = await push([op('Order', kioskOrder(other.device.id), 1)]);
    expect(results.map((r) => [r.status, r.code])).toEqual([['REJECTED', 'SYNC_SCOPE_MISMATCH']]);
  });

  it('lets no one but a kiosk create KIOSK orders', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: owner,
      payload: { id: newId(), channel: 'KIOSK', items: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().code).toBe('VALIDATION_FAILED');
  });
});
