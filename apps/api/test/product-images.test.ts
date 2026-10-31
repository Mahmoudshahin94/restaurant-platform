import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { TenantContext } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import type { PairedDevice, Product, PublishedMenu, TenantFileDto } from '@pos/validation';
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
import { JPEG, PNG, SVG } from './image-fixture';
import { createMenuFixture } from './menu-fixture';

/**
 * Product pictures (ADR 0027): uploads by whoever edits products, the cover of each product and
 * variant in the published menu, the pictures on the customer website, and the pictures reaching
 * the location hubs (snapshot rows without bytes, the hub's own download route, the change feed).
 * Every step stays inside the tenant.
 */
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
  owner = bearer(await login(app, tenant.owner.email));
  menu = await createMenuFixture(prisma, tenant);
});

const base = (t = tenant) => `/api/v1/tenants/${t.tenantId}`;

function upload(bytes: Buffer, contentType: string, headers = owner, t = tenant) {
  return app.inject({
    method: 'POST',
    url: `${base(t)}/products/images`,
    headers: { ...headers, 'content-type': contentType },
    payload: bytes,
  });
}

async function uploaded(bytes = PNG, type = 'image/png', headers = owner, t = tenant) {
  const res = await upload(bytes, type, headers, t);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<TenantFileDto>();
}

function patchProduct(productId: string, body: object, t = tenant, headers = owner) {
  return app.inject({
    method: 'PATCH',
    url: `${base(t)}/products/${productId}`,
    headers,
    payload: body,
  });
}

async function publishedMenu(): Promise<PublishedMenu> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/locations/${tenant.locationA}/menu`,
    headers: owner,
  });
  expect(res.statusCode).toBe(200);
  return res.json<PublishedMenu>();
}

const productIn = (published: PublishedMenu, id: string) =>
  published.categories.flatMap((c) => c.products).find((p) => p.id === id);

async function pairHub(t = tenant, headers = owner): Promise<Record<string, string>> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/locations/${t.locationA}/devices`,
    headers,
    payload: { name: 'Main hub', type: 'GATEWAY' },
  });
  expect(res.statusCode).toBe(201);
  return { authorization: `Device ${res.json<PairedDevice>().credential ?? ''}` };
}

