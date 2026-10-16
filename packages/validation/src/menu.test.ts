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
