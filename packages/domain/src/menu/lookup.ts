import { barcodeCandidates } from '../catalog/barcode';
import type { LocationMenu, MenuProduct, MenuVariant } from './types';

/** What a scanned or typed code names on a location's menu. */
export interface CodeMatch {
  categoryId: string;
  product: MenuProduct;
  /** The variant the code names; null for a product without variants. */
  variant: MenuVariant | null;
  /** How it was found: by one of its barcodes, else by its SKU. */
  matchedBy: 'BARCODE' | 'SKU';
  /** The stored code that matched (a UPC-A scanned as an EAN-13 gives the stored form). */
  code: string;
}

/**
 * Finds the product or variant a code names on a location's menu (ADR 0021): its barcodes first,
 * then the SKUs, so a code typed at the till works too. The same function serves the lookup
 * route (cloud and hub) and the POS, which looks codes up in its copy of the menu, offline.
 * Unavailable products are found as well: the caller tells the cashier why it cannot be sold.
 * Codes are unique within a tenant, so at most one item matches by barcode.
 */
export function lookupCode(menu: LocationMenu, raw: string): CodeMatch | null {
  const code = raw.trim();
  if (code.length === 0) return null;
  const candidates = new Set(barcodeCandidates(code));
  let bySku: CodeMatch | null = null;
  for (const category of menu.categories) {
    for (const product of category.products) {
      const productCode = product.barcodes.find((c) => candidates.has(c));
      if (productCode !== undefined) {
        return {
          categoryId: category.id,
          product,
          variant: null,
          matchedBy: 'BARCODE',
          code: productCode,
        };
      }
      for (const variant of product.variants) {
        const variantCode = variant.barcodes.find((c) => candidates.has(c));
        if (variantCode !== undefined) {
          return {
            categoryId: category.id,
            product,
            variant,
            matchedBy: 'BARCODE',
            code: variantCode,
          };
        }
        if (bySku === null && variant.sku === code) {
          bySku = { categoryId: category.id, product, variant, matchedBy: 'SKU', code };
        }
      }
      if (bySku === null && product.sku === code && product.variants.length === 0) {
        bySku = { categoryId: category.id, product, variant: null, matchedBy: 'SKU', code };
      }
    }
  }
  return bySku;
}
