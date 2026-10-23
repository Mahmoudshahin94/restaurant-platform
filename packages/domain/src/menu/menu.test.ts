import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { sampleCatalog } from './fixtures.test-helpers';
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
    const plain = resolveLocationMenu(sampleCatalog(), [], { modifiers: false });
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
