import { DomainError } from '../errors';
import { sumMinor } from '../money/arithmetic';
import type { ItemSelection, MenuProduct, PricedModifier, PricedSelection } from './types';

/**
 * Validates a customer's/cashier's choice for one menu item against the location's resolved
 * menu and prices it. The single source of truth used by the POS (preview), the website
 * (preview) and the backend/hub (authoritative).
 *
 * Rules:
 *  - the product must exist and be available at the location;
 *  - a variant is required iff the product has variants, and must belong to it;
 *  - every modifier must belong to one of the product's modifier groups, at most once;
 *  - each group's selection count must be within [minSelect, maxSelect].
 *
 *  - a scanned code must be one of the chosen variant's (or the product's) barcodes.
 *
 * Unit price = (variant price or product price) + Σ modifier price deltas.
 */
export function validateSelection(
  product: MenuProduct | undefined,
  selection: ItemSelection,
): PricedSelection {
  if (!product) {
    throw new DomainError('PRODUCT_NOT_FOUND', 'Product is not on this menu', {
      productId: selection.productId,
    });
  }
  if (!product.isAvailable) {
    throw new DomainError('PRODUCT_UNAVAILABLE', 'Product is unavailable', {
      productId: product.id,
    });
  }

  let basePrice = product.price;
  let variant: MenuProduct['variants'][number] | undefined;
  if (product.variants.length > 0) {
    if (selection.variantId === null) {
      throw new DomainError('VARIANT_NOT_FOUND', 'A variant must be chosen', {
        productId: product.id,
        reason: 'VARIANT_REQUIRED',
      });
    }
    variant = product.variants.find((v) => v.id === selection.variantId);
    if (!variant) {
      throw new DomainError('VARIANT_NOT_FOUND', 'Variant does not belong to product', {
        productId: product.id,
        variantId: selection.variantId,
      });
    }
    basePrice = variant.price;
  } else if (selection.variantId !== null) {
    throw new DomainError('VARIANT_NOT_FOUND', 'Product has no variants', {
      productId: product.id,
      variantId: selection.variantId,
    });
  }

  const codes = variant ? variant.barcodes : product.barcodes;
  const scanned = selection.barcode ?? null;
  if (scanned !== null && !codes.includes(scanned)) {
    throw new DomainError('BARCODE_NOT_FOUND', 'Barcode is not one of this item’s', {
      productId: product.id,
      variantId: selection.variantId,
      barcode: scanned,
      reason: 'NOT_ON_ITEM',
    });
  }

  const groupOfModifier = new Map<string, { groupId: string; priceDelta: number }>();
  for (const group of product.modifierGroups) {
    for (const modifier of group.modifiers) {
      groupOfModifier.set(modifier.id, { groupId: group.id, priceDelta: modifier.priceDelta });
    }
  }

  const seen = new Set<string>();
  const countByGroup = new Map<string, number>();
  const modifiers: PricedModifier[] = [];
  for (const modifierId of selection.modifierIds) {
    if (seen.has(modifierId)) {
      throw new DomainError('INVALID_MODIFIER_SELECTION', 'Modifier selected twice', {
        reason: 'DUPLICATE_MODIFIER',
        modifierId,
      });
    }
    seen.add(modifierId);
    const entry = groupOfModifier.get(modifierId);
    if (!entry) {
      throw new DomainError('INVALID_MODIFIER_SELECTION', 'Modifier not offered for product', {
        reason: 'MODIFIER_NOT_ALLOWED',
        modifierId,
      });
    }
    countByGroup.set(entry.groupId, (countByGroup.get(entry.groupId) ?? 0) + 1);
    modifiers.push({ modifierId, modifierGroupId: entry.groupId, priceDelta: entry.priceDelta });
  }

  for (const group of product.modifierGroups) {
    const count = countByGroup.get(group.id) ?? 0;
    if (count < group.minSelect) {
      throw new DomainError('INVALID_MODIFIER_SELECTION', 'Too few modifiers in group', {
        reason: 'BELOW_MIN',
        modifierGroupId: group.id,
        min: group.minSelect,
        selected: count,
      });
    }
    if (group.maxSelect !== null && count > group.maxSelect) {
      throw new DomainError('INVALID_MODIFIER_SELECTION', 'Too many modifiers in group', {
        reason: 'ABOVE_MAX',
        modifierGroupId: group.id,
        max: group.maxSelect,
        selected: count,
      });
    }
  }

  return {
    productId: product.id,
    variantId: selection.variantId,
    basePrice,
    modifiers,
    unitPrice: sumMinor([basePrice, ...modifiers.map((m) => m.priceDelta)]),
    stationIds: product.stationIds,
    sku: variant?.sku ?? product.sku,
    barcode: scanned ?? codes[0] ?? null,
  };
}

/** Effective selection bounds are valid when 0 ≤ min, max ≥ 1 and max ≥ min (or max unlimited). */
export function isValidSelectionRange(minSelect: number, maxSelect: number | null): boolean {
  if (!Number.isInteger(minSelect) || minSelect < 0) return false;
  if (maxSelect === null) return true;
  return Number.isInteger(maxSelect) && maxSelect >= 1 && maxSelect >= minSelect;
}
