import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type { ApiErrorBody, Feature } from '@pos/shared-types';
import type {
  CatalogLookup,
  Category,
  Order,
  Product,
  PublishedMenu,
  TenantFileDto,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PNG } from './image-fixture';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';

/**
 * The retail catalog (ADR 0021): option axes and the variant matrix, per-variant SKU, cost and
 * stock flag, pictures, barcodes unique per tenant, code lookup, and the codes kept on order lines.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;
let cashier: Record<string, string>;
let category: Category;

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
  // The test tenant is a restaurant: barcodes are off, variants on.
  await setModule(tenant.tenantId, 'BARCODE', true);
  category = await send<Category>('POST', `${r()}/categories`, { nameEn: 'Tops', nameAr: 'قمصان' });
});

const r = (tenantId = tenant.tenantId) => `/api/v1/tenants/${tenantId}`;
const loc = () => `/api/v1/locations/${tenant.locationA}`;

async function setModule(tenantId: string, feature: Feature, enabled: boolean) {
  await prisma.featureOverride.upsert({
    where: { tenantId_scope_feature: { tenantId, scope: 'tenant', feature } },
    create: { tenantId, scope: 'tenant', feature, enabled },
    update: { enabled },
  });
}

async function call(
  method: 'POST' | 'PATCH' | 'GET',
  url: string,
  payload?: unknown,
  headers = owner,
) {
  return app.inject({ method, url, headers, ...(payload ? { payload: payload as object } : {}) });
}

async function send<T>(method: 'POST' | 'PATCH', url: string, payload: unknown): Promise<T> {
  const res = await call(method, url, payload);
  if (res.statusCode >= 300) throw new Error(`${url} → ${res.statusCode} ${res.body}`);
  return res.json<T>();
}

const size = {
  nameEn: 'Size',
  nameAr: 'المقاس',
  values: [
    { nameEn: 'S', nameAr: 'صغير' },
    { nameEn: 'M', nameAr: 'وسط' },
  ],
};
const colour = {
  nameEn: 'Colour',
  nameAr: 'اللون',
  values: [
    { nameEn: 'Red', nameAr: 'أحمر' },
    { nameEn: 'Blue', nameAr: 'أزرق' },
  ],
};

/** A T-shirt in S/M × Red/Blue, every variant with its SKU and EAN-13. */
function teeShirt(overrides: Record<string, unknown> = {}) {
  const codes = ['6291234000018', '6291234000025', '6291234000032', '6291234000049'];
  return {
    categoryId: category.id,
    sku: 'TEE',
    nameEn: 'T-shirt',
    nameAr: 'قميص',
    price: 6000,
    options: [size, colour],
    variants: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ].map((optionValues, i) => ({
      optionValues,
      sku: `TEE-${String(i)}`,
      price: i < 2 ? 6000 : 6500,
      cost: 2500,
      trackInventory: true,
      sortOrder: i,
      barcodes: [{ code: codes[i] }],
    })),
    ...overrides,
  };
}

