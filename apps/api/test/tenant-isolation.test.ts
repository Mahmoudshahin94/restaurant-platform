import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient, provisionTenant } from '@pos/database';
import { newId } from '@pos/domain';
import {
  PrismaService,
  TENANT_FILE_STORAGE,
  TenantContext,
  TenantFileExistsError,
  TenantFileScopeError,
  type TenantFileStorage,
  TenantScopeError,
} from '@pos/server';
import { PERMISSIONS, type ApiErrorBody } from '@pos/shared-types';
import type { DailySalesReport, Order, TenantFileDto } from '@pos/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { ICO, PNG } from './image-fixture';
import { createMenuFixture } from './menu-fixture';
import { reportSeeder } from './report-fixture';

/**
 * Tenant isolation (ADR 0017), on top of the every-route checks in security.test.ts: two tenants
 * holding the same kind of data, and tenant A trying to read, list, change or reference tenant B's
 * through its own routes — the case a route guard alone cannot see. Then the tenant-scoped client
 * itself, which every service uses, against PostgreSQL.
 */

let app: NestFastifyApplication;
let prisma: PrismaClient;
let a: TenantFixture;
let b: TenantFixture;
let menuA: Awaited<ReturnType<typeof createMenuFixture>>;
let menuB: Awaited<ReturnType<typeof createMenuFixture>>;
let ownerA: Record<string, string>;
let ownerB: Record<string, string>;
let orderB: Order;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
  await resetDatabase(prisma);
  a = await createTenant(prisma);
  b = await createTenant(prisma);
  menuA = await createMenuFixture(prisma, a);
  menuB = await createMenuFixture(prisma, b);
  ownerA = bearer(await login(app, a.owner.email));
  ownerB = bearer(await login(app, b.owner.email));
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/locations/${b.locationA}/orders`,
    headers: ownerB,
    payload: { id: newId(), channel: 'TAKEAWAY', items: [menuB.burgerLine()] },
  });
  orderB = res.json<Order>();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const asA = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: ownerA, ...(payload ? { payload } : {}) });

describe('tenant A cannot read tenant B', () => {
  it('does not find B’s order, product or category through A’s own routes', async () => {
    const order = await asA('GET', `/locations/${a.locationA}/orders/${orderB.id}`);
    expect(order.statusCode).toBe(404);
    expect(order.json<ApiErrorBody>().code).toBe('ORDER_NOT_FOUND');
    const product = await asA('GET', `/tenants/${a.tenantId}/products/${menuB.burger.id}`);
    expect(product.statusCode).toBe(404);
    const group = await asA(
      'GET',
      `/tenants/${a.tenantId}/modifier-groups/${menuB.medium.modifierGroupId}`,
    );
    expect(group.statusCode).toBe(404);
  });

  it('lists only A’s orders, products, staff and audit entries', async () => {
    for (const url of [
      `/tenants/${a.tenantId}/orders`,
      `/locations/${a.locationA}/orders`,
      `/tenants/${a.tenantId}/products`,
      `/tenants/${a.tenantId}/users`,
      `/tenants/${a.tenantId}/audit-logs`,
      `/locations/${a.locationA}/menu`,
    ]) {
      const res = await asA('GET', url);
      expect(res.statusCode, url).toBe(200);
      for (const foreign of [orderB.id, menuB.burger.id, b.owner.id, b.tenantId, b.locationA]) {
        expect(res.body, `${url} leaks ${foreign}`).not.toContain(foreign);
      }
    }
  });

  it('reports only A’s sales, from the same SQL over both tenants’ identical orders', async () => {
    const line = {
      product: menuA.burger,
      unitPrice: 2500,
      quantity: 1,
      taxes: [{ id: menuA.vat.id, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 }],
    };
    const day = { businessDate: '2026-10-10', at: '2026-10-10T09:00:00Z' };
    await reportSeeder(prisma, a.tenantId).order({
      ...day,
      locationId: a.locationA,
      channel: 'TAKEAWAY',
      taxInclusive: true,
      lines: [line],
    });
    for (let i = 0; i < 3; i += 1) {
      await reportSeeder(prisma, b.tenantId).order({
        ...day,
        locationId: b.locationA,
        channel: 'TAKEAWAY',
        taxInclusive: true,
        lines: [{ ...line, product: menuB.burger }],
      });
    }
    const res = await asA(
      'GET',
      `/tenants/${a.tenantId}/reports/daily-sales?from=2026-10-10&to=2026-10-10`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json<DailySalesReport>().totals).toMatchObject({ orders: 1, totalSales: 2500 });
  });
});

describe('tenant A cannot change tenant B', () => {
  it('cannot edit, archive or transition B’s rows, and B’s rows stay as they were', async () => {
    const edit = await asA('PATCH', `/tenants/${a.tenantId}/products/${menuB.burger.id}`, {
      nameEn: 'Taken over',
    });
    expect(edit.statusCode).toBe(404);
    const archive = await asA('POST', `/tenants/${a.tenantId}/products/${menuB.burger.id}/archive`);
    expect(archive.statusCode).toBe(404);
    const cancel = await asA('POST', `/locations/${a.locationA}/orders/${orderB.id}/transitions`, {
      to: 'CANCELLED',
      reason: 'Not yours',
      version: orderB.version,
    });
    expect(cancel.statusCode).toBe(404);
    const burger = await prisma.product.findUniqueOrThrow({ where: { id: menuB.burger.id } });
    expect(burger).toMatchObject({ nameEn: 'Burger', archivedAt: null });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderB.id } });
    expect(order.status).toBe(orderB.status);
  });

  it('cannot order B’s products or put rows into B with a forged tenant id', async () => {
    const res = await asA('POST', `/locations/${a.locationA}/orders`, {
      id: newId(),
      channel: 'TAKEAWAY',
      items: [{ ...menuB.burgerLine(), productId: menuB.burger.id }],
    });
    // B's product does not exist for A: the same answer as an unknown product.
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('PRODUCT_NOT_FOUND');
    const created = await asA('POST', `/tenants/${a.tenantId}/categories`, {
      nameEn: 'Mine',
      nameAr: 'لي',
      tenantId: b.tenantId,
    });
    expect(created.statusCode).toBe(201);
    const row = await prisma.category.findFirstOrThrow({ where: { nameEn: 'Mine' } });
    expect(row.tenantId).toBe(a.tenantId);
  });

  it('cannot reach B by reusing B’s order id for a new order of its own', async () => {
    const res = await asA('POST', `/locations/${a.locationA}/orders`, {
      id: orderB.id,
      channel: 'TAKEAWAY',
      items: [menuA.burgerLine()],
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain(menuB.burger.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderB.id } })).tenantId).toBe(
      b.tenantId,
    );
  });
});

describe('tenant A cannot read or overwrite tenant B’s files (ADR 0019)', () => {
  let logoB: TenantFileDto;
  let keyB: string;
  const storage = () => app.get<TenantFileStorage>(TENANT_FILE_STORAGE);

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${b.tenantId}/files?kind=LOGO`,
      headers: { ...ownerB, 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(res.statusCode).toBe(201);
    logoB = res.json<TenantFileDto>();
    keyB = (await prisma.tenantFile.findUniqueOrThrow({ where: { id: logoB.id } })).storageKey;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/tenants/${b.tenantId}/branding`,
      headers: ownerB,
      payload: { logoFileId: logoB.id, ...nullBranding },
    });
  });

  const nullBranding = {
    displayNameEn: null,
    displayNameAr: null,
    faviconFileId: null,
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    fontFamily: null,
    logoSize: null,
    themeMode: null,
    surfaceStyle: null,
    borderRadius: null,
  };

  it('does not find B’s file through A’s routes, B’s routes or the public ones', async () => {
    for (const url of [
      `/tenants/${a.tenantId}/files/${logoB.id}/content`,
      `/tenants/${b.tenantId}/files/${logoB.id}/content`,
    ]) {
      const res = await asA('GET', url);
      expect(res.statusCode, url).toBe(404);
      expect(res.rawPayload.equals(PNG), url).toBe(false);
    }
    const list = await asA('GET', `/tenants/${a.tenantId}/files`);
    expect(list.body).not.toContain(logoB.id);
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
    const pub = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tenants/${slug}/files/${logoB.id}`,
    });
    expect(pub.statusCode).toBe(404);
  });

  it('cannot upload into B or show B’s file as its own logo', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${b.tenantId}/files?kind=FAVICON`,
      headers: { ...ownerA, 'content-type': 'image/x-icon' },
      payload: ICO,
    });
    expect(upload.statusCode).toBe(404);
    const branding = await app.inject({
      method: 'PUT',
      url: `/api/v1/tenants/${a.tenantId}/branding`,
      headers: ownerA,
      payload: { ...nullBranding, logoFileId: logoB.id },
    });
    expect(branding.statusCode).toBe(404);
    expect(branding.json<ApiErrorBody>().code).toBe('FILE_NOT_FOUND');
    expect(await prisma.tenantFile.count({ where: { tenantId: b.tenantId } })).toBe(1);
    expect(await prisma.tenantBranding.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it('cannot read, write or overwrite B’s bytes in the storage', async () => {
    await expect(storage().get(a.tenantId, keyB)).rejects.toThrow(TenantFileScopeError);
    await expect(storage().put(a.tenantId, keyB, ICO)).rejects.toThrow(TenantFileScopeError);
    for (const key of [
      `tenants/${a.tenantId}/../${b.tenantId}/logo/x.png`,
      `tenants/${a.tenantId}//x.png`,
      `/tenants/${a.tenantId}/x.png`,
    ]) {
      await expect(storage().put(a.tenantId, key, ICO), key).rejects.toThrow(TenantFileScopeError);
    }
    // Not even B itself replaces a stored file: files are immutable.
    await expect(storage().put(b.tenantId, keyB, ICO)).rejects.toThrow(TenantFileExistsError);
    expect((await storage().get(b.tenantId, keyB))?.equals(PNG)).toBe(true);
  });

  it('keeps file rows in their tenant’s folder and scope', async () => {
    await expect(
      prisma.tenantFile.create({
        data: {
          tenantId: a.tenantId,
          kind: 'LOGO',
          storageKey: `tenants/${b.tenantId}/logo/forged.png`,
          contentType: 'image/png',
          sizeBytes: 1,
          sha256: 'x',
        },
      }),
    ).rejects.toThrow(/tenant_files_storage_key_check/);
    const files = await TenantContext.runInTenant(a.tenantId, () =>
      app.get(PrismaService).tenantFile.findMany(),
    );
    expect(files.map((f) => f.id)).not.toContain(logoB.id);
  });
});