describe('uploading product pictures', () => {
  it('lets whoever edits products upload a picture, and nobody else', async () => {
    const picture = await uploaded();
    expect(picture).toMatchObject({ kind: 'PRODUCT_IMAGE', contentType: 'image/png' });

    // The demo cashier may view products, not edit them.
    const cashier = bearer(await login(app, tenant.cashier.email));
    const refused = await upload(PNG, 'image/png', cashier);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<ApiErrorBody>().code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('accepts raster images only, checked by their bytes', async () => {
    expect((await upload(JPEG, 'image/jpeg')).statusCode).toBe(201);
    const svg = await upload(SVG, 'image/svg+xml');
    expect(svg.json<ApiErrorBody>().code).toBe('FILE_TYPE_NOT_ALLOWED');
    const lying = await upload(SVG, 'image/png');
    expect(lying.json<ApiErrorBody>().code).toBe('FILE_TYPE_NOT_ALLOWED');
  });
});

describe('the published menu', () => {
  it('shows each product’s first picture as its cover, and a variant’s own picture', async () => {
    const first = await uploaded();
    const second = await uploaded(JPEG, 'image/jpeg');
    const red = await uploaded();
    expect(
      (await patchProduct(menu.burger.id, { imageFileIds: [first.id, second.id] })).statusCode,
    ).toBe(200);
    const cola = await app.inject({
      method: 'GET',
      url: `${base()}/products/${menu.cola.id}`,
      headers: owner,
    });
    const variants = cola.json<Product>().variants.map((v) => ({
      id: v.id,
      nameEn: v.nameEn,
      nameAr: v.nameAr,
      price: v.price,
      sku: v.sku,
      imageFileIds: v.id === menu.small.id ? [red.id] : [],
    }));
    expect((await patchProduct(menu.cola.id, { variants })).statusCode).toBe(200);

    const published = await publishedMenu();
    expect(productIn(published, menu.burger.id)?.imageFileId).toBe(first.id);
    const publishedCola = productIn(published, menu.cola.id);
    expect(publishedCola?.imageFileId).toBeNull();
    expect(publishedCola?.variants.map((v) => v.imageFileId)).toEqual([red.id, null]);

    // Reordering changes the cover.
    await patchProduct(menu.burger.id, { imageFileIds: [second.id, first.id] });
    expect(productIn(await publishedMenu(), menu.burger.id)?.imageFileId).toBe(second.id);
  });

  it('refuses a picture of another tenant', async () => {
    const other = await createTenant(prisma);
    const theirs = await uploaded(
      PNG,
      'image/png',
      bearer(await login(app, other.owner.email)),
      other,
    );
    const res = await patchProduct(menu.burger.id, { imageFileIds: [theirs.id] });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(productIn(await publishedMenu(), menu.burger.id)?.imageFileId).toBeNull();
  });
});

describe('the customer website', () => {
  it('serves the pictures of its own products only', async () => {
    const shown = await uploaded();
    const unattached = await uploaded();
    await patchProduct(menu.burger.id, { imageFileIds: [shown.id] });
    const file = (id: string, host = tenant.host) =>
      app.inject({ method: 'GET', url: `/api/v1/public/site/files/${id}`, headers: { host } });

    const res = await file(shown.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect((await file(unattached.id)).statusCode).toBe(404);

    const other = await createTenant(prisma);
    expect((await file(shown.id, other.host)).statusCode).toBe(404);
  });
});

describe('product pictures reach the location hubs', () => {
  it('puts the covers’ rows in the snapshot without their bytes', async () => {
    const cover = await uploaded();
    const second = await uploaded();
    await patchProduct(menu.burger.id, { imageFileIds: [cover.id, second.id] });
    const snapshot = await TenantContext.runInTenant(tenant.tenantId, () =>
      app.get(SnapshotService).build({
        id: '01890a5d-ac96-774b-bcce-b302099a8001',
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
      }),
    );
    expect(snapshot.format).toBe(9);
    expect(snapshot.tables.productImages).toEqual([
      expect.objectContaining({ productId: menu.burger.id, variantId: null, fileId: cover.id }),
    ]);
    expect(snapshot.tables.tenantFiles.map((f) => f.id)).toEqual([cover.id]);
    expect(snapshot.files).toEqual([]);
  });

  it('records a CONFIG change when only the pictures change', async () => {
    const picture = await uploaded();
    const changes = () =>
      prisma.changeLog.count({ where: { tenantId: tenant.tenantId, topic: 'CONFIG' } });
    const before = await changes();
    await prisma.productImage.create({
      data: { tenantId: tenant.tenantId, productId: menu.burger.id, fileId: picture.id },
    });
    expect(await changes()).toBe(before + 1);
  });

  it('gives a hub the pictures its menu shows, and nothing else', async () => {
    const shown = await uploaded();
    const unattached = await uploaded();
    await patchProduct(menu.burger.id, { imageFileIds: [shown.id] });
    const hub = await pairHub();
    const file = (id: string, headers = hub) =>
      app.inject({ method: 'GET', url: `/api/v1/sync/files/${id}`, headers });

    const res = await file(shown.id);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(res.headers.etag).toBe(`"${shown.sha256}"`);
    expect((await file(unattached.id)).statusCode).toBe(404);
    // Staff tokens do not open hub routes; another tenant's hub finds nothing.
    expect((await file(shown.id, owner)).statusCode).toBe(401);
    const other = await createTenant(prisma);
    const otherHub = await pairHub(other, bearer(await login(app, other.owner.email)));
    expect((await file(shown.id, otherHub)).statusCode).toBe(404);
  });
});
