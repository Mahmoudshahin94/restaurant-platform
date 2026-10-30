import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import { FeatureService, TenantContext } from '@pos/server';
import type { ApiErrorBody, Feature, FeatureSetting, ResolvedFeatures } from '@pos/shared-types';
import type { Order, PublishedMenu, TenantContextDto } from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotService } from '../src/modules/sync/snapshot.service';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';

/**
 * Modules (ADR 0018): the layers and their precedence, the platform's entitlement ceiling, the
 * Modules API, the tenant context the apps read, the change feed and snapshot that take modules to
 * the hubs, and the behaviour that follows capabilities (kitchen tickets, tables, modifiers).
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;

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
  owner = bearer(await login(app, tenant.owner.email));
});

const featuresUrl = (feature?: Feature, query = '') =>
  `/api/v1/tenants/${tenant.tenantId}/features${feature ? `/${feature}` : ''}${query}`;

async function setOverride(
  feature: Feature,
  enabled: boolean | null,
  scope: { locationId?: string; deviceId?: string } = {},
) {
  return app.inject({
    method: 'PUT',
    url: featuresUrl(feature),
    headers: owner,
    payload: { enabled, ...scope },
  });
}

async function context(locationId?: string, headers = owner): Promise<TenantContextDto> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/tenants/${tenant.tenantId}/context${locationId ? `?locationId=${locationId}` : ''}`,
    headers,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TenantContextDto>();
}

const rowOf = (rows: FeatureSetting[], feature: Feature) =>
  rows.find((r) => r.feature === feature)!;

describe('tenant context', () => {
  it('gives every member the business type defaults, currency and locales', async () => {
    const cashier = bearer(await login(app, tenant.cashier.email));
    const body = await context(tenant.locationA, cashier);
    expect(body).toMatchObject({
      tenant: { id: tenant.tenantId, businessType: 'RESTAURANT', status: 'ACTIVE' },
      currency: { code: 'SAR', decimalPlaces: 2, symbol: null, display: 'narrowSymbol' },
      locales: { default: 'en', supported: ['en', 'ar'], digits: 'latn' },
      locationId: tenant.locationA,
    });
    expect(body.features.KDS).toEqual({
      feature: 'KDS',
      enabled: true,
      source: 'BUSINESS_TYPE',
      entitled: true,
      configurable: true,
    });
    expect(body.features.INVENTORY).toMatchObject({ enabled: false, source: 'PLATFORM' });
  });

  it('follows the business type: a supermarket has barcodes and no kitchen', async () => {
    await prisma.tenant.update({
      where: { id: tenant.tenantId },
      data: { businessType: 'SUPERMARKET' },
    });
    const { features } = await context();
    expect(features.BARCODE.enabled).toBe(true);
    expect(features.KDS.enabled).toBe(false);
    expect(features.TABLES.enabled).toBe(false);
  });

  it('refuses another tenant and a location of another tenant', async () => {
    const other = await createTenant(prisma);
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${other.tenantId}/context`,
      headers: owner,
    });
    expect(foreign.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
    const foreignLocation = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenant.tenantId}/context?locationId=${other.locationA}`,
      headers: owner,
    });
    expect(foreignLocation.json<ApiErrorBody>().code).toBe('LOCATION_NOT_FOUND');
  });
});

describe('overrides and their precedence', () => {
  it('lets the tenant, then a location, then a device decide', async () => {
    expect((await setOverride('KDS', false)).statusCode).toBe(200);
    expect((await context()).features.KDS).toMatchObject({ enabled: false, source: 'TENANT' });
    // Location A turns it back on; location B inherits the tenant's choice.
    const atA = await setOverride('KDS', true, { locationId: tenant.locationA });
    expect(rowOf(atA.json<FeatureSetting[]>(), 'KDS')).toMatchObject({
      enabled: true,
      source: 'LOCATION',
      override: true,
      inherited: { enabled: false, source: 'TENANT' },
    });
    expect((await context(tenant.locationA)).features.KDS.enabled).toBe(true);
    expect((await context(tenant.locationB)).features.KDS).toMatchObject({
      enabled: false,
      source: 'TENANT',
    });

    // One screen at location A goes without.
    const device = await prisma.device.create({
      data: { tenantId: tenant.tenantId, locationId: tenant.locationA, name: 'Bar', type: 'KDS' },
    });
    const onDevice = await setOverride('KDS', false, { deviceId: device.id });
    expect(rowOf(onDevice.json<FeatureSetting[]>(), 'KDS')).toMatchObject({
      enabled: false,
      source: 'DEVICE',
      inherited: { enabled: true, source: 'LOCATION' },
    });
    const features = app.get(FeatureService);
    const scope = { tenantId: tenant.tenantId, locationId: tenant.locationA };
    const resolve = (deviceId?: string) =>
      TenantContext.runInTenant(tenant.tenantId, () =>
        features.resolve({ ...scope, deviceId: deviceId ?? null }),
      );
    expect((await resolve(device.id)).KDS.source).toBe('DEVICE');
    expect((await resolve()).KDS).toMatchObject({ enabled: true, source: 'LOCATION' });
  });

  it('inherits again when an override is removed, and audits each change', async () => {
    await setOverride('TABLES', false);
    const cleared = await setOverride('TABLES', null);
    expect(rowOf(cleared.json<FeatureSetting[]>(), 'TABLES')).toMatchObject({
      enabled: true,
      source: 'BUSINESS_TYPE',
      override: null,
    });
    expect(await prisma.featureOverride.count()).toBe(0);
    const audits = await prisma.auditLog.findMany({
      where: { action: 'feature.override_changed' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ feature: 'TABLES', layer: 'TENANT', from: null, to: false }),
      expect.objectContaining({ feature: 'TABLES', layer: 'TENANT', from: false, to: null }),
    ]);
  });

  it('checks the module, the scope and the permission', async () => {
    const unknown = await app.inject({
      method: 'PUT',
      url: featuresUrl('TELEPORTER' as Feature),
      headers: owner,
      payload: { enabled: true },
    });
    expect(unknown.statusCode).toBe(400);
    const other = await createTenant(prisma);
    expect(
      (await setOverride('KDS', false, { locationId: other.locationA })).json<ApiErrorBody>().code,
    ).toBe('LOCATION_NOT_FOUND');
    const cashier = bearer(await login(app, tenant.cashier.email));
    const list = await app.inject({ method: 'GET', url: featuresUrl(), headers: cashier });
    expect(list.json<ApiErrorBody>().code).toBe('INSUFFICIENT_PERMISSION');
  });
});

describe('the platform entitlement', () => {
  it('caps every layer: a module outside the plan is off and cannot be switched', async () => {
    await setOverride('KDS', true, { locationId: tenant.locationA });
    await prisma.tenantEntitlement.create({
      data: {
        tenantId: tenant.tenantId,
        feature: 'KDS',
        entitled: false,
        tenantConfigurable: true,
      },
    });
    expect((await context(tenant.locationA)).features.KDS).toEqual({
      feature: 'KDS',
      enabled: false,
      source: 'PLATFORM',
      entitled: false,
      configurable: true,
    });
    const refused = await setOverride('KDS', true);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'FEATURE_NOT_CONFIGURABLE',
      details: { feature: 'KDS', reason: 'NOT_ENTITLED' },
    });
    // The kitchen's routes follow the ceiling.
    const tickets = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/kitchen/tickets`,
      headers: owner,
    });
    expect(tickets.json<ApiErrorBody>().code).toBe('FEATURE_DISABLED');
  });

  it('keeps a module the platform manages out of the tenant’s hands', async () => {
    await setOverride('TABLES', false);
    await prisma.tenantEntitlement.create({
      data: {
        tenantId: tenant.tenantId,
        feature: 'TABLES',
        entitled: true,
        tenantConfigurable: false,
      },
    });
    // The tenant's earlier override no longer counts.
    expect((await context()).features.TABLES).toMatchObject({
      enabled: true,
      source: 'BUSINESS_TYPE',
      configurable: false,
    });
    const refused = await setOverride('TABLES', null);
    expect(refused.json<ApiErrorBody>().details).toMatchObject({ reason: 'PLATFORM_MANAGED' });
  });
});

describe('modules reach the location hubs', () => {
  it('records a CONFIG change for entitlements and overrides', async () => {
    const changes = () =>
      prisma.changeLog.count({ where: { tenantId: tenant.tenantId, topic: 'CONFIG' } });
    let before = await changes();
    await setOverride('KDS', false, { locationId: tenant.locationA });
    expect(await changes()).toBe(before + 1);
    before = await changes();
    await prisma.tenantEntitlement.create({
      data: {
        tenantId: tenant.tenantId,
        feature: 'LOYALTY',
        entitled: false,
        tenantConfigurable: false,
      },
    });
    expect(await changes()).toBe(before + 1);
  });

  it('puts the tenant’s, the location’s and its devices’ overrides in the snapshot', async () => {
    const device = await prisma.device.create({
      data: {
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        name: 'Hub',
        type: 'GATEWAY',
        credentialHash: 'secret-hash',
      },
    });
    await setOverride('MODIFIERS', false);
    await setOverride('KDS', false, { locationId: tenant.locationA });
    await setOverride('TABLES', false, { locationId: tenant.locationB });
    await setOverride('LOYALTY', true, { deviceId: device.id });
    await prisma.tenantEntitlement.create({
      data: {
        tenantId: tenant.tenantId,
        feature: 'DELIVERY',
        entitled: false,
        tenantConfigurable: false,
      },
    });
    const snapshot = await TenantContext.runInTenant(tenant.tenantId, () =>
      app.get(SnapshotService).build({
        id: device.id,
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
      }),
    );
    expect(snapshot.format).toBe(8);
    expect(snapshot.tables.featureOverrides.map((o) => o.feature).sort()).toEqual([
      'KDS',
      'LOYALTY',
      'MODIFIERS',
    ]);
    expect(snapshot.tables.tenantEntitlements).toEqual([
      expect.objectContaining({ feature: 'DELIVERY', entitled: false }),
    ]);
    // The device row names it, but carries no credential.
    expect(snapshot.tables.devices).toHaveLength(1);
    expect(snapshot.tables.devices[0]).toMatchObject({ id: device.id, type: 'GATEWAY' });
    expect(snapshot.tables.devices[0]).not.toHaveProperty('credentialHash');
  });
});

describe('behaviour that follows capabilities', () => {
  let menu: Awaited<ReturnType<typeof createMenuFixture>>;
  beforeEach(async () => {
    menu = await createMenuFixture(prisma, tenant);
  });

  const placeOrder = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: owner,
      payload: { id: newId(), channel: 'TAKEAWAY', ...payload },
    });
  const transition = (order: Order, to: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/orders/${order.id}/transitions`,
      headers: owner,
      payload: { to, version: order.version },
    });

  it('without KDS, confirmed orders make no kitchen tickets and are handed over directly', async () => {
    await setOverride('KDS', false, { locationId: tenant.locationA });
    const res = await placeOrder({ status: 'CONFIRMED', items: [menu.burgerLine()] });
    expect(res.statusCode).toBe(201);
    const order = res.json<Order>();
    expect(order.tickets).toEqual([]);
    expect(await prisma.kitchenTicket.count()).toBe(0);
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
    expect((await transition(order, 'COMPLETED')).statusCode).toBe(200);

    // With the module on, the same order goes to the grill and waits for it.
    await setOverride('KDS', null, { locationId: tenant.locationA });
    const kitchen = (
      await placeOrder({ status: 'CONFIRMED', items: [menu.burgerLine()] })
    ).json<Order>();
    expect(kitchen.tickets).toHaveLength(1);
    await prisma.order.update({ where: { id: kitchen.id }, data: { paymentStatus: 'PAID' } });
    const waiting = await transition(kitchen, 'COMPLETED');
    expect(waiting.json<ApiErrorBody>().details).toMatchObject({ reason: 'KITCHEN_PENDING' });
  });

  it('without TABLES, dine-in needs no table and cannot name one', async () => {
    const withTables = await placeOrder({ channel: 'DINE_IN', items: [menu.burgerLine()] });
    expect(withTables.json<ApiErrorBody>()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: ['tableId'] }] },
    });
    await setOverride('TABLES', false);
    const noTable = await placeOrder({
      channel: 'DINE_IN',
      guestCount: 2,
      items: [menu.burgerLine()],
    });
    expect(noTable.statusCode).toBe(201);
    expect(noTable.json<Order>()).toMatchObject({ channel: 'DINE_IN', tableId: null });
    const named = await placeOrder({
      channel: 'DINE_IN',
      tableId: menu.tables[0]!.id,
      items: [menu.burgerLine()],
    });
    expect(named.json<ApiErrorBody>()).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { feature: 'TABLES' },
    });
  });

  it('lets an order seated before TABLES was switched off keep its table when edited', async () => {
    const seated = (
      await placeOrder({
        channel: 'DINE_IN',
        tableId: menu.tables[0]!.id,
        items: [menu.burgerLine()],
      })
    ).json<Order>();
    await setOverride('TABLES', false);
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/locations/${tenant.locationA}/orders/${seated.id}`,
      headers: owner,
      payload: {
        version: seated.version,
        channel: 'DINE_IN',
        tableId: seated.tableId,
        items: [menu.burgerLine(2)],
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json<Order>().tableId).toBe(seated.tableId);
  });

  it('without MODIFIERS, the published menu has no modifier groups and orders none', async () => {
    const menuOf = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/locations/${tenant.locationA}/menu`,
          headers: owner,
        })
      ).json<PublishedMenu>();
    const burgerOf = (published: PublishedMenu) =>
      published.categories.flatMap((c) => c.products).find((p) => p.id === menu.burger.id)!;
    const before = await menuOf();
    expect(burgerOf(before).modifierGroups).toHaveLength(2);

    await setOverride('MODIFIERS', false, { locationId: tenant.locationA });
    const after = await menuOf();
    expect(burgerOf(after).modifierGroups).toEqual([]);
    expect(after.version).not.toBe(before.version);
    const plain = await placeOrder({
      items: [{ id: newId(), productId: menu.burger.id, quantity: 1 }],
    });
    expect(plain.statusCode).toBe(201);
    const withCheese = await placeOrder({ items: [menu.burgerLine()] });
    expect(withCheese.json<ApiErrorBody>().code).toBe('INVALID_MODIFIER_SELECTION');
  });
});

describe('per-request resolution', () => {
  it('reads the database once per scope within a request', async () => {
    const features = app.get(FeatureService);
    const memo = new Map<string, unknown>();
    const scope = { tenantId: tenant.tenantId, locationId: tenant.locationA };
    const [a, b] = await TenantContext.runInTenant(tenant.tenantId, () =>
      Promise.all([features.resolve(scope, { memo }), features.resolve(scope, { memo })]),
    );
    expect(a).toBe(b);
    expect(memo.size).toBe(1);
    // A fresh read sees a change made since.
    await setOverride('KDS', false);
    const fresh: ResolvedFeatures = await TenantContext.runInTenant(tenant.tenantId, () =>
      features.resolve(scope, { memo: null }),
    );
    expect(fresh.KDS.enabled).toBe(false);
  });
});
