/**
 * Storage-independent menu shapes used by the domain. The API maps Prisma rows into these; the
 * location hub will map SQLite rows into the same shapes, so both run identical rules.
 */

export interface LocalizedName {
  nameEn: string;
  nameAr: string;
}

export interface LocalizedDescription {
  descriptionEn: string | null;
  descriptionAr: string | null;
}

export interface CatalogModifier extends LocalizedName {
  id: string;
  priceDelta: number;
  isDefault: boolean;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface CatalogModifierGroup extends LocalizedName {
  id: string;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  archivedAt: Date | null;
  modifiers: CatalogModifier[];
}

export interface CatalogVariant extends LocalizedName {
  id: string;
  sku: string | null;
  price: number;
  sortOrder: number;
  archivedAt: Date | null;
}

/** A barcode of the product, or of one of its variants (`variantId`). */
export interface CatalogBarcode {
  code: string;
  variantId: string | null;
  isPrimary: boolean;
}

export interface CatalogProductGroupLink {
  modifierGroupId: string;
  sortOrder: number;
  /** Per-product overrides of the group's min/max; null = use the group's value. */
  minSelect: number | null;
  maxSelect: number | null;
}

export interface CatalogProduct extends LocalizedName, LocalizedDescription {
  id: string;
  categoryId: string;
  sku: string | null;
  price: number;
  sortOrder: number;
  archivedAt: Date | null;
  variants: CatalogVariant[];
  modifierGroups: CatalogProductGroupLink[];
  stationIds: string[];
  taxIds: string[];
  barcodes: CatalogBarcode[];
}

export interface CatalogTax extends LocalizedName {
  id: string;
  rateBps: number;
  archivedAt: Date | null;
}

export interface CatalogCategory extends LocalizedName, LocalizedDescription {
  id: string;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface CatalogKitchenStation extends LocalizedName {
  id: string;
  code: string;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface Catalog {
  categories: CatalogCategory[];
  products: CatalogProduct[];
  modifierGroups: CatalogModifierGroup[];
  kitchenStations: CatalogKitchenStation[];
  taxes: CatalogTax[];
}

export interface LocationProductSetting {
  productId: string;
  isAvailable: boolean;
  priceOverride: number | null;
}

// --- Resolved (published) menu for one location -------------------------------------------

export interface MenuModifier extends LocalizedName {
  id: string;
  priceDelta: number;
  isDefault: boolean;
}

export interface MenuModifierGroup extends LocalizedName {
  id: string;
  minSelect: number;
  maxSelect: number | null;
  modifiers: MenuModifier[];
}

export interface MenuVariant extends LocalizedName {
  id: string;
  sku: string | null;
  price: number;
  /** The variant's barcodes, primary first (none without the BARCODE module). */
  barcodes: string[];
}

export interface MenuProduct extends LocalizedName, LocalizedDescription {
  id: string;
  sku: string | null;
  /** Effective price at this location (override applied). */
  price: number;
  isAvailable: boolean;
  stationIds: string[];
  /** Live taxes that apply to this product (rates in LocationMenu.taxes). */
  taxIds: string[];
  variants: MenuVariant[];
  modifierGroups: MenuModifierGroup[];
  /**
   * Barcodes of a product without variants, primary first (a product with variants is scanned
   * by its variants' codes). None without the BARCODE module (ADR 0021).
   */
  barcodes: string[];
}

export interface MenuCategory extends LocalizedName, LocalizedDescription {
  id: string;
  products: MenuProduct[];
}

export interface MenuTax extends LocalizedName {
  id: string;
  rateBps: number;
}

export interface LocationMenu {
  categories: MenuCategory[];
  taxes: MenuTax[];
}

// --- Item selection ---------------------------------------------------------------------------

export interface ItemSelection {
  productId: string;
  variantId: string | null;
  modifierIds: readonly string[];
  /** The code scanned for this line, when it was scanned. It must be one of the item's codes. */
  barcode?: string | null;
}

export interface PricedModifier {
  modifierId: string;
  modifierGroupId: string;
  priceDelta: number;
}

/** A validated selection with its unit price, ready to become an order line (Phase 2). */
export interface PricedSelection {
  productId: string;
  variantId: string | null;
  basePrice: number;
  modifiers: PricedModifier[];
  unitPrice: number;
  stationIds: string[];
  /** The variant's SKU, else the product's (ADR 0021). */
  sku: string | null;
  /** The scanned code, else the item's primary barcode. */
  barcode: string | null;
}
