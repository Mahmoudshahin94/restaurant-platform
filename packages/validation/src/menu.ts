import { isValidSelectionRange } from '@pos/domain';
import { z } from 'zod';
import {
  descriptionSchema,
  idSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  nameArSchema,
  nameEnSchema,
} from './common';

export const sortOrderSchema = z.int().min(0).max(100_000);

/** Query-string boolean: only the literal strings "true"/"false" are accepted. */
export const booleanQuerySchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const nonEmpty = (v: object): boolean => Object.keys(v).length > 0;
const noEmptyUpdate = { message: 'No fields to update' };

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

const localizedFields = {
  nameEn: nameEnSchema,
  nameAr: nameArSchema,
};
const localizedDescriptions = {
  descriptionEn: descriptionSchema.default(null),
  descriptionAr: descriptionSchema.default(null),
};

// --- Categories -----------------------------------------------------------------------------

export const categorySchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Category = z.infer<typeof categorySchema>;

export const createCategorySchema = z.object({
  ...localizedFields,
  ...localizedDescriptions,
  sortOrder: sortOrderSchema.default(0),
});
export type CreateCategoryRequest = z.input<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    ...localizedFields,
    descriptionEn: descriptionSchema,
    descriptionAr: descriptionSchema,
    sortOrder: sortOrderSchema,
  })
  .partial()
  .refine(nonEmpty, noEmptyUpdate);
export type UpdateCategoryRequest = z.infer<typeof updateCategorySchema>;

export const listQuerySchema = z.object({ includeArchived: booleanQuerySchema });

// --- Kitchen stations -----------------------------------------------------------------------

export const stationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_]{2,20}$/);

export const kitchenStationSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type KitchenStation = z.infer<typeof kitchenStationSchema>;

export const createKitchenStationSchema = z.object({
  code: stationCodeSchema,
  ...localizedFields,
  sortOrder: sortOrderSchema.default(0),
});
export type CreateKitchenStationRequest = z.input<typeof createKitchenStationSchema>;

export const updateKitchenStationSchema = createKitchenStationSchema
  .partial()
  .refine(nonEmpty, noEmptyUpdate);
export type UpdateKitchenStationRequest = z.infer<typeof updateKitchenStationSchema>;

// --- Modifier groups --------------------------------------------------------------------------

export const modifierSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  priceDelta: z.int(),
  isDefault: z.boolean(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
});
export type Modifier = z.infer<typeof modifierSchema>;

