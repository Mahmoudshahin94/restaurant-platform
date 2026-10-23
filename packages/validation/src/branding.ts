import {
  BORDER_RADIUS_MAX,
  BORDER_RADIUS_MIN,
  BRANDING_IMAGE_TYPES,
  BRAND_SURFACES,
  BrandSurface,
  FontFamily,
  LogoSize,
  SurfaceStyle,
  TenantFileKind,
  ThemeMode,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { configLayerSchema, idSchema, isoDateTimeSchema } from './common';

// --- Branding (ADR 0019) -------------------------------------------------------------------------

/** `#rrggbb` (or `#rgb`), stored lower-case and six digits long. */
export const hexColourSchema = z
  .string()
  .trim()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Enter a colour as #rrggbb')
  .transform((value) => {
    const hex = value.slice(1).toLowerCase();
    return `#${hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex}`;
  });

export const themeModeSchema = z.enum(enumValues(ThemeMode));
export const surfaceStyleSchema = z.enum(enumValues(SurfaceStyle));
export const logoSizeSchema = z.enum(enumValues(LogoSize));
export const fontFamilySchema = z.enum(enumValues(FontFamily));
export const brandSurfaceSchema = z.enum(enumValues(BrandSurface));
export const tenantFileKindSchema = z.enum(enumValues(TenantFileKind));

const displayName = z.string().trim().min(1).max(120);

/**
 * What the tenant, or one surface, sets. Every value may be null (or left out on a surface):
 * the layer then inherits it.
 */
export const brandingLayerSchema = z
  .object({
    displayNameEn: displayName.nullable(),
    displayNameAr: displayName.nullable(),
    logoFileId: idSchema.nullable(),
    faviconFileId: idSchema.nullable(),
    primaryColor: hexColourSchema.nullable(),
    secondaryColor: hexColourSchema.nullable(),
    accentColor: hexColourSchema.nullable(),
    fontFamily: fontFamilySchema.nullable(),
    logoSize: logoSizeSchema.nullable(),
    themeMode: themeModeSchema.nullable(),
    surfaceStyle: surfaceStyleSchema.nullable(),
    borderRadius: z.int().min(BORDER_RADIUS_MIN).max(BORDER_RADIUS_MAX).nullable(),
  })
  .strict();
export type BrandingLayerDto = z.infer<typeof brandingLayerSchema>;

/** One surface's overrides: only what differs from the tenant. */
export const surfaceBrandingSchema = brandingLayerSchema.partial().strict();

/**
 * The per-surface overrides, as stored (JSON) and sent. Unknown surfaces and settings are
 * refused, so a typo cannot be saved and silently ignored.
 */
export const surfaceOverridesSchema = z
  .object(
    Object.fromEntries(BRAND_SURFACES.map((s) => [s, surfaceBrandingSchema.optional()])) as Record<
      BrandSurface,
      z.ZodOptional<typeof surfaceBrandingSchema>
    >,
  )
  .strict();
export type SurfaceOverridesDto = z.infer<typeof surfaceOverridesSchema>;

/** Replaces the tenant's branding (`PUT /tenants/:tid/branding`). */
export const updateBrandingSchema = brandingLayerSchema.extend({
  surfaces: surfaceOverridesSchema.default({}),
});
export type UpdateBrandingRequest = z.input<typeof updateBrandingSchema>;

const sourcesSchema = z.object({
  displayNameEn: configLayerSchema,
  displayNameAr: configLayerSchema,
  logoFileId: configLayerSchema,
  faviconFileId: configLayerSchema,
  primaryColor: configLayerSchema,
  secondaryColor: configLayerSchema,
  accentColor: configLayerSchema,
  fontFamily: configLayerSchema,
  logoSize: configLayerSchema,
  themeMode: configLayerSchema,
  surfaceStyle: configLayerSchema,
  borderRadius: configLayerSchema,
});

/** Branding as one screen renders it, with the layer of every value. */
export const resolvedBrandingSchema = z.object({
  displayNameEn: z.string(),
  displayNameAr: z.string(),
  logoFileId: idSchema.nullable(),
  faviconFileId: idSchema.nullable(),
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  accentColor: z.string().nullable(),
  fontFamily: fontFamilySchema,
  logoSize: logoSizeSchema,
  themeMode: themeModeSchema,
  surfaceStyle: surfaceStyleSchema,
  borderRadius: z.int(),
  surface: brandSurfaceSchema.nullable(),
  sources: sourcesSchema,
});
export type ResolvedBrandingDto = z.infer<typeof resolvedBrandingSchema>;

// --- Tenant files (ADR 0019) ---------------------------------------------------------------------

export const brandingImageTypeSchema = z.enum(BRANDING_IMAGE_TYPES);

export const tenantFileSchema = z.object({
  id: idSchema,
  kind: tenantFileKindSchema,
  contentType: brandingImageTypeSchema,
  sizeBytes: z.int(),
  sha256: z.string(),
  createdAt: isoDateTimeSchema,
});
export type TenantFileDto = z.infer<typeof tenantFileSchema>;

export const uploadTenantFileQuerySchema = z.object({ kind: tenantFileKindSchema });

/** The admin's Branding page: what the tenant set, and what its screens get. */
export const tenantBrandingSchema = z.object({
  /** The tenant's own values; null: inherited from the platform. */
  tenant: brandingLayerSchema,
  surfaces: surfaceOverridesSchema,
  /** The tenant's defaults, resolved (the admin's own look). */
  resolved: resolvedBrandingSchema,
  /** The files the branding refers to. */
  files: z.array(tenantFileSchema),
  updatedAt: isoDateTimeSchema.nullable(),
});
export type TenantBrandingDto = z.infer<typeof tenantBrandingSchema>;

export const brandingSurfaceQuerySchema = z.object({ surface: brandSurfaceSchema.optional() });
