import { describe, expect, it } from 'vitest';
import {
  createModifierGroupSchema,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from './menu';

const id = '01890a5d-ac96-774b-bcce-b302099a8057';
const id2 = '01890a5d-ac96-774b-bcce-b302099a8058';

describe('menu schemas', () => {
  it('fills product defaults', () => {
    const parsed = createProductSchema.parse({
      categoryId: id,
      nameEn: 'Burger',
      nameAr: 'برجر',
      price: 2500,
    });
    expect(parsed).toMatchObject({
      sku: null,
      variants: [],
      modifierGroups: [],
      stationIds: [],
      sortOrder: 0,
      descriptionEn: null,
    });
  });

  it('rejects float prices and duplicate links', () => {
    expect(
      createProductSchema.safeParse({ categoryId: id, nameEn: 'a', nameAr: 'b', price: 25.5 })
        .success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({
        categoryId: id,
        nameEn: 'a',
        nameAr: 'b',
        price: 1,
        stationIds: [id, id],
      }).success,
    ).toBe(false);
    expect(
      createProductSchema.safeParse({
        categoryId: id,
        nameEn: 'a',
        nameAr: 'b',
        price: 1,
        modifierGroups: [{ modifierGroupId: id2 }, { modifierGroupId: id2 }],
      }).success,
    ).toBe(false);
  });

  it('validates modifier group selection ranges', () => {
    const base = { nameEn: 'Size', nameAr: 'الحجم', modifiers: [{ nameEn: 'S', nameAr: 'ص' }] };
    expect(
      createModifierGroupSchema.safeParse({ ...base, minSelect: 1, maxSelect: 1 }).success,
    ).toBe(true);
    expect(
      createModifierGroupSchema.safeParse({ ...base, minSelect: 2, maxSelect: 1 }).success,
    ).toBe(false);
    expect(
      createModifierGroupSchema.safeParse({ ...base, minSelect: 2, maxSelect: null }).success,
    ).toBe(false);
    expect(createModifierGroupSchema.safeParse({ ...base, modifiers: [] }).success).toBe(false);
  });

  it('rejects empty updates', () => {
    expect(updateProductSchema.safeParse({}).success).toBe(false);
  });

  it('parses boolean query strings strictly', () => {
    expect(listProductsQuerySchema.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(listProductsQuerySchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(listProductsQuerySchema.parse({}).includeArchived).toBe(false);
    expect(listProductsQuerySchema.safeParse({ includeArchived: '1' }).success).toBe(false);
  });
});

describe('retail catalog schemas (ADR 0021)', () => {
  const base = { categoryId: id, nameEn: 'T-shirt', nameAr: 'قميص', price: 6000 };
  const size = {
    nameEn: 'Size',
    nameAr: 'المقاس',
    values: [
      { nameEn: 'S', nameAr: 'صغير' },
      { nameEn: 'M', nameAr: 'وسط' },
    ],
  };
  const colour = { nameEn: 'Colour', nameAr: 'اللون', values: [{ nameEn: 'Red', nameAr: 'أحمر' }] };

  it('detects the symbology of a typed code and verifies its check digit', () => {
    const parsed = createProductSchema.parse({
      ...base,
      barcodes: [{ code: ' 4006381333931 ', isPrimary: true }, { code: 'TEE-1' }],
    });
    expect(parsed.barcodes).toEqual([
      { code: '4006381333931', symbology: 'EAN13', isPrimary: true },
      { code: 'TEE-1', symbology: 'CODE128', isPrimary: false },
    ]);
    const typo = createProductSchema.safeParse({ ...base, barcodes: [{ code: '4006381333930' }] });
    expect(typo.error?.issues[0]).toMatchObject({
      path: ['barcodes', 0, 'code'],
      message: 'barcode.CHECK_DIGIT',
    });
    expect(
      createProductSchema.safeParse({
        ...base,
        barcodes: [{ code: '4006381333931', symbology: 'UPC_A' }],
      }).success,
    ).toBe(false);
  });

  it('accepts a matrix of option values, named after them', () => {
    const parsed = createProductSchema.parse({
      ...base,
      options: [size, colour],
      variants: [
        { price: 6000, optionValues: [0, 0], sku: 'TEE-S-R', barcodes: [{ code: '96385074' }] },
        { price: 6500, optionValues: [1, 0], cost: 2500, trackInventory: true },
      ],
    });
    expect(parsed.variants[1]).toMatchObject({ cost: 2500, trackInventory: true, sku: null });
    expect(parsed.variants[0]?.barcodes).toEqual([
      { code: '96385074', symbology: 'EAN8', isPrimary: false },
    ]);
  });

  it('refuses variants that do not match the options', () => {
    const issue = (body: object) =>
      createProductSchema.safeParse({ ...base, ...body }).error?.issues.map((i) => i.message);
    expect(issue({ options: [size, colour], variants: [{ price: 1, optionValues: [0] }] })).toEqual(
      ['WRONG_VALUE_COUNT'],
    );
    expect(
      issue({
        options: [size],
        variants: [
          { price: 1, optionValues: [1] },
          { price: 1, optionValues: [1] },
        ],
      }),
    ).toEqual(['DUPLICATE_COMBINATION']);
    expect(issue({ options: [size], variants: [] })).toEqual([
      'A product with options needs variants',
    ]);
    // Without options, variants are named by hand.
    expect(issue({ variants: [{ price: 1 }] })).toEqual(['Required', 'Required']);
  });

  it('keeps codes and SKUs unique within the request', () => {
    const issues = createProductSchema.safeParse({
      ...base,
      sku: 'TEE',
      variants: [
        { nameEn: 'S', nameAr: 'ص', price: 1, sku: 'TEE', barcodes: [{ code: 'X1' }] },
        { nameEn: 'M', nameAr: 'م', price: 1, barcodes: [{ code: 'X1' }] },
      ],
      barcodes: [{ code: 'X2' }],
    }).error?.issues;
    expect(issues?.map((i) => i.message).sort()).toEqual([
      'Barcodes belong to the variants',
      'Duplicate SKU',
      'Duplicate barcode',
    ]);
    expect(
      createProductSchema.safeParse({
        ...base,
        barcodes: [
          { code: 'A1', isPrimary: true },
          { code: 'A2', isPrimary: true },
        ],
      }).success,
    ).toBe(false);
  });

  it('saves options together with their variants', () => {
    expect(updateProductSchema.safeParse({ options: [size] }).success).toBe(false);
    expect(
      updateProductSchema.safeParse({
        options: [size],
        variants: [{ price: 1, optionValues: [0] }],
      }).success,
    ).toBe(true);
    // Variants alone refer to the stored options; the server checks them.
    expect(
      updateProductSchema.safeParse({ variants: [{ price: 1, optionValues: [0] }] }).success,
    ).toBe(true);
  });
});
