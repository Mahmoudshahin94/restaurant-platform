import {
  MAX_VARIANTS,
  barcodeIssue,
  detectSymbology,
  isValidSelectionRange,
  variantOptionsIssue,
} from '@pos/domain';
import { BARCODE_MAX_LENGTH, BarcodeSymbology, enumValues } from '@pos/shared-types';
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

export const barcodeSymbologySchema = z.enum(enumValues(BarcodeSymbology));

export const productBarcodeSchema = z.object({
  id: idSchema,
  code: z.string(),
  symbology: barcodeSymbologySchema,
  isPrimary: z.boolean(),
});
export type ProductBarcode = z.infer<typeof productBarcodeSchema>;

export const productVariantSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  sku: z.string().nullable(),
  price: z.int(),
  /** What one unit costs the business (admin only, never published). */
  cost: z.int().nullable(),
  trackInventory: z.boolean(),
  sortOrder: z.int(),
  /** One value of each of the product's options, in option order; empty for named variants. */
  optionValueIds: z.array(idSchema),
  barcodes: z.array(productBarcodeSchema),
  imageFileIds: z.array(idSchema),
});
export type ProductVariant = z.infer<typeof productVariantSchema>;

export const productOptionSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  sortOrder: z.int(),
  values: z.array(
    z.object({ id: idSchema, nameEn: z.string(), nameAr: z.string(), sortOrder: z.int() }),
  ),
});
export type ProductOption = z.infer<typeof productOptionSchema>;

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
  /** Option axes (Size, Colour...) whose values the variants combine (ADR 0021). */
  options: z.array(productOptionSchema),
  /** Live (non-archived) variants only. */
  variants: z.array(productVariantSchema),
  /** Barcodes of the product itself (a product with variants has them on its variants). */
  barcodes: z.array(productBarcodeSchema),
  imageFileIds: z.array(idSchema),
  modifierGroups: z.array(productModifierGroupLinkSchema),
  stationIds: z.array(idSchema),
  taxIds: z.array(idSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Product = z.infer<typeof productSchema>;

/**
 * A barcode as typed or scanned. Without a symbology, a GS1 length of digits is that GS1 code and
 * anything else CODE128 (`detectSymbology`). EAN/UPC check digits are verified here and again by
 * the server.
 */
export const barcodeInputSchema = z
  .object({
    code: z.string().trim().min(1).max(BARCODE_MAX_LENGTH),
    symbology: barcodeSymbologySchema.optional(),
    isPrimary: z.boolean().default(false),
  })
  .transform((b) => ({ ...b, symbology: b.symbology ?? detectSymbology(b.code) }))
  .superRefine((b, ctx) => {
    const issue = barcodeIssue(b.code, b.symbology);
    if (issue) ctx.addIssue({ code: 'custom', path: ['code'], message: `barcode.${issue}` });
  });
export type BarcodeInput = z.input<typeof barcodeInputSchema>;

const barcodeListSchema = z
  .array(barcodeInputSchema)
  .max(10)
  .refine((list) => list.filter((b) => b.isPrimary).length <= 1, {
    message: 'Only one primary barcode',
  });

export const optionInputSchema = z.object({
  id: idSchema.optional(),
  ...localizedFields,
  values: z
    .array(z.object({ id: idSchema.optional(), ...localizedFields }))
    .min(1)
    .max(30)
    .refine((list) => unique(list.flatMap((v) => (v.id ? [v.id] : []))), {
      message: 'Duplicate value id',
    }),
});
export type OptionInput = z.input<typeof optionInputSchema>;

const skuSchema = z.string().trim().min(1).max(40).nullable();

export const variantInputSchema = z.object({
  id: idSchema.optional(),
  /** Required for a product without options; a combination is named after its values. */
  nameEn: nameEnSchema.optional(),
  nameAr: nameArSchema.optional(),
  sku: skuSchema.default(null),
  price: minorUnitsSchema,
  cost: minorUnitsSchema.nullable().default(null),
  trackInventory: z.boolean().default(false),
  sortOrder: sortOrderSchema.default(0),
  /** For a product with options: the index of this variant's value of each option, in order. */
  optionValues: z.array(z.int().min(0).max(29)).max(3).default([]),
  /** Absent: an existing variant keeps its barcodes (a new one has none). */
  barcodes: barcodeListSchema.optional(),
  /** Absent: an existing variant keeps its pictures. */
  imageFileIds: z.array(idSchema).max(10).refine(unique, { message: 'Duplicate image' }).optional(),
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

const productRelations = {
  options: z.array(optionInputSchema).max(3),
  variants: z
    .array(variantInputSchema)
    .max(MAX_VARIANTS)
    .refine((list) => unique(list.flatMap((v) => (v.id ? [v.id] : []))), {
      message: 'Duplicate variant id',
    }),
  barcodes: barcodeListSchema,
  imageFileIds: z.array(idSchema).max(10).refine(unique, { message: 'Duplicate image' }),
  modifierGroups: z
    .array(productModifierGroupInputSchema)
    .max(20)
    .refine((list) => unique(list.map((l) => l.modifierGroupId)), {
      message: 'Duplicate modifier group',
    }),
  stationIds: z.array(idSchema).max(10).refine(unique, { message: 'Duplicate kitchen station' }),
  taxIds: z.array(idSchema).max(5).refine(unique, { message: 'Duplicate tax' }),
};

type CatalogShape = {
  sku?: string | null;
  options?: z.output<typeof optionInputSchema>[];
  variants?: z.output<typeof variantInputSchema>[];
  barcodes?: z.output<typeof barcodeListSchema>;
};

/**
 * The rules between options, variants, SKUs and barcodes that one request can be checked for
 * (ADR 0021). The server checks them again against what is stored (an update may send variants
 * without options, or codes another product has).
 */
function catalogShape(product: CatalogShape, ctx: z.RefinementCtx): void {
  const { options, variants } = product;
  if (options && variants) {
    if (options.length === 0) {
      variants.forEach((v, i) => {
        if (v.optionValues.length > 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['variants', i, 'optionValues'],
            message: 'No options',
          });
        }
        if (!v.nameEn)
          ctx.addIssue({ code: 'custom', path: ['variants', i, 'nameEn'], message: 'Required' });
        if (!v.nameAr)
          ctx.addIssue({ code: 'custom', path: ['variants', i, 'nameAr'], message: 'Required' });
      });
    } else {
      if (variants.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants'],
          message: 'A product with options needs variants',
        });
      }
      const issue = variantOptionsIssue(
        options.map((o) => o.values.length),
        variants.map((v) => v.optionValues),
      );
      if (issue) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', issue.index, 'optionValues'],
          message: issue.reason,
        });
      }
    }
  }
  if (variants && variants.length > 0 && product.barcodes && product.barcodes.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['barcodes'],
      message: 'Barcodes belong to the variants',
    });
  }
  const codes = [
    ...(product.barcodes ?? []).map((b, i) => ({ code: b.code, path: ['barcodes', i, 'code'] })),
    ...(variants ?? []).flatMap((v, i) =>
      (v.barcodes ?? []).map((b, j) => ({
        code: b.code,
        path: ['variants', i, 'barcodes', j, 'code'],
      })),
    ),
  ];
  const seenCodes = new Set<string>();
  for (const { code, path } of codes) {
    if (seenCodes.has(code)) ctx.addIssue({ code: 'custom', path, message: 'Duplicate barcode' });
    seenCodes.add(code);
  }
  const seenSkus = new Set(product.sku ? [product.sku] : []);
  (variants ?? []).forEach((v, i) => {
    if (v.sku === null) return;
    if (seenSkus.has(v.sku))
      ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'Duplicate SKU' });
    seenSkus.add(v.sku);
  });
}

