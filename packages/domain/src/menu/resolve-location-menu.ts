import type {
  Catalog,
  CatalogModifierGroup,
  CatalogProduct,
  LocationMenu,
  LocationProductSetting,
  MenuModifierGroup,
  MenuProduct,
} from './types';

function bySortOrder<T extends { sortOrder: number; id: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

const isLive = (row: { archivedAt: Date | null }): boolean => row.archivedAt === null;

function resolveGroup(
  group: CatalogModifierGroup,
  link: CatalogProduct['modifierGroups'][number],
): MenuModifierGroup {
  return {
    id: group.id,
    nameEn: group.nameEn,
    nameAr: group.nameAr,
    minSelect: link.minSelect ?? group.minSelect,
    maxSelect: link.maxSelect ?? group.maxSelect,
    modifiers: group.modifiers
      .filter(isLive)
      .sort(bySortOrder)
      .map((m) => ({
        id: m.id,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceDelta: m.priceDelta,
        isDefault: m.isDefault,
      })),
  };
}

/**
 * Builds the menu one location sells: archived rows removed, per-location availability ("86")
 * and price overrides applied, modifier min/max overrides resolved, everything in display
 * order. Unavailable products stay in the menu flagged `isAvailable: false`, so screens can show
 * them as sold out. Categories with no live products are omitted.
 *
 * `capabilities` are the location's modules (ADR 0018): without MODIFIERS, products are sold
 * without their modifier groups (none shown, none required, none accepted).
 */
export function resolveLocationMenu(
  catalog: Catalog,
  settings: readonly LocationProductSetting[],
  capabilities: { modifiers: boolean } = { modifiers: true },
): LocationMenu {
  const settingByProduct = new Map(settings.map((s) => [s.productId, s]));
  const groupsById = new Map(
    capabilities.modifiers ? catalog.modifierGroups.filter(isLive).map((g) => [g.id, g]) : [],
  );
  const liveStationIds = new Set(catalog.kitchenStations.filter(isLive).map((s) => s.id));
  const liveTaxes = catalog.taxes.filter(isLive);
  const liveTaxIds = new Set(liveTaxes.map((t) => t.id));

  const productsByCategory = new Map<string, MenuProduct[]>();
  for (const product of [...catalog.products].filter(isLive).sort(bySortOrder)) {
    const setting = settingByProduct.get(product.id);
    const variants = product.variants.filter(isLive).sort(bySortOrder);
    const resolved: MenuProduct = {
      id: product.id,
      sku: product.sku,
      nameEn: product.nameEn,
      nameAr: product.nameAr,
      descriptionEn: product.descriptionEn,
      descriptionAr: product.descriptionAr,
      // Overrides only apply to products without variants (variant prices are absolute).
      price: variants.length === 0 ? (setting?.priceOverride ?? product.price) : product.price,
      isAvailable: setting?.isAvailable ?? true,
      stationIds: product.stationIds.filter((id) => liveStationIds.has(id)),
      taxIds: product.taxIds.filter((id) => liveTaxIds.has(id)),
      variants: variants.map((v) => ({
        id: v.id,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        price: v.price,
      })),
      modifierGroups: [...product.modifierGroups]
        .sort(
          (a, b) => a.sortOrder - b.sortOrder || a.modifierGroupId.localeCompare(b.modifierGroupId),
        )
        .flatMap((link) => {
          const group = groupsById.get(link.modifierGroupId);
          return group ? [resolveGroup(group, link)] : [];
        }),
    };
    const list = productsByCategory.get(product.categoryId) ?? [];
    list.push(resolved);
    productsByCategory.set(product.categoryId, list);
  }

  return {
    taxes: liveTaxes
      .map((t) => ({ id: t.id, nameEn: t.nameEn, nameAr: t.nameAr, rateBps: t.rateBps }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    categories: [...catalog.categories]
      .filter(isLive)
      .sort(bySortOrder)
      .flatMap((category) => {
        const products = productsByCategory.get(category.id) ?? [];
        if (products.length === 0) return [];
        return [
          {
            id: category.id,
            nameEn: category.nameEn,
            nameAr: category.nameAr,
            descriptionEn: category.descriptionEn,
            descriptionAr: category.descriptionAr,
            products,
          },
        ];
      }),
  };
}

/** Finds a product in a resolved menu by id. */
export function findMenuProduct(menu: LocationMenu, productId: string): MenuProduct | undefined {
  for (const category of menu.categories) {
    const product = category.products.find((p) => p.id === productId);
    if (product) return product;
  }
  return undefined;
}