describe('options and the variant matrix', () => {
  it('creates a product from its options, naming each variant after its values', async () => {
    const tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    expect(tee.options.map((o) => [o.nameEn, o.values.map((v) => v.nameEn)])).toEqual([
      ['Size', ['S', 'M']],
      ['Colour', ['Red', 'Blue']],
    ]);
    expect(tee.variants.map((v) => [v.nameEn, v.nameAr, v.sku, v.price, v.cost])).toEqual([
      ['S / Red', 'صغير / أحمر', 'TEE-0', 6000, 2500],
      ['S / Blue', 'صغير / أزرق', 'TEE-1', 6000, 2500],
      ['M / Red', 'وسط / أحمر', 'TEE-2', 6500, 2500],
      ['M / Blue', 'وسط / أزرق', 'TEE-3', 6500, 2500],
    ]);
    const [s, m] = tee.options[0]!.values;
    const [red] = tee.options[1]!.values;
    expect(tee.variants[2]?.optionValueIds).toEqual([m!.id, red!.id]);
    expect(tee.variants[0]?.optionValueIds).toEqual([s!.id, red!.id]);
    expect(tee.variants.every((v) => v.trackInventory)).toBe(true);
    expect(tee.variants[0]?.barcodes).toEqual([
      { id: expect.any(String), code: '6291234000018', symbology: 'EAN13', isPrimary: true },
    ]);
    expect(tee.barcodes).toEqual([]);
  });

  it('keeps name-only variants valid next to products with options', async () => {
    const cola = await send<Product>('POST', `${r()}/products`, {
      categoryId: category.id,
      nameEn: 'Cola',
      nameAr: 'كولا',
      price: 600,
      variants: [
        { nameEn: 'Small', nameAr: 'صغير', price: 600 },
        { nameEn: 'Large', nameAr: 'كبير', price: 800 },
      ],
    });
    expect(cola.options).toEqual([]);
    expect(cola.variants.map((v) => [v.nameEn, v.optionValueIds, v.sku, v.cost])).toEqual([
      ['Small', [], null, null],
      ['Large', [], null, null],
    ]);
    const unnamed = await call('PATCH', `${r()}/products/${cola.id}`, {
      variants: [{ price: 700 }],
    });
    expect(unnamed.statusCode).toBe(422);
    expect(unnamed.json<ApiErrorBody>()).toMatchObject({
      code: 'INVALID_VARIANT_OPTIONS',
      details: { reason: 'NAME_REQUIRED' },
    });
  });

  it('renames, adds and removes values; variants of a removed value are archived and free their codes', async () => {
    const tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    const [sizeOption, colourOption] = tee.options;
    const keep = (i: number) => {
      const v = tee.variants[i]!;
      return {
        id: v.id,
        sku: v.sku,
        price: v.price,
        cost: v.cost,
        trackInventory: v.trackInventory,
        sortOrder: v.sortOrder,
      };
    };
    // Blue goes, Red is renamed Crimson, L is added (with one new variant, M/L × Crimson only).
    const updated = await send<Product>('PATCH', `${r()}/products/${tee.id}`, {
      options: [
        {
          id: sizeOption!.id,
          nameEn: 'Size',
          nameAr: 'المقاس',
          values: [
            ...sizeOption!.values.map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr })),
            { nameEn: 'L', nameAr: 'كبير' },
          ],
        },
        {
          id: colourOption!.id,
          nameEn: 'Colour',
          nameAr: 'اللون',
          values: [{ id: colourOption!.values[0]!.id, nameEn: 'Crimson', nameAr: 'قرمزي' }],
        },
      ],
      variants: [
        { ...keep(0), optionValues: [0, 0] },
        { ...keep(2), optionValues: [1, 0] },
        { optionValues: [2, 0], price: 7000, sortOrder: 3, barcodes: [{ code: '6291234000025' }] },
      ],
    });
    expect(updated.variants.map((v) => [v.nameEn, v.price])).toEqual([
      ['S / Crimson', 6000],
      ['M / Crimson', 6500],
      ['L / Crimson', 7000],
    ]);
    expect(updated.variants[0]?.id).toBe(tee.variants[0]?.id);
    // The archived S/Blue's code went to the new L variant; M/Blue's code is free again.
    expect(updated.variants[2]?.barcodes.map((b) => b.code)).toEqual(['6291234000025']);
    const blue = await prisma.productVariant.findUniqueOrThrow({
      where: { id: tee.variants[3]!.id },
    });
    expect(blue.archivedAt).not.toBeNull();
    expect(await prisma.productBarcode.count({ where: { code: '6291234000049' } })).toBe(0);
    expect(await prisma.productOptionValue.count({ where: { optionId: colourOption!.id } })).toBe(
      1,
    );
  });

  it('refuses variants that do not match the stored options', async () => {
    const tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    const res = await call('PATCH', `${r()}/products/${tee.id}`, {
      variants: [{ id: tee.variants[0]!.id, price: 1, optionValues: [0, 5] }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'INVALID_VARIANT_OPTIONS',
      details: { reason: 'UNKNOWN_VALUE', index: 0 },
    });
  });

  it('needs PRODUCT_VARIANTS for new option axes, and keeps stored ones editable without it', async () => {
    const tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    await setModule(tenant.tenantId, 'PRODUCT_VARIANTS', false);
    const gated = await call(
      'POST',
      `${r()}/products`,
      teeShirt({
        sku: null,
        variants: [{ optionValues: [0, 0], price: 1 }],
      }),
    );
    expect(gated.statusCode).toBe(403);
    expect(gated.json<ApiErrorBody>()).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { feature: 'PRODUCT_VARIANTS' },
    });
    // Sending the stored options back unchanged (a price edit) still works.
    const options = tee.options.map((o) => ({
      id: o.id,
      nameEn: o.nameEn,
      nameAr: o.nameAr,
      values: o.values.map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr })),
    }));
    const edit = await call('PATCH', `${r()}/products/${tee.id}`, {
      options,
      variants: tee.variants.map((v, i) => ({
        id: v.id,
        optionValues: [Math.floor(i / 2), i % 2],
        sku: v.sku,
        price: v.price + 100,
      })),
    });
    expect(edit.statusCode, edit.body).toBe(200);
  });

  it('attaches pictures from the tenant file storage to a variant', async () => {
    const upload = await app.inject({
      method: 'POST',
      url: `${r()}/files?kind=PRODUCT_IMAGE`,
      headers: { ...owner, 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const file = upload.json<TenantFileDto>();
    const logo = await app.inject({
      method: 'POST',
      url: `${r()}/files?kind=LOGO`,
      headers: { ...owner, 'content-type': 'image/png' },
      payload: PNG,
    });
    const tee = await send<Product>('POST', `${r()}/products`, {
      ...teeShirt(),
      variants: teeShirt().variants.map((v, i) =>
        i === 0 ? { ...v, imageFileIds: [file.id] } : v,
      ),
    });
    expect(tee.variants[0]?.imageFileIds).toEqual([file.id]);
    expect(tee.variants[1]?.imageFileIds).toEqual([]);
    const wrongKind = await call('PATCH', `${r()}/products/${tee.id}`, {
      imageFileIds: [logo.json<TenantFileDto>().id],
    });
    expect(wrongKind.json<ApiErrorBody>().code).toBe('FILE_TYPE_NOT_ALLOWED');
  });
});

describe('barcodes and SKUs', () => {
  it('verifies EAN and UPC check digits', async () => {
    const res = await call('POST', `${r()}/products`, {
      categoryId: category.id,
      nameEn: 'Rice',
      nameAr: 'أرز',
      price: 3000,
      barcodes: [{ code: '6291234000019' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().details.issues).toEqual([
      expect.objectContaining({ path: ['barcodes', '0', 'code'], message: 'barcode.CHECK_DIGIT' }),
    ]);
  });

  it('refuses a code another product of the tenant has, and allows it in another tenant', async () => {
    await send<Product>('POST', `${r()}/products`, teeShirt());
    const rice = {
      categoryId: category.id,
      nameEn: 'Rice',
      nameAr: 'أرز',
      price: 3000,
      barcodes: [{ code: '6291234000018' }],
    };
    const taken = await call('POST', `${r()}/products`, rice);
    expect(taken.statusCode).toBe(409);
    expect(taken.json<ApiErrorBody>()).toMatchObject({
      code: 'BARCODE_TAKEN',
      details: { code: '6291234000018' },
    });

    const other = await createTenant(prisma);
    await setModule(other.tenantId, 'BARCODE', true);
    const otherOwner = bearer(await login(app, other.owner.email));
    const otherCategory = await app.inject({
      method: 'POST',
      url: `${r(other.tenantId)}/categories`,
      headers: otherOwner,
      payload: { nameEn: 'Pantry', nameAr: 'مؤن' },
    });
    const elsewhere = await app.inject({
      method: 'POST',
      url: `${r(other.tenantId)}/products`,
      headers: otherOwner,
      payload: { ...rice, categoryId: otherCategory.json<Category>().id },
    });
    expect(elsewhere.statusCode, elsewhere.body).toBe(201);
    expect(elsewhere.json<Product>().barcodes.map((b) => b.code)).toEqual(['6291234000018']);
  });

  it('keeps product-level codes off products with variants', async () => {
    const rice = await send<Product>('POST', `${r()}/products`, {
      categoryId: category.id,
      nameEn: 'Rice',
      nameAr: 'أرز',
      price: 3000,
      barcodes: [{ code: '6291000000013' }],
    });
    const res = await call('PATCH', `${r()}/products/${rice.id}`, {
      variants: [{ nameEn: '5 kg', nameAr: '5 كغ', price: 3000 }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'BARCODE_INVALID',
      details: { reason: 'VARIANT_REQUIRED' },
    });
  });

  it('needs the BARCODE module for new codes', async () => {
    await setModule(tenant.tenantId, 'BARCODE', false);
    const res = await call('POST', `${r()}/products`, teeShirt());
    expect(res.statusCode).toBe(403);
    expect(res.json<ApiErrorBody>()).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { feature: 'BARCODE' },
    });
  });

  it('keeps SKUs unique across products and variants of the tenant', async () => {
    await send<Product>('POST', `${r()}/products`, teeShirt());
    const clash = await call('POST', `${r()}/products`, {
      categoryId: category.id,
      sku: 'TEE-2',
      nameEn: 'Polo',
      nameAr: 'بولو',
      price: 9000,
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json<ApiErrorBody>()).toMatchObject({
      code: 'SKU_TAKEN',
      details: { sku: 'TEE-2' },
    });
    const variantClash = await call('POST', `${r()}/products`, {
      categoryId: category.id,
      nameEn: 'Polo',
      nameAr: 'بولو',
      price: 9000,
      variants: [{ nameEn: 'One size', nameAr: 'مقاس واحد', price: 9000, sku: 'TEE' }],
    });
    expect(variantClash.json<ApiErrorBody>().code).toBe('SKU_TAKEN');
  });

  it('finds a product by a scanned code in the admin search', async () => {
    const tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    const res = await call('GET', `${r()}/products?search=6291234000032`);
    expect(res.json<Product[]>().map((p) => p.id)).toEqual([tee.id]);
  });

  it('records a configuration change for every catalog table the hub mirrors', async () => {
    const before = await prisma.changeLog.count({ where: { tenantId: tenant.tenantId } });
    const tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    const afterCreate = await prisma.changeLog.count({ where: { tenantId: tenant.tenantId } });
    expect(afterCreate).toBeGreaterThan(before);
    // Each table on its own, outside the API's transaction, so every trigger is seen.
    const [variant] = tee.variants;
    const writes: [string, () => Promise<unknown>][] = [
      [
        'product_barcodes',
        () =>
          prisma.productBarcode.updateMany({
            where: { variantId: variant!.id },
            data: { isPrimary: false },
          }),
      ],
      [
        'product_options',
        () =>
          prisma.productOption.updateMany({
            where: { productId: tee.id },
            data: { nameEn: 'Fit' },
          }),
      ],
      [
        'product_option_values',
        () =>
          prisma.productOptionValue.update({
            where: { id: tee.options[0]!.values[0]!.id },
            data: { nameEn: 'Small' },
          }),
      ],
      [
        'product_variant_option_values',
        () => prisma.productVariantOptionValue.deleteMany({ where: { variantId: variant!.id } }),
      ],
    ];
    for (const [table, write] of writes) {
      const count = await prisma.changeLog.count({ where: { tenantId: tenant.tenantId } });
      await write();
      expect(await prisma.changeLog.count({ where: { tenantId: tenant.tenantId } }), table).toBe(
        count + 1,
      );
    }
  });
});

describe('code lookup at a location', () => {
  let tee: Product;
  let rice: Product;

  beforeEach(async () => {
    tee = await send<Product>('POST', `${r()}/products`, teeShirt());
    rice = await send<Product>('POST', `${r()}/products`, {
      categoryId: category.id,
      sku: 'RICE-5KG',
      nameEn: 'Rice 5 kg',
      nameAr: 'أرز 5 كغ',
      price: 3000,
      barcodes: [{ code: '036000291452', isPrimary: true }, { code: 'RICE-BAG' }],
    });
  });

  const lookup = (code: string, headers = cashier) =>
    call('GET', `${loc()}/catalog/lookup?code=${encodeURIComponent(code)}`, undefined, headers);

  it('finds a product by its barcode, with the location’s price', async () => {
    await app.inject({
      method: 'PUT',
      url: `${loc()}/products/${rice.id}/settings`,
      headers: owner,
      payload: { isAvailable: true, priceOverride: 2800 },
    });
    const res = await lookup('036000291452');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CatalogLookup>()).toMatchObject({
      code: '036000291452',
      matchedBy: 'BARCODE',
      categoryId: category.id,
      variantId: null,
      product: { id: rice.id, price: 2800, isAvailable: true },
    });
    // The same UPC-A, scanned as an EAN-13.
    expect((await lookup('0036000291452')).json<CatalogLookup>().product.id).toBe(rice.id);
  });

  it('finds a variant by its barcode or SKU', async () => {
    expect((await lookup('6291234000032')).json<CatalogLookup>()).toMatchObject({
      product: { id: tee.id },
      variantId: tee.variants[2]!.id,
    });
    expect((await lookup('TEE-1')).json<CatalogLookup>()).toMatchObject({
      variantId: tee.variants[1]!.id,
      matchedBy: 'SKU',
    });
  });

  it('answers 404 for an unknown code, and 403 where BARCODE is off', async () => {
    const unknown = await lookup('4006381333931');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().code).toBe('BARCODE_NOT_FOUND');

    await prisma.featureOverride.create({
      data: {
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
        scope: `location:${tenant.locationA}`,
        feature: 'BARCODE',
        enabled: false,
      },
    });
    const off = await lookup('036000291452');
    expect(off.statusCode).toBe(403);
    expect(off.json<ApiErrorBody>()).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { feature: 'BARCODE' },
    });
    const menu = (await call('GET', `${loc()}/menu`, undefined, cashier)).json<PublishedMenu>();
    expect(menu.categories.flatMap((c) => c.products).flatMap((p) => p.barcodes)).toEqual([]);
  });

  it('keeps the scanned code and the SKU on the order line', async () => {
    const res = await call(
      'POST',
      `${loc()}/orders`,
      {
        id: newId(),
        channel: 'TAKEAWAY',
        status: 'PLACED',
        items: [
          {
            id: newId(),
            productId: tee.id,
            variantId: tee.variants[3]!.id,
            quantity: 2,
            barcode: '6291234000049',
          },
          { id: newId(), productId: rice.id, quantity: 1 },
        ],
      },
      cashier,
    );
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json<Order>();
    expect(order.items.map((i) => [i.variantNameEn, i.sku, i.barcode, i.unitPrice])).toEqual([
      ['M / Blue', 'TEE-3', '6291234000049', 6500],
      [null, 'RICE-5KG', '036000291452', 3000],
    ]);
    expect(order.total).toBe(6500 * 2 + 3000);

    const wrong = await call(
      'POST',
      `${loc()}/orders`,
      {
        id: newId(),
        channel: 'TAKEAWAY',
        items: [
          {
            id: newId(),
            productId: tee.id,
            variantId: tee.variants[0]!.id,
            quantity: 1,
            barcode: '6291234000049',
          },
        ],
      },
      cashier,
    );
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json<ApiErrorBody>()).toMatchObject({
      code: 'BARCODE_NOT_FOUND',
      details: { reason: 'NOT_ON_ITEM' },
    });
  });
});
