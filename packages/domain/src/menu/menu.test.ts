import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { sampleCatalog } from './fixtures.test-helpers';
import { lookupCode } from './lookup';
import { findMenuProduct, resolveLocationMenu } from './resolve-location-menu';
import type { ItemSelection, LocationMenu } from './types';
import { isValidSelectionRange, validateSelection } from './validate-selection';

function expectDomainError(fn: () => unknown, code: string, details?: Record<string, unknown>) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    if (details) expect((error as DomainError).details).toMatchObject(details);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('resolveLocationMenu', () => {
  const menu = resolveLocationMenu(sampleCatalog(), []);

  it('orders categories and products and drops archived or empty categories', () => {
    expect(menu.categories.map((c) => c.id)).toEqual(['cat-mains', 'cat-drinks']);
    expect(menu.categories[0]!.products.map((p) => p.id)).toEqual(['prod-burger', 'prod-fries']);
  });

  it('drops archived variants, modifiers and stations; orders groups by product link order', () => {
    const cola = findMenuProduct(menu, 'prod-cola')!;
    expect(cola.variants.map((v) => v.id)).toEqual(['var-small', 'var-large']);
    const burger = findMenuProduct(menu, 'prod-burger')!;
    expect(burger.modifierGroups.map((g) => g.id)).toEqual(['grp-doneness', 'grp-extras']);
    expect(burger.modifierGroups[1]!.modifiers.map((m) => m.id)).not.toContain('mod-gone');
    expect(burger.stationIds).toEqual(['st-kitchen', 'st-grill']);
  });

  it('applies location availability and price overrides (not to variant products)', () => {
    const local = resolveLocationMenu(sampleCatalog(), [
      { productId: 'prod-fries', isAvailable: false, priceOverride: null },
      { productId: 'prod-burger', isAvailable: true, priceOverride: 2700 },
      { productId: 'prod-cola', isAvailable: true, priceOverride: 1 },
    ]);
    expect(findMenuProduct(local, 'prod-fries')!.isAvailable).toBe(false);
    expect(findMenuProduct(local, 'prod-burger')!.price).toBe(2700);
    expect(findMenuProduct(local, 'prod-cola')!.price).toBe(600);
  });

  it('applies per-product modifier min/max overrides', () => {
    const catalog = sampleCatalog();
    catalog.products[0]!.modifierGroups[0] = {
      modifierGroupId: 'grp-extras',
      sortOrder: 2,
      minSelect: 1,
      maxSelect: 3,
    };
    const burger = findMenuProduct(resolveLocationMenu(catalog, []), 'prod-burger')!;
    expect(burger.modifierGroups.find((g) => g.id === 'grp-extras')).toMatchObject({
      minSelect: 1,
      maxSelect: 3,
    });
  });

  it('sells products without modifier groups where the MODIFIERS module is off', () => {
    const plain = resolveLocationMenu(sampleCatalog(), [], { modifiers: false, barcodes: true });
    const burger = findMenuProduct(plain, 'prod-burger')!;
    expect(burger.modifierGroups).toEqual([]);
    // Nothing is required any more, and a modifier is no longer part of the menu.
    expect(
      validateSelection(burger, { productId: 'prod-burger', variantId: null, modifierIds: [] })
        .modifiers,
    ).toEqual([]);
    expectDomainError(
      () =>
        validateSelection(burger, {
          productId: 'prod-burger',
          variantId: null,
          modifierIds: ['mod-cheese'],
        }),
      'INVALID_MODIFIER_SELECTION',
    );
  });
});

