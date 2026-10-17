import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import type { ApiErrorBody } from '@pos/shared-types';
import type {
  Category,
  KitchenStation,
  LocationProductSetting,
  ModifierGroup,
  Product,
  PublishedMenu,
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

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;
let cashier: Record<string, string>;

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
  cashier = bearer(await login(app, tenant.cashier.email));
});

const r = () => `/api/v1/restaurants/${tenant.restaurantId}`;

async function post<T>(url: string, payload: unknown, headers = owner): Promise<T> {
  const res = await app.inject({ method: 'POST', url, payload: payload as object, headers });
  if (res.statusCode >= 300) throw new Error(`${url} → ${res.statusCode} ${res.body}`);
  return res.json<T>();
}

/** Grill + Kitchen stations, a required "Doneness" group, an optional "Extras" group, a category. */
async function seedMenu() {
  const grill = await post<KitchenStation>(`${r()}/kitchen-stations`, {
    code: 'grill',
    nameEn: 'Grill',
    nameAr: 'الشواية',
  });
  const kitchen = await post<KitchenStation>(`${r()}/kitchen-stations`, {
    code: 'KITCHEN',
    nameEn: 'Kitchen',
    nameAr: 'المطبخ',
  });
  const doneness = await post<ModifierGroup>(`${r()}/modifier-groups`, {
    nameEn: 'Doneness',
    nameAr: 'درجة الاستواء',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { nameEn: 'Medium', nameAr: 'متوسط', isDefault: true, sortOrder: 1 },
      { nameEn: 'Well done', nameAr: 'مستوي جيدًا', sortOrder: 2 },
    ],
  });
  const extras = await post<ModifierGroup>(`${r()}/modifier-groups`, {
    nameEn: 'Extras',
    nameAr: 'إضافات',
    maxSelect: 2,
    modifiers: [
      { nameEn: 'Cheese', nameAr: 'جبن', priceDelta: 300 },
      { nameEn: 'Bacon', nameAr: 'لحم مقدد', priceDelta: 500 },
    ],
  });
  const mains = await post<Category>(`${r()}/categories`, {
    nameEn: 'Mains',
    nameAr: 'الأطباق الرئيسية',
    sortOrder: 1,
  });
  const burger = await post<Product>(`${r()}/products`, {
    categoryId: mains.id,
    sku: 'BRG-1',
    nameEn: 'Burger',
    nameAr: 'برجر',
    price: 2500,
    modifierGroups: [
      { modifierGroupId: doneness.id, sortOrder: 1 },
      { modifierGroupId: extras.id, sortOrder: 2 },
    ],
    stationIds: [grill.id, kitchen.id],
  });
  const cola = await post<Product>(`${r()}/products`, {
    categoryId: mains.id,
    nameEn: 'Cola',
    nameAr: 'كولا',
    price: 600,
    sortOrder: 2,
    variants: [
      { nameEn: 'Small', nameAr: 'صغير', price: 600, sortOrder: 1 },
      { nameEn: 'Large', nameAr: 'كبير', price: 800, sortOrder: 2 },
    ],
  });
  return { grill, kitchen, doneness, extras, mains, burger, cola };
}