export const modifierGroupSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  minSelect: z.int(),
  maxSelect: z.int().nullable(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  modifiers: z.array(modifierSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;

/** A modifier in a create/update payload. With `id` it updates that modifier; without, it is new. */
export const modifierInputSchema = z.object({
  id: idSchema.optional(),
  ...localizedFields,
  priceDelta: minorUnitsSchema.default(0),
  isDefault: z.boolean().default(false),
  sortOrder: sortOrderSchema.default(0),
});
export type ModifierInput = z.input<typeof modifierInputSchema>;

const selectionRangeMessage = {
  message: 'minSelect must be ≥ 0, maxSelect ≥ 1 and maxSelect ≥ minSelect',
  path: ['maxSelect'],
};

export const createModifierGroupSchema = z
  .object({
    ...localizedFields,
    minSelect: z.int().min(0).max(50).default(0),
    maxSelect: z.int().min(1).max(50).nullable().default(null),
    sortOrder: sortOrderSchema.default(0),
    modifiers: z
      .array(modifierInputSchema.omit({ id: true }))
      .min(1)
      .max(100),
  })
  .refine((g) => isValidSelectionRange(g.minSelect, g.maxSelect), selectionRangeMessage)
  .refine((g) => g.minSelect <= g.modifiers.length, {
    message: 'minSelect cannot exceed the number of modifiers',
    path: ['minSelect'],
  });
export type CreateModifierGroupRequest = z.input<typeof createModifierGroupSchema>;

/**
 * Partial update. When `modifiers` is present it is the complete desired list: entries with an
 * id are updated, entries without are created, and existing modifiers not listed are archived.
 */
export const updateModifierGroupSchema = z
  .object({
    ...localizedFields,
    minSelect: z.int().min(0).max(50),
    maxSelect: z.int().min(1).max(50).nullable(),
    sortOrder: sortOrderSchema,
    modifiers: z
      .array(modifierInputSchema)
      .min(1)
      .max(100)
      .refine((list) => unique(list.flatMap((m) => (m.id ? [m.id] : []))), {
        message: 'Duplicate modifier id',
      }),
  })
  .partial()
  .refine(nonEmpty, noEmptyUpdate);
export type UpdateModifierGroupRequest = z.input<typeof updateModifierGroupSchema>;

// --- Products -----------------------------------------------------------------------------------

export const productVariantSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  price: z.int(),
  sortOrder: z.int(),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productModifierGroupLinkSchema = z.object({
  modifierGroupId: idSchema,
  sortOrder: z.int(),
  minSelect: z.int().nullable(),
  maxSelect: z.int().nullable(),
});
export type ProductModifierGroupLink = z.infer<typeof productModifierGroupLinkSchema>;

export const productSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  categoryId: idSchema,
  sku: z.string().nullable(),
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  price: z.int(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  /** Live (non-archived) variants only. */
  variants: z.array(productVariantSchema),
  modifierGroups: z.array(productModifierGroupLinkSchema),
  stationIds: z.array(idSchema),
  taxIds: z.array(idSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Product = z.infer<typeof productSchema>;

export const variantInputSchema = z.object({
  id: idSchema.optional(),
  ...localizedFields,
  price: minorUnitsSchema,
  sortOrder: sortOrderSchema.default(0),
});
export type VariantInput = z.input<typeof variantInputSchema>;

export const productModifierGroupInputSchema = z
  .object({
    modifierGroupId: idSchema,
    sortOrder: sortOrderSchema.default(0),
    minSelect: z.int().min(0).max(50).nullable().default(null),
    maxSelect: z.int().min(1).max(50).nullable().default(null),
  })
  .refine((l) => l.minSelect === null || l.maxSelect === null || l.maxSelect >= l.minSelect, {
    message: 'maxSelect must be ≥ minSelect',
    path: ['maxSelect'],
  });
export type ProductModifierGroupInput = z.input<typeof productModifierGroupInputSchema>;

const skuSchema = z.string().trim().min(1).max(40).nullable();

const productRelations = {
  variants: z
    .array(variantInputSchema)
    .max(20)
    .refine((list) => unique(list.flatMap((v) => (v.id ? [v.id] : []))), {
      message: 'Duplicate variant id',
    }),
  modifierGroups: z
    .array(productModifierGroupInputSchema)
    .max(20)
    .refine((list) => unique(list.map((l) => l.modifierGroupId)), {
      message: 'Duplicate modifier group',
    }),
  stationIds: z.array(idSchema).max(10).refine(unique, { message: 'Duplicate kitchen station' }),
  taxIds: z.array(idSchema).max(5).refine(unique, { message: 'Duplicate tax' }),
};

export const createProductSchema = z.object({
  categoryId: idSchema,
  sku: skuSchema.default(null),
  ...localizedFields,
  ...localizedDescriptions,
  price: minorUnitsSchema,
  sortOrder: sortOrderSchema.default(0),
  variants: productRelations.variants.default([]),
  modifierGroups: productRelations.modifierGroups.default([]),
  stationIds: productRelations.stationIds.default([]),
  taxIds: productRelations.taxIds.default([]),
});
export type CreateProductRequest = z.input<typeof createProductSchema>;

/**
 * Partial update. `variants`, when present, is the complete desired list (missing variants are
 * archived). `modifierGroups` and `stationIds`, when present, replace the current links.
 */
export const updateProductSchema = z
  .object({
    categoryId: idSchema,
    sku: skuSchema,
    ...localizedFields,
    descriptionEn: descriptionSchema,
    descriptionAr: descriptionSchema,
    price: minorUnitsSchema,
    sortOrder: sortOrderSchema,
    ...productRelations,
  })
  .partial()
  .refine(nonEmpty, noEmptyUpdate);
export type UpdateProductRequest = z.input<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  categoryId: idSchema.optional(),
  includeArchived: booleanQuerySchema,
  search: z.string().trim().max(100).optional(),
});
export type ListProductsQuery = z.input<typeof listProductsQuerySchema>;

// --- Location product settings ----------------------------------------------------------------

export const locationProductSettingSchema = z.object({
  locationId: idSchema,
  productId: idSchema,
  isAvailable: z.boolean(),
  priceOverride: z.int().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type LocationProductSetting = z.infer<typeof locationProductSettingSchema>;

export const setLocationProductSchema = z.object({
  isAvailable: z.boolean(),
  priceOverride: minorUnitsSchema.nullable().default(null),
});
export type SetLocationProductRequest = z.input<typeof setLocationProductSchema>;

// --- Published menu (what POS, KDS and the website consume) -----------------------------------

const publishedModifierSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  priceDelta: z.int(),
  isDefault: z.boolean(),
});

const publishedProductSchema = z.object({
  id: idSchema,
  sku: z.string().nullable(),
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  price: z.int(),
  isAvailable: z.boolean(),
  stationIds: z.array(idSchema),
  taxIds: z.array(idSchema),
  variants: z.array(
    z.object({ id: idSchema, nameEn: z.string(), nameAr: z.string(), price: z.int() }),
  ),
  modifierGroups: z.array(
    z.object({
      id: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      minSelect: z.int(),
      maxSelect: z.int().nullable(),
      modifiers: z.array(publishedModifierSchema),
    }),
  ),
});

export const publishedMenuSchema = z.object({
  tenantId: idSchema,
  locationId: idSchema,
  currencyCode: z.string(),
  taxInclusive: z.boolean(),
  /** Content hash; identical to the ETag header. Changes whenever the menu changes. */
  version: z.string(),
  taxes: z.array(
    z.object({ id: idSchema, nameEn: z.string(), nameAr: z.string(), rateBps: z.int() }),
  ),
  categories: z.array(
    z.object({
      id: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      descriptionEn: z.string().nullable(),
      descriptionAr: z.string().nullable(),
      products: z.array(publishedProductSchema),
    }),
  ),
});
export type PublishedMenu = z.infer<typeof publishedMenuSchema>;
export type PublishedMenuProduct = z.infer<typeof publishedProductSchema>;
