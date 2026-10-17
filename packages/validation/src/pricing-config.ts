import { DiscountType, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import {
  bpsSchema,
  idSchema,
  isoDateTimeSchema,
  minorUnitsSchema,
  nameArSchema,
  nameEnSchema,
} from './common';
import { sortOrderSchema } from './menu';

const nonEmpty = (v: object): boolean => Object.keys(v).length > 0;
const noEmptyUpdate = { message: 'No fields to update' };

// --- Taxes --------------------------------------------------------------------------------------

export const taxSchema = z.object({
  id: idSchema,
  restaurantId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  rateBps: z.int(),
  isDefault: z.boolean(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Tax = z.infer<typeof taxSchema>;

export const createTaxSchema = z.object({
  nameEn: nameEnSchema,
  nameAr: nameArSchema,
  rateBps: bpsSchema,
  isDefault: z.boolean().default(false),
});
export type CreateTaxRequest = z.input<typeof createTaxSchema>;

export const updateTaxSchema = createTaxSchema.partial().refine(nonEmpty, noEmptyUpdate);
export type UpdateTaxRequest = z.input<typeof updateTaxSchema>;

// --- Discounts ----------------------------------------------------------------------------------

export const discountTypeSchema = z.enum(enumValues(DiscountType));

export const discountSchema = z.object({
  id: idSchema,
  restaurantId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  type: discountTypeSchema,
  value: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Discount = z.infer<typeof discountSchema>;

const discountValueValid = (d: { type?: DiscountType; value?: number }) =>
  d.type !== 'PERCENTAGE' || d.value === undefined || d.value <= 10_000;

export const createDiscountSchema = z
  .object({
    nameEn: nameEnSchema,
    nameAr: nameArSchema,
    type: discountTypeSchema,
    /** Basis points for PERCENTAGE (1..10000), minor units for FIXED. */
    value: minorUnitsSchema.min(1),
  })
  .refine(discountValueValid, { message: 'Percentage cannot exceed 100%', path: ['value'] });
export type CreateDiscountRequest = z.input<typeof createDiscountSchema>;

/** Type and value change together, so an update is validated as a whole. */
export const updateDiscountSchema = z
  .object({
    nameEn: nameEnSchema,
    nameAr: nameArSchema,
    type: discountTypeSchema,
    value: minorUnitsSchema.min(1),
  })
  .partial()
  .refine(nonEmpty, noEmptyUpdate)
  .refine((d) => (d.type === undefined) === (d.value === undefined), {
    message: 'type and value must be updated together',
    path: ['value'],
  })
  .refine(discountValueValid, { message: 'Percentage cannot exceed 100%', path: ['value'] });
export type UpdateDiscountRequest = z.input<typeof updateDiscountSchema>;

// --- Floor plan ---------------------------------------------------------------------------------

export const tableLabelSchema = z.string().trim().min(1).max(12);

export const floorOrderSchema = z.object({
  id: idSchema,
  orderNumber: z.string(),
  status: z.string(),
  total: z.int(),
});

export const diningTableSchema = z.object({
  id: idSchema,
  sectionId: idSchema,
  label: z.string(),
  seats: z.int(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  /** Open (not completed/cancelled) orders on this table. */
  openOrders: z.array(floorOrderSchema),
});
export type DiningTable = z.infer<typeof diningTableSchema>;

export const tableSectionSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  sortOrder: z.int(),
  archivedAt: isoDateTimeSchema.nullable(),
  tables: z.array(diningTableSchema),
});
export type TableSection = z.infer<typeof tableSectionSchema>;

export const createTableSectionSchema = z.object({
  nameEn: nameEnSchema,
  nameAr: nameArSchema,
  sortOrder: sortOrderSchema.default(0),
});
export type CreateTableSectionRequest = z.input<typeof createTableSectionSchema>;
export const updateTableSectionSchema = createTableSectionSchema
  .partial()
  .refine(nonEmpty, noEmptyUpdate);
export type UpdateTableSectionRequest = z.input<typeof updateTableSectionSchema>;

export const createTableSchema = z.object({
  sectionId: idSchema,
  label: tableLabelSchema,
  seats: z.int().min(1).max(100).default(4),
  sortOrder: sortOrderSchema.default(0),
});
export type CreateTableRequest = z.input<typeof createTableSchema>;
export const updateTableSchema = createTableSchema.partial().refine(nonEmpty, noEmptyUpdate);
export type UpdateTableRequest = z.input<typeof updateTableSchema>;
