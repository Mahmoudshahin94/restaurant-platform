import {
  ConfigLayer,
  FEATURES,
  type Feature,
  type ResolvedFeatures,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, localeSchema } from './common';
import { businessTypeSchema, tenantStatusSchema } from './tenancy';

// --- Modules (ADR 0018) ------------------------------------------------------------------------

export const featureSchema = z.enum(FEATURES as [Feature, ...Feature[]]);
export const configLayerSchema = z.enum(enumValues(ConfigLayer));

export const resolvedFeatureSchema = z.object({
  feature: featureSchema,
  enabled: z.boolean(),
  source: configLayerSchema,
  entitled: z.boolean(),
  configurable: z.boolean(),
});

/** Every module, keyed by feature (a module this client does not know yet is dropped). */
export const resolvedFeaturesSchema = z
  .record(z.string(), resolvedFeatureSchema)
  .transform((record, ctx) => {
    for (const feature of FEATURES) {
      if (!record[feature]) {
        ctx.addIssue({ code: 'custom', path: [feature], message: 'Missing module' });
        return z.NEVER;
      }
    }
    return Object.fromEntries(FEATURES.map((f) => [f, record[f]])) as ResolvedFeatures;
  });

/** One row of the admin's Modules page. */
export const featureSettingSchema = resolvedFeatureSchema.extend({
  inherited: z.object({ enabled: z.boolean(), source: configLayerSchema }),
  override: z.boolean().nullable(),
});
export type FeatureSettingDto = z.infer<typeof featureSettingSchema>;

/** Whose modules the page shows: the tenant (neither id), a location, or a device. */
export const featureScopeQuerySchema = z.object({
  locationId: idSchema.optional(),
  deviceId: idSchema.optional(),
});
export type FeatureScopeQuery = z.input<typeof featureScopeQuerySchema>;

/**
 * Switches a module for the tenant, a location or a device. `enabled: null` removes the
 * override, so the scope inherits again. A device's location is the device's own.
 */
export const setFeatureOverrideSchema = z.object({
  locationId: idSchema.nullable().default(null),
  deviceId: idSchema.nullable().default(null),
  enabled: z.boolean().nullable(),
});
export type SetFeatureOverrideRequest = z.input<typeof setFeatureOverrideSchema>;

// --- Tenant context (cloud and hub) -------------------------------------------------------------

/**
 * What every app needs to render for a tenant: its identity, branding, money, languages and the
 * modules resolved for the requested location. Served by the cloud and by the location hub.
 */
export const tenantContextSchema = z.object({
  tenant: z.object({
    id: idSchema,
    slug: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    businessType: businessTypeSchema,
    status: tenantStatusSchema,
    timezone: z.string(),
  }),
  /** The tenant's names until Phase M3 adds logos, colours and themes. */
  branding: z.object({ nameEn: z.string(), nameAr: z.string() }),
  currency: z.object({ code: z.string(), exponent: z.int() }),
  locales: z.object({ default: localeSchema, supported: z.array(localeSchema) }),
  /** The location the modules were resolved for; null: the tenant as a whole. */
  locationId: idSchema.nullable(),
  features: resolvedFeaturesSchema,
});
export type TenantContextDto = z.infer<typeof tenantContextSchema>;

export const tenantContextQuerySchema = z.object({ locationId: idSchema.optional() });
export type TenantContextQuery = z.input<typeof tenantContextQuerySchema>;