describe('the tenant-scoped client (PostgreSQL)', () => {
  const db = () => app.get(PrismaService);

  it('returns only the tenant in scope’s rows, whatever the query asks for', async () => {
    const orders = await TenantContext.runInTenant(a.tenantId, () => db().order.findMany());
    expect(orders.every((o) => o.tenantId === a.tenantId)).toBe(true);
    expect(
      await TenantContext.runInTenant(a.tenantId, () =>
        db().order.findUnique({ where: { id: orderB.id } }),
      ),
    ).toBeNull();
    expect(
      await TenantContext.runInTenant(a.tenantId, () =>
        db().product.count({ where: { tenantId: b.tenantId } }),
      ),
    ).toBe(0);
    // Relations are reached through their scoped parent.
    const withLines = await TenantContext.runInTenant(a.tenantId, () =>
      db().order.findMany({ include: { items: true } }),
    );
    expect(withLines.flatMap((o) => o.items).every((i) => i.productId !== menuB.burger.id)).toBe(
      true,
    );
  });

  it('changes nothing of another tenant and refuses writes for it, also in transactions', async () => {
    const touched = await TenantContext.runInTenant(a.tenantId, () =>
      db().product.updateMany({ where: { id: menuB.burger.id }, data: { nameEn: 'x' } }),
    );
    expect(touched.count).toBe(0);
    await expect(
      TenantContext.runInTenant(a.tenantId, () =>
        db().$transaction((tx) =>
          tx.category.create({ data: { tenantId: b.tenantId, nameEn: 'x', nameAr: 'x' } }),
        ),
      ),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      TenantContext.runInTenant(a.tenantId, () => db().order.delete({ where: { id: orderB.id } })),
    ).rejects.toThrow();
    expect(await prisma.order.count({ where: { id: orderB.id } })).toBe(1);
  });

  it('refuses tenant queries with no tenant in scope', async () => {
    await expect(db().order.findMany()).rejects.toThrow(/without a tenant in scope/);
    // Tables of no tenant are not scoped.
    expect(await db().permission.count()).toBe(PERMISSIONS.length);
  });
});