describe('validateSelection', () => {
  const menu: LocationMenu = resolveLocationMenu(sampleCatalog(), [
    { productId: 'prod-fries', isAvailable: false, priceOverride: null },
  ]);
  const select = (s: Partial<ItemSelection> & { productId: string }) =>
    validateSelection(findMenuProduct(menu, s.productId), {
      variantId: null,
      modifierIds: [],
      ...s,
    });

  it('prices base + modifier deltas and returns kitchen routing', () => {
    const priced = select({
      productId: 'prod-burger',
      modifierIds: ['mod-well', 'mod-cheese', 'mod-bacon'],
    });
    expect(priced.basePrice).toBe(2500);
    expect(priced.unitPrice).toBe(2500 + 300 + 500);
    expect(priced.modifiers).toEqual([
      { modifierId: 'mod-well', modifierGroupId: 'grp-doneness', priceDelta: 0 },
      { modifierId: 'mod-cheese', modifierGroupId: 'grp-extras', priceDelta: 300 },
      { modifierId: 'mod-bacon', modifierGroupId: 'grp-extras', priceDelta: 500 },
    ]);
    expect(priced.stationIds).toEqual(['st-kitchen', 'st-grill']);
  });

  it('uses the variant price', () => {
    expect(select({ productId: 'prod-cola', variantId: 'var-large' }).unitPrice).toBe(800);
  });

  it('rejects unknown and unavailable products', () => {
    expectDomainError(() => select({ productId: 'nope' }), 'PRODUCT_NOT_FOUND');
    expectDomainError(() => select({ productId: 'prod-retired' }), 'PRODUCT_NOT_FOUND');
    expectDomainError(() => select({ productId: 'prod-fries' }), 'PRODUCT_UNAVAILABLE');
  });

  it('enforces variant rules', () => {
    expectDomainError(() => select({ productId: 'prod-cola' }), 'VARIANT_NOT_FOUND', {
      reason: 'VARIANT_REQUIRED',
    });
    expectDomainError(
      () => select({ productId: 'prod-cola', variantId: 'var-old' }),
      'VARIANT_NOT_FOUND',
    );
    expectDomainError(
      () =>
        select({ productId: 'prod-burger', variantId: 'var-small', modifierIds: ['mod-medium'] }),
      'VARIANT_NOT_FOUND',
    );
  });

  it('enforces group minimums and maximums', () => {
    expectDomainError(() => select({ productId: 'prod-burger' }), 'INVALID_MODIFIER_SELECTION', {
      reason: 'BELOW_MIN',
      modifierGroupId: 'grp-doneness',
    });
    expectDomainError(
      () => select({ productId: 'prod-burger', modifierIds: ['mod-medium', 'mod-well'] }),
      'INVALID_MODIFIER_SELECTION',
      { reason: 'ABOVE_MAX', modifierGroupId: 'grp-doneness' },
    );
    expectDomainError(
      () =>
        select({
          productId: 'prod-burger',
          modifierIds: ['mod-medium', 'mod-cheese', 'mod-bacon', 'mod-egg'],
        }),
      'INVALID_MODIFIER_SELECTION',
      { reason: 'ABOVE_MAX', modifierGroupId: 'grp-extras' },
    );
  });

  it('rejects foreign, archived and duplicate modifiers', () => {
    expectDomainError(
      () => select({ productId: 'prod-fries', modifierIds: ['mod-cheese'] }),
      'PRODUCT_UNAVAILABLE',
    );
    expectDomainError(
      () => select({ productId: 'prod-burger', modifierIds: ['mod-medium', 'mod-gone'] }),
      'INVALID_MODIFIER_SELECTION',
      { reason: 'MODIFIER_NOT_ALLOWED' },
    );
    expectDomainError(
      () =>
        select({
          productId: 'prod-burger',
          modifierIds: ['mod-medium', 'mod-cheese', 'mod-cheese'],
        }),
      'INVALID_MODIFIER_SELECTION',
      { reason: 'DUPLICATE_MODIFIER' },
    );
  });
});

