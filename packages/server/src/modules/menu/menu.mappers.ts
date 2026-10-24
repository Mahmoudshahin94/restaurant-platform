import type {
  Category as CategoryRow,
  KitchenStation as KitchenStationRow,
  LocationProduct as LocationProductRow,
  Modifier as ModifierRow,
  ModifierGroup as ModifierGroupRow,
  Product as ProductRow,
  ProductBarcode as ProductBarcodeRow,
  ProductImage as ProductImageRow,
  ProductModifierGroup as ProductModifierGroupRow,
  ProductOption as ProductOptionRow,
  ProductOptionValue as ProductOptionValueRow,
  ProductStation as ProductStationRow,
  ProductTax as ProductTaxRow,
  ProductVariant as ProductVariantRow,
  ProductVariantOptionValue as ProductVariantOptionValueRow,
} from '@pos/database';
import type { CatalogModifierGroup, CatalogProduct } from '@pos/domain';
import type { BarcodeSymbology } from '@pos/shared-types';
import type {
  Category,
  KitchenStation,
  LocationProductSetting,
  ModifierGroup,
  Product,
  ProductBarcode,
} from '@pos/validation';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);
const bySort = <T extends { sortOrder: number; id: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

export type OptionWithValues = ProductOptionRow & { values: ProductOptionValueRow[] };
export type VariantWithValues = ProductVariantRow & {
  optionValues: ProductVariantOptionValueRow[];
};

/** What the published menu needs of a product. */
export type CatalogProductRow = ProductRow & {
  variants: ProductVariantRow[];
  modifierGroups: ProductModifierGroupRow[];
  stations: ProductStationRow[];
  taxes: ProductTaxRow[];
  barcodes: ProductBarcodeRow[];
};

/** A product with everything the admin edits (ADR 0021: options, barcodes, pictures). */
export type ProductWithRelations = Omit<CatalogProductRow, 'variants'> & {
  variants: VariantWithValues[];
  options: OptionWithValues[];
  images: ProductImageRow[];
};

export type ModifierGroupWithModifiers = ModifierGroupRow & { modifiers: ModifierRow[] };

/** Prisma include for the published menu (`toCatalogProduct`). */
export const catalogProductInclude = {
  variants: true,
  modifierGroups: true,
  stations: true,
  taxes: true,
  barcodes: true,
} as const;

/** Prisma include for a product with everything its DTO needs. */
export const productInclude = {
  ...catalogProductInclude,
  variants: { include: { optionValues: true } },
  options: { include: { values: true } },
  images: true,
} as const;

/** Primary first, then in code order: how a product's or variant's barcodes are listed. */
export const byPrimary = (a: { isPrimary: boolean; code: string }, b: typeof a) =>
  Number(b.isPrimary) - Number(a.isPrimary) || a.code.localeCompare(b.code);

function toBarcodeDto(row: ProductBarcodeRow): ProductBarcode {
  return {
    id: row.id,
    code: row.code,
    symbology: row.symbology as BarcodeSymbology,
    isPrimary: row.isPrimary,
  };
}

/** The product's options and their values, in display order. */
export function sortedOptions(options: readonly OptionWithValues[]): OptionWithValues[] {
  return [...options].sort(bySort).map((o) => ({ ...o, values: [...o.values].sort(bySort) }));
}

export function toCategoryDto(row: CategoryRow): Category {
  return {
    id: row.id,
    tenantId: row.tenantId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    descriptionEn: row.descriptionEn,
    descriptionAr: row.descriptionAr,
    sortOrder: row.sortOrder,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toKitchenStationDto(row: KitchenStationRow): KitchenStation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    sortOrder: row.sortOrder,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Archived modifiers are omitted: they are history, not part of the editable group. */
export function toModifierGroupDto(row: ModifierGroupWithModifiers): ModifierGroup {
  return {
    id: row.id,
    tenantId: row.tenantId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    sortOrder: row.sortOrder,
    archivedAt: isoOrNull(row.archivedAt),
    modifiers: row.modifiers
      .filter((m) => m.archivedAt === null)
      .sort(bySort)
      .map((m) => ({
        id: m.id,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceDelta: m.priceDelta,
        isDefault: m.isDefault,
        sortOrder: m.sortOrder,
        archivedAt: isoOrNull(m.archivedAt),
      })),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toProductDto(row: ProductWithRelations): Product {
  const options = sortedOptions(row.options);
  // A variant's values are listed in option order.
  const optionOfValue = new Map(
    options.flatMap((o, index) => o.values.map((v) => [v.id, index] as const)),
  );
  const barcodesOf = (variantId: string | null) =>
    row.barcodes
      .filter((b) => b.variantId === variantId)
      .sort(byPrimary)
      .map(toBarcodeDto);
  const imagesOf = (variantId: string | null) =>
    row.images
      .filter((i) => i.variantId === variantId)
      .sort(bySort)
      .map((i) => i.fileId);
  return {
    id: row.id,
    tenantId: row.tenantId,
    categoryId: row.categoryId,
    sku: row.sku,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    descriptionEn: row.descriptionEn,
    descriptionAr: row.descriptionAr,
    price: row.price,
    sortOrder: row.sortOrder,
    archivedAt: isoOrNull(row.archivedAt),
    options: options.map((o) => ({
      id: o.id,
      nameEn: o.nameEn,
      nameAr: o.nameAr,
      sortOrder: o.sortOrder,
      values: o.values.map((v) => ({
        id: v.id,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        sortOrder: v.sortOrder,
      })),
    })),
    variants: row.variants
      .filter((v) => v.archivedAt === null)
      .sort(bySort)
      .map((v) => ({
        id: v.id,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        sku: v.sku,
        price: v.price,
        cost: v.cost,
        trackInventory: v.trackInventory,
        sortOrder: v.sortOrder,
        optionValueIds: v.optionValues
          .map((l) => l.optionValueId)
          .sort((a, b) => (optionOfValue.get(a) ?? 0) - (optionOfValue.get(b) ?? 0)),
        barcodes: barcodesOf(v.id),
        imageFileIds: imagesOf(v.id),
      })),
    barcodes: barcodesOf(null),
    imageFileIds: imagesOf(null),
    modifierGroups: [...row.modifierGroups]
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.modifierGroupId.localeCompare(b.modifierGroupId),
      )
      .map((l) => ({
        modifierGroupId: l.modifierGroupId,
        sortOrder: l.sortOrder,
        minSelect: l.minSelect,
        maxSelect: l.maxSelect,
      })),
    stationIds: row.stations.map((s) => s.kitchenStationId).sort(),
    taxIds: row.taxes.map((t) => t.taxId).sort(),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toLocationProductDto(row: LocationProductRow): LocationProductSetting {
  return {
    locationId: row.locationId,
    productId: row.productId,
    isAvailable: row.isAvailable,
    priceOverride: row.priceOverride,
    updatedAt: iso(row.updatedAt),
  };
}

export function toCatalogProduct(row: CatalogProductRow): CatalogProduct {
  return {
    id: row.id,
    categoryId: row.categoryId,
    sku: row.sku,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    descriptionEn: row.descriptionEn,
    descriptionAr: row.descriptionAr,
    price: row.price,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    variants: row.variants,
    modifierGroups: row.modifierGroups.map((l) => ({
      modifierGroupId: l.modifierGroupId,
      sortOrder: l.sortOrder,
      minSelect: l.minSelect,
      maxSelect: l.maxSelect,
    })),
    stationIds: row.stations.map((s) => s.kitchenStationId),
    taxIds: row.taxes.map((t) => t.taxId),
    barcodes: row.barcodes.map((b) => ({
      code: b.code,
      variantId: b.variantId,
      isPrimary: b.isPrimary,
    })),
  };
}

export function toCatalogModifierGroup(row: ModifierGroupWithModifiers): CatalogModifierGroup {
  return {
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt,
    modifiers: row.modifiers,
  };
}
