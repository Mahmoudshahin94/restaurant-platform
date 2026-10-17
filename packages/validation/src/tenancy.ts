import { OnlineOrderingState, enumValues } from '@pos/shared-types';
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

export const restaurantSchema = z.object({
  id: idSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  currencyCode: z.string(),
  defaultLocale: localeSchema,
  timezone: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Restaurant = z.infer<typeof restaurantSchema>;

/**
 * Currency is not updatable: every stored amount is in that currency's minor units, so a change
 * would silently rescale history. It is set when the restaurant is provisioned.
 */
export const updateRestaurantSchema = z
  .object({
    nameEn: nameEnSchema,
    nameAr: nameArSchema,
    defaultLocale: localeSchema,
    timezone: timezoneSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateRestaurantRequest = z.infer<typeof updateRestaurantSchema>;

export const createRestaurantSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  nameEn: nameEnSchema,
  nameAr: nameArSchema,
  currencyCode: currencyCodeSchema,
  defaultLocale: localeSchema,
  timezone: timezoneSchema,
});
export type CreateRestaurantRequest = z.infer<typeof createRestaurantSchema>;

export const locationSchema = z.object({
  id: idSchema,
  restaurantId: idSchema,
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
