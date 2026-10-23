import { BusinessType, OnlineOrderingState, TenantStatus, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import {
  currencyCodeSchema,
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  nameArSchema,
  nameEnSchema,
  timezoneSchema,
} from './common';

export const onlineOrderingStateSchema = z.enum(enumValues(OnlineOrderingState));
export const businessTypeSchema = z.enum(enumValues(BusinessType));
export const tenantStatusSchema = z.enum(enumValues(TenantStatus));

/** The locales a tenant offers: at least one, each at most once (ADR 0017). */
export const supportedLocalesSchema = z
  .array(localeSchema)
  .min(1)
  .refine((v) => new Set(v).size === v.length, { message: 'Duplicate locale' });

const legalNameSchema = z.string().trim().min(1).max(200).nullable();

export const tenantSchema = z.object({
  id: idSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  legalName: z.string().nullable(),
  businessType: businessTypeSchema,
  status: tenantStatusSchema,
  currencyCode: z.string(),
  defaultLocale: localeSchema,
  supportedLocales: z.array(localeSchema),
  timezone: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Tenant = z.infer<typeof tenantSchema>;

/**
 * Currency is not updatable: every stored amount is in that currency's minor units, so a change
 * would silently rescale history. It is set when the tenant is provisioned. The business type and
 * status belong to the platform operator. The default locale must stay among the supported ones
 * (checked against the stored values, since either may be sent alone).
 */
export const updateTenantSchema = z
  .object({
    nameEn: nameEnSchema,
    nameAr: nameArSchema,
    legalName: legalNameSchema,
    defaultLocale: localeSchema,
    supportedLocales: supportedLocalesSchema,
    timezone: timezoneSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateTenantRequest = z.infer<typeof updateTenantSchema>;

export const createTenantSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(60),
    nameEn: nameEnSchema,
    nameAr: nameArSchema,
    legalName: legalNameSchema.default(null),
    businessType: businessTypeSchema.default(BusinessType.RESTAURANT),
    currencyCode: currencyCodeSchema,
    defaultLocale: localeSchema,
    supportedLocales: supportedLocalesSchema.optional(),
    timezone: timezoneSchema,
  })
  .refine((v) => !v.supportedLocales || v.supportedLocales.includes(v.defaultLocale), {
    message: 'The default locale must be supported',
    path: ['supportedLocales'],
  });
export type CreateTenantRequest = z.input<typeof createTenantSchema>;

export const locationSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  timezone: z.string(),
  taxInclusive: z.boolean(),
  onlineOrderingState: onlineOrderingStateSchema,
  cashRoundingIncrement: z.int().nullable(),
  kdsWarnMinutes: z.int(),
  kdsLateMinutes: z.int(),
  addressLine: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Location = z.infer<typeof locationSchema>;

export const createLocationSchema = z.object({
  /** Short code printed on receipts and used as the local order-number prefix, e.g. "RYD1". */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/),
  nameEn: nameEnSchema,
  nameAr: nameArSchema,
  timezone: timezoneSchema,
  taxInclusive: z.boolean(),
  addressLine: z.string().trim().max(300).nullable().default(null),
  phone: z.string().trim().max(30).nullable().default(null),
});
export type CreateLocationRequest = z.input<typeof createLocationSchema>;

export const updateLocationSchema = createLocationSchema
  .omit({ code: true })
  .extend({
    isActive: z.boolean(),
    /** Smallest coin for cash rounding (minor units, e.g. 5 = 0.05); null turns rounding off. */
    cashRoundingIncrement: z.int().min(1).max(10_000).nullable(),
    /** Kitchen screen age thresholds in minutes (warn must be below late). */
    kdsWarnMinutes: z.int().min(1).max(240),
    kdsLateMinutes: z.int().min(2).max(480),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateLocationRequest = z.infer<typeof updateLocationSchema>;