export const createProductSchema = z
  .object({
    categoryId: idSchema,
    sku: skuSchema.default(null),
    ...localizedFields,
    ...localizedDescriptions,
    price: minorUnitsSchema,
    sortOrder: sortOrderSchema.default(0),
    options: productRelations.options.default([]),
    variants: productRelations.variants.default([]),
    barcodes: productRelations.barcodes.default([]),
    imageFileIds: productRelations.imageFileIds.default([]),
    modifierGroups: productRelations.modifierGroups.default([]),
    stationIds: productRelations.stationIds.default([]),
    taxIds: productRelations.taxIds.default([]),
  })
  .superRefine(catalogShape);
export type CreateProductRequest = z.input<typeof createProductSchema>;

/**
 * Partial update. `variants`, when present, is the complete desired list (missing variants are
 * archived); `options` (which needs `variants` too, since they name its values) the complete
 * list of options. `barcodes`, `imageFileIds`, `modifierGroups` and `stationIds`, when present,
 * replace the current ones.
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
  .refine(nonEmpty, noEmptyUpdate)
  .refine((u) => u.options === undefined || u.variants !== undefined, {
    message: 'Options are saved with their variants',
    path: ['variants'],
  })
  .superRefine(catalogShape);
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
    z.object({
      id: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      sku: z.string().nullable(),
      price: z.int(),
      barcodes: z.array(z.string()),
      /** The variant's own cover picture, or null (show the product's). */
      imageFileId: idSchema.nullable(),
    }),
  ),
  /** Codes of a product without variants (ADR 0021); none without the BARCODE module. */
  barcodes: z.array(z.string()),
  /** The product's cover picture (a tenant file id; its first picture), or null. */
  imageFileId: idSchema.nullable(),
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
export type PublishedMenuVariant = PublishedMenuProduct['variants'][number];

// --- Code lookup (ADR 0021) --------------------------------------------------------------------

export const catalogLookupQuerySchema = z.object({
  code: z.string().trim().min(1).max(BARCODE_MAX_LENGTH),
});
export type CatalogLookupQuery = z.input<typeof catalogLookupQuerySchema>;

/** What a scanned or typed code names on a location's menu (`lookupCode`). */
export const catalogLookupSchema = z.object({
  /** The stored code that matched. */
  code: z.string(),
  matchedBy: z.enum(['BARCODE', 'SKU']),
  categoryId: idSchema,
  /** The product as the location's menu sells it (price, availability). */
  product: publishedProductSchema,
  /** The variant the code names; null for a product without variants. */
  variantId: idSchema.nullable(),
});
export type CatalogLookup = z.infer<typeof catalogLookupSchema>;