describe('the change feed after the tenant rename', () => {
  it('records a CONFIG change for the right tenant through every way a table names its tenant', async () => {
    const changes = (tenantId: string) =>
      prisma.changeLog.count({ where: { tenantId, topic: 'CONFIG' } });
    const cashier = await prisma.role.findFirstOrThrow({
      where: { tenantId: a.tenantId, name: 'Cashier' },
    });
    const writes: [kind: string, write: () => Promise<unknown>][] = [
      [
        'tenant',
        () => prisma.tenant.update({ where: { id: a.tenantId }, data: { legalName: 'A Ltd' } }),
      ],
      [
        'self',
        () =>
          prisma.category.update({
            where: { id: menuA.burger.categoryId },
            data: { nameEn: 'Grill' },
          }),
      ],
      [
        'role',
        () =>
          prisma.rolePermission.create({
            data: { roleId: cashier.id, permissionKey: 'reports.view' },
          }),
      ],
      ['user', () => prisma.userRole.deleteMany({ where: { userId: a.cashier.id } })],
      [
        'modifier_group',
        () => prisma.modifier.update({ where: { id: menuA.cheese.id }, data: { priceDelta: 350 } }),
      ],
      [
        'product',
        () => prisma.productVariant.update({ where: { id: menuA.small.id }, data: { price: 650 } }),
      ],
      [
        'location',
        () =>
          prisma.locationProduct.create({
            data: { locationId: a.locationA, productId: menuA.cola.id, isAvailable: false },
          }),
      ],
    ];
    const otherBefore = await changes(b.tenantId);
    for (const [kind, write] of writes) {
      const before = await changes(a.tenantId);
      await write();
      expect(await changes(a.tenantId), kind).toBe(before + 1);
    }
    expect(await changes(b.tenantId)).toBe(otherBefore);
  });
});

