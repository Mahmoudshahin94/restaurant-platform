import type {
  Category as CategoryRow,
  KitchenStation as KitchenStationRow,
  LocationProduct as LocationProductRow,
  Modifier as ModifierRow,
  ModifierGroup as ModifierGroupRow,
  Product as ProductRow,
  ProductModifierGroup as ProductModifierGroupRow,
  ProductStation as ProductStationRow,
  ProductVariant as ProductVariantRow,
} from '@pos/database';
import type { CatalogModifierGroup, CatalogProduct } from '@pos/domain';
import type {
  Category,
  KitchenStation,
  LocationProductSetting,
  ModifierGroup,
  Product,
} from '@pos/validation';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);
const bySort = <T extends { sortOrder: number; id: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

export type ProductWithRelations = ProductRow & {
  variants: ProductVariantRow[];
  modifierGroups: ProductModifierGroupRow[];
  stations: ProductStationRow[];
};

export type ModifierGroupWithModifiers = ModifierGroupRow & { modifiers: ModifierRow[] };

/** Prisma include for a product with everything its DTO and the domain need. */
export const productInclude = {
  variants: true,
  modifierGroups: true,
  stations: true,
} as const;

export function toCategoryDto(row: CategoryRow): Category {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
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
    restaurantId: row.restaurantId,
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
    restaurantId: row.restaurantId,
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
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    categoryId: row.categoryId,
    sku: row.sku,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    descriptionEn: row.descriptionEn,
    descriptionAr: row.descriptionAr,
    price: row.price,
    sortOrder: row.sortOrder,
    archivedAt: isoOrNull(row.archivedAt),
    variants: row.variants
      .filter((v) => v.archivedAt === null)
      .sort(bySort)
      .map((v) => ({
        id: v.id,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        price: v.price,
        sortOrder: v.sortOrder,
      })),
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

export function toCatalogProduct(row: ProductWithRelations): CatalogProduct {
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
