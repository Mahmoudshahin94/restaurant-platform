import {
  CURRENCY_SYMBOL_MAX_LENGTH,
  CurrencyDisplay,
  DigitStyle,
  FORMAT_LOCALES,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { configLayerSchema, isoDateTimeSchema, localeSchema } from './common';
import { supportedLocalesSchema } from './tenancy';

// --- Currency display and languages (ADR 0020) ----------------------------------------------------

export const currencyDisplaySchema = z.enum(enumValues(CurrencyDisplay));
export const digitStyleSchema = z.enum(enumValues(DigitStyle));
export const formatLocaleSchema = z.enum(FORMAT_LOCALES);

/**
 * A currency symbol written next to amounts: 1–8 characters, no digits (they would read as part
 * of the amount) and no control or direction marks (they would reorder it).
 */
export const currencySymbolSchema = z
  .string()
  .trim()
  .min(1)
  // Counted in code points, like the database's check.
  .refine((v) => Array.from(v).length <= CURRENCY_SYMBOL_MAX_LENGTH, {
    message: `At most ${String(CURRENCY_SYMBOL_MAX_LENGTH)} characters`,
  })
  .refine((v) => !/[\p{Nd}\p{C}]/u.test(v), { message: 'No digits or control characters' });

/** A tenant's currency as every screen formats it, with the layer of each display setting. */
export const resolvedCurrencySchema = z.object({
  code: z.string(),
  decimalPlaces: z.int(),
  symbol: z.string().nullable(),
  display: currencyDisplaySchema,
  formatLocale: formatLocaleSchema.nullable(),
  sources: z.object({
    symbol: configLayerSchema,
    display: configLayerSchema,
    formatLocale: configLayerSchema,
  }),
});
export type ResolvedCurrencyDto = z.infer<typeof resolvedCurrencySchema>;

/** The languages a tenant offers and its digit style. */
export const resolvedLocalesSchema = z.object({
  default: localeSchema,
  supported: z.array(localeSchema).min(1),
  digits: digitStyleSchema,
  sources: z.object({ digits: configLayerSchema }),
});
export type ResolvedLocalesDto = z.infer<typeof resolvedLocalesSchema>;

/**
 * Replaces the tenant's languages and currency display (`PUT /tenants/:tid/localization`).
 * Null display settings inherit MADAR's. The currency itself and its decimal places are not
 * settings (ADR 0002): sending them is refused, like any unknown field.
 */
export const updateLocalizationSchema = z
  .object({
    defaultLocale: localeSchema,
    supportedLocales: supportedLocalesSchema,
    digits: digitStyleSchema.nullable(),
    currencySymbol: currencySymbolSchema.nullable(),
    currencyDisplay: currencyDisplaySchema.nullable(),
    currencyFormatLocale: formatLocaleSchema.nullable(),
  })
  .strict()
  .refine((v) => v.supportedLocales.includes(v.defaultLocale), {
    message: 'The default locale must be supported',
    path: ['supportedLocales'],
  });
export type UpdateLocalizationRequest = z.input<typeof updateLocalizationSchema>;

/** The admin's Language and currency page: what the tenant set, and what its screens get. */
export const tenantLocalizationSchema = z.object({
  /** The tenant's own values; null display settings inherit. */
  settings: z.object({
    defaultLocale: localeSchema,
    supportedLocales: z.array(localeSchema),
    digits: digitStyleSchema.nullable(),
    currencySymbol: z.string().nullable(),
    currencyDisplay: currencyDisplaySchema.nullable(),
    currencyFormatLocale: formatLocaleSchema.nullable(),
  }),
  currency: resolvedCurrencySchema,
  locales: resolvedLocalesSchema,
  updatedAt: isoDateTimeSchema,
});
export type TenantLocalizationDto = z.infer<typeof tenantLocalizationSchema>;