describe('provisioning', () => {
  it('creates a tenant with an owner role holding every permission, idempotently by slug', async () => {
    const input = {
      tenant: {
        slug: `isolation-${Date.now().toString(36)}`,
        nameEn: 'Corner Shop',
        nameAr: 'متجر الزاوية',
        businessType: 'RETAIL',
        currencyCode: 'ILS',
        defaultLocale: 'ar' as const,
        timezone: 'Asia/Hebron',
      },
      locations: [
        {
          code: 'MAIN',
          nameEn: 'Main',
          nameAr: 'الرئيسي',
          timezone: 'Asia/Hebron',
          taxInclusive: true,
        },
      ],
    };
    const first = await provisionTenant(prisma, input);
    const again = await provisionTenant(prisma, input);
    expect(again.tenantId).toBe(first.tenantId);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: first.tenantId },
      include: { roles: { include: { permissions: true } }, locations: true },
    });
    expect(tenant).toMatchObject({ businessType: 'RETAIL', currencyCode: 'ILS', status: 'ACTIVE' });
    expect(tenant.locations).toHaveLength(1);
    expect(tenant.roles).toEqual([expect.objectContaining({ name: 'Owner', isSystem: true })]);
    expect(tenant.roles[0]?.permissions).toHaveLength(PERMISSIONS.length);
  });

  it('does not let a new tenant’s staff see existing tenants', async () => {
    const res = await asA('GET', `/tenants/${b.tenantId}`);
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('TENANT_NOT_FOUND');
    const products = await asA('GET', `/tenants/${a.tenantId}/products`);
    expect(products.body).not.toContain(menuB.burger.id);
  });
});
