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
  price: number;
  sortOrder: number;
  archivedAt: Date | null;
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
  price: number;
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
}