describe('barcodes and SKUs on the menu (ADR 0021)', () => {
  const menu = resolveLocationMenu(sampleCatalog(), []);

  it('publishes each variant’s codes and the codes of products without variants, primary first', () => {
    const fries = findMenuProduct(menu, 'prod-fries')!;
    expect(fries.barcodes).toEqual(['6291000000013', 'FRIES-BAG']);
    const cola = findMenuProduct(menu, 'prod-cola')!;
    expect(cola.barcodes).toEqual([]);
    expect(cola.variants.map((v) => [v.id, v.sku, v.barcodes])).toEqual([
      ['var-small', 'COLA-S', ['6291000000020']],
      ['var-large', 'COLA-L', ['012345678905']],
    ]);
  });

  it('publishes no barcodes where the BARCODE module is off', () => {
    const plain = resolveLocationMenu(sampleCatalog(), [], { modifiers: true, barcodes: false });
    expect(findMenuProduct(plain, 'prod-fries')!.barcodes).toEqual([]);
    expect(
      findMenuProduct(plain, 'prod-cola')!.variants.every((v) => v.barcodes.length === 0),
    ).toBe(true);
    expect(lookupCode(plain, '6291000000013')).toBeNull();
  });

  it('looks a code up by product and by variant', () => {
    expect(lookupCode(menu, '6291000000013')).toMatchObject({
      categoryId: 'cat-mains',
      product: { id: 'prod-fries' },
      variant: null,
      matchedBy: 'BARCODE',
    });
    expect(lookupCode(menu, ' FRIES-BAG ')).toMatchObject({ product: { id: 'prod-fries' } });
    expect(lookupCode(menu, '6291000000020')).toMatchObject({
      product: { id: 'prod-cola' },
      variant: { id: 'var-small', price: 600 },
    });
  });

  it('finds a UPC-A scanned as an EAN-13', () => {
    expect(lookupCode(menu, '0012345678905')).toMatchObject({
      variant: { id: 'var-large' },
      code: '012345678905',
    });
  });

  it('falls back to SKUs, and never finds archived variants or unknown codes', () => {
    expect(lookupCode(menu, 'COLA-L')).toMatchObject({
      variant: { id: 'var-large' },
      matchedBy: 'SKU',
    });
    expect(lookupCode(menu, 'BRG')).toMatchObject({
      product: { id: 'prod-burger' },
      variant: null,
    });
    expect(lookupCode(menu, '6291000000037')).toBeNull();
    expect(lookupCode(menu, '0000000000000')).toBeNull();
    expect(lookupCode(menu, '  ')).toBeNull();
  });

  it('prices a looked-up variant like a chosen one, and keeps its SKU and barcode', () => {
    const match = lookupCode(menu, '012345678905')!;
    const priced = validateSelection(match.product, {
      productId: match.product.id,
      variantId: match.variant?.id ?? null,
      modifierIds: [],
      barcode: match.code,
    });
    expect(priced).toMatchObject({
      variantId: 'var-large',
      basePrice: 800,
      unitPrice: 800,
      sku: 'COLA-L',
      barcode: '012345678905',
    });
  });

  it('keeps the primary barcode on lines that were not scanned', () => {
    const fries = findMenuProduct(menu, 'prod-fries')!;
    expect(
      validateSelection(fries, { productId: 'prod-fries', variantId: null, modifierIds: [] }),
    ).toMatchObject({ sku: null, barcode: '6291000000013' });
  });

  it('refuses a scanned code that is not the item’s', () => {
    const cola = findMenuProduct(menu, 'prod-cola')!;
    expectDomainError(
      () =>
        validateSelection(cola, {
          productId: 'prod-cola',
          variantId: 'var-large',
          modifierIds: [],
          barcode: '6291000000020',
        }),
      'BARCODE_NOT_FOUND',
      { reason: 'NOT_ON_ITEM' },
    );
  });
});

describe('product pictures on the menu (ADR 0027)', () => {
  it('publishes the first picture of each product and of each variant as its cover', () => {
    const catalog = sampleCatalog();
    const fries = catalog.products.find((p) => p.id === 'prod-fries')!;
    fries.images = [
      { fileId: 'file-second', variantId: null, sortOrder: 1 },
      { fileId: 'file-first', variantId: null, sortOrder: 0 },
    ];
    const cola = catalog.products.find((p) => p.id === 'prod-cola')!;
    cola.images = [{ fileId: 'file-large', variantId: 'var-large', sortOrder: 0 }];
    const menu = resolveLocationMenu(catalog, []);

    expect(findMenuProduct(menu, 'prod-fries')!.imageFileId).toBe('file-first');
    const publishedCola = findMenuProduct(menu, 'prod-cola')!;
    // A variant's picture is its own; the product without one has no cover.
    expect(publishedCola.imageFileId).toBeNull();
    expect(publishedCola.variants.map((v) => [v.id, v.imageFileId])).toEqual([
      ['var-small', null],
      ['var-large', 'file-large'],
    ]);
  });
});

describe('isValidSelectionRange', () => {
  it.each([
    [0, null, true],
    [0, 1, true],
    [2, 2, true],
    [1, 3, true],
    [-1, null, false],
    [0, 0, false],
    [3, 2, false],
    [0.5, 1, false],
  ])('min %s max %s -> %s', (min, max, ok) => {
    expect(isValidSelectionRange(min, max)).toBe(ok);
  });
});