describe('catalog administration', () => {
  it('creates a full product with variants, modifier groups and stations, and audits it', async () => {
    const { burger, cola, grill, kitchen, doneness } = await seedMenu();
    expect(burger.stationIds).toEqual([grill.id, kitchen.id].sort());
    expect(burger.modifierGroups[0]).toEqual({
      modifierGroupId: doneness.id,
      sortOrder: 1,
      minSelect: null,
      maxSelect: null,
    });
    expect(cola.variants.map((v) => v.nameEn)).toEqual(['Small', 'Large']);
    expect(await prisma.auditLog.count({ where: { action: 'product.created' } })).toBe(2);

    const listed = await app.inject({
      method: 'GET',
      url: `${r()}/products?search=brg`,
      headers: owner,
    });
    expect(listed.json<Product[]>().map((p) => p.id)).toEqual([burger.id]);
  });

  it('normalizes station codes and rejects duplicates', async () => {
    const station = await post<KitchenStation>(`${r()}/kitchen-stations`, {
      code: 'fryer',
      nameEn: 'Fryer',
      nameAr: 'المقلاة',
    });
    expect(station.code).toBe('FRYER');
    const dup = await app.inject({
      method: 'POST',
      url: `${r()}/kitchen-stations`,
      headers: owner,
      payload: { code: 'FRYER', nameEn: 'x', nameAr: 'x' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rejects references to other tenants and bad money values', async () => {
    const other = await createTenant(prisma);
    const foreignGroup = await prisma.modifierGroup.create({
      data: { restaurantId: other.restaurantId, nameEn: 'X', nameAr: 'X' },
    });
    const { mains } = await seedMenu();

    const foreign = await app.inject({
      method: 'POST',
      url: `${r()}/products`,
      headers: owner,
      payload: {
        categoryId: mains.id,
        nameEn: 'A',
        nameAr: 'A',
        price: 100,
        modifierGroups: [{ modifierGroupId: foreignGroup.id }],
      },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json<ApiErrorBody>()).toMatchObject({
      code: 'MODIFIER_GROUP_NOT_FOUND',
      details: { modifierGroupIds: [foreignGroup.id] },
    });

    const float = await app.inject({
      method: 'POST',
      url: `${r()}/products`,
      headers: owner,
      payload: { categoryId: mains.id, nameEn: 'A', nameAr: 'A', price: 12.5 },
    });
    expect(float.statusCode).toBe(400);

    const dupSku = await app.inject({
      method: 'POST',
      url: `${r()}/products`,
      headers: owner,
      payload: { categoryId: mains.id, sku: 'BRG-1', nameEn: 'A', nameAr: 'A', price: 1 },
    });
    expect(dupSku.statusCode).toBe(409);
  });

  it('hides other tenants’ products even with a valid id', async () => {
    const { burger } = await seedMenu();
    const other = await createTenant(prisma);
    const otherOwner = bearer(await login(app, other.owner.email));
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/restaurants/${other.restaurantId}/products/${burger.id}`,
      headers: otherOwner,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<ApiErrorBody>().code).toBe('PRODUCT_NOT_FOUND');
  });

  it('lets view-only staff read the catalog but not change it', async () => {
    await seedMenu();
    const read = await app.inject({ method: 'GET', url: `${r()}/products`, headers: cashier });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: 'POST',
      url: `${r()}/categories`,
      headers: cashier,
      payload: { nameEn: 'x', nameAr: 'x' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json<ApiErrorBody>().details).toEqual({ missing: ['products.create'] });
  });

  it('updates variants as a complete list, archiving omitted ones, and audits price changes', async () => {
    const { cola } = await seedMenu();
    const [small, large] = cola.variants;
    const res = await app.inject({
      method: 'PATCH',
      url: `${r()}/products/${cola.id}`,
      headers: owner,
      payload: {
        price: 650,
        variants: [
          { id: small!.id, nameEn: 'Small', nameAr: 'صغير', price: 650, sortOrder: 1 },
          { nameEn: 'Medium', nameAr: 'وسط', price: 700, sortOrder: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Product>();
    expect(updated.variants.map((v) => [v.nameEn, v.price])).toEqual([
      ['Small', 650],
      ['Medium', 700],
    ]);
    const archivedLarge = await prisma.productVariant.findUniqueOrThrow({
      where: { id: large!.id },
    });
    expect(archivedLarge.archivedAt).not.toBeNull();

    const priceAudits = await prisma.auditLog.findMany({
      where: { action: 'product.price_changed', entityId: cola.id },
    });
    expect(priceAudits.map((a) => a.metadata)).toEqual(
      expect.arrayContaining([
        { productId: cola.id, from: 600, to: 650 },
        { productId: cola.id, variantId: small!.id, from: 600, to: 650 },
      ]),
    );

    const foreignVariant = await app.inject({
      method: 'PATCH',
      url: `${r()}/products/${cola.id}`,
      headers: owner,
      payload: { variants: [{ id: tenant.locationA, nameEn: 'x', nameAr: 'x', price: 1 }] },
    });
    expect(foreignVariant.json<ApiErrorBody>().code).toBe('VARIANT_NOT_FOUND');
  });

  it('validates modifier group ranges against the resulting modifiers and audits delta changes', async () => {
    const { extras } = await seedMenu();
    const [cheese] = extras.modifiers;
    const tooStrict = await app.inject({
      method: 'PATCH',
      url: `${r()}/modifier-groups/${extras.id}`,
      headers: owner,
      payload: { minSelect: 3, maxSelect: null },
    });
    expect(tooStrict.statusCode).toBe(400);

    const res = await app.inject({
      method: 'PATCH',
      url: `${r()}/modifier-groups/${extras.id}`,
      headers: owner,
      payload: {
        modifiers: [{ id: cheese!.id, nameEn: 'Cheese', nameAr: 'جبن', priceDelta: 350 }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<ModifierGroup>().modifiers.map((m) => m.nameEn)).toEqual(['Cheese']);
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'modifier.price_changed', entityId: cheese!.id },
      }),
    ).toMatchObject({ metadata: { from: 300, to: 350 } });
  });
});

describe('published location menu', () => {
  const menuUrl = () => `/api/v1/locations/${tenant.locationA}/menu`;

  it('serves the resolved menu with an ETag and answers 304 when unchanged', async () => {
    const { burger, cola, doneness } = await seedMenu();
    const first = await app.inject({ method: 'GET', url: menuUrl(), headers: cashier });
    expect(first.statusCode).toBe(200);
    const menu = first.json<PublishedMenu>();
    expect(menu).toMatchObject({
      currencyCode: 'SAR',
      taxInclusive: true,
      locationId: tenant.locationA,
    });
    expect(first.headers.etag).toBe(`"${menu.version}"`);
    const products = menu.categories[0]!.products;
    expect(products.map((p) => p.id)).toEqual([burger.id, cola.id]);
    expect(products[0]!.modifierGroups[0]).toMatchObject({
      id: doneness.id,
      minSelect: 1,
      maxSelect: 1,
    });

    const again = await app.inject({
      method: 'GET',
      url: menuUrl(),
      headers: { ...cashier, 'if-none-match': first.headers.etag! },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');

    await app.inject({
      method: 'POST',
      url: `${r()}/products/${burger.id}/archive`,
      headers: owner,
    });
    const changed = await app.inject({
      method: 'GET',
      url: menuUrl(),
      headers: { ...cashier, 'if-none-match': first.headers.etag! },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<PublishedMenu>().categories[0]!.products.map((p) => p.id)).toEqual([
      cola.id,
    ]);
  });

  it('applies per-location availability and price overrides, audited', async () => {
    const { burger, cola } = await seedMenu();
    const set = (
      productId: string,
      payload: object,
      headers = owner,
      location = tenant.locationA,
    ) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/locations/${location}/products/${productId}/settings`,
        headers,
        payload,
      });

    expect((await set(burger.id, { isAvailable: false, priceOverride: 2700 })).statusCode).toBe(
      200,
    );
    const menuA = (
      await app.inject({ method: 'GET', url: menuUrl(), headers: owner })
    ).json<PublishedMenu>();
    expect(menuA.categories[0]!.products[0]).toMatchObject({
      id: burger.id,
      isAvailable: false,
      price: 2700,
    });

    // Location B is unaffected.
    const menuB = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/locations/${tenant.locationB}/menu`,
        headers: owner,
      })
    ).json<PublishedMenu>();
    expect(menuB.categories[0]!.products[0]).toMatchObject({ isAvailable: true, price: 2500 });

    const settings = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/product-settings`,
      headers: owner,
    });
    expect(settings.json<LocationProductSetting[]>()).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'product.price_changed', locationId: tenant.locationA },
      }),
    ).toBe(1);

    const variantOverride = await set(cola.id, { isAvailable: true, priceOverride: 100 });
    expect(variantOverride.statusCode).toBe(400);
    expect(variantOverride.json<ApiErrorBody>().details).toMatchObject({
      reason: 'PRICE_OVERRIDE_WITH_VARIANTS',
    });

    expect((await set(burger.id, { isAvailable: true }, cashier)).statusCode).toBe(403);
    expect(
      (await set(burger.id, { isAvailable: true }, cashier, tenant.locationB)).statusCode,
    ).toBe(404);
  });

  it('drops archived categories, stations and modifier groups from the menu', async () => {
    const { mains, grill, extras } = await seedMenu();
    await app.inject({
      method: 'POST',
      url: `${r()}/kitchen-stations/${grill.id}/archive`,
      headers: owner,
    });
    await app.inject({
      method: 'POST',
      url: `${r()}/modifier-groups/${extras.id}/archive`,
      headers: owner,
    });
    const menu = (
      await app.inject({ method: 'GET', url: menuUrl(), headers: owner })
    ).json<PublishedMenu>();
    const burger = menu.categories[0]!.products[0]!;
    expect(burger.stationIds).not.toContain(grill.id);
    expect(burger.modifierGroups.map((g) => g.id)).not.toContain(extras.id);

    await app.inject({
      method: 'POST',
      url: `${r()}/categories/${mains.id}/archive`,
      headers: owner,
    });
    const empty = (
      await app.inject({ method: 'GET', url: menuUrl(), headers: owner })
    ).json<PublishedMenu>();
    expect(empty.categories).toEqual([]);
  });
});
