/**
 * Tenant branding and theme (ADR 0019). A tenant's name, logo, colours and look are
 * configuration, resolved in layers (docs/configuration.md): MADAR's defaults, then the tenant,
 * then the screen it is shown on (a surface), then the device's own light or dark preference.
 */
import type { ConfigLayer } from './features';

type ValueOf<T> = T[keyof T];

/** Light or dark screens; SYSTEM follows the device's operating system. */
export const ThemeMode = { LIGHT: 'LIGHT', DARK: 'DARK', SYSTEM: 'SYSTEM' } as const;
export type ThemeMode = ValueOf<typeof ThemeMode>;
export const THEME_MODES = Object.values(ThemeMode) as readonly ThemeMode[];

/** Cards and panels: opaque, or a subtle frosted glass over the background. */
export const SurfaceStyle = { SOLID: 'SOLID', GLASS: 'GLASS' } as const;
export type SurfaceStyle = ValueOf<typeof SurfaceStyle>;
export const SURFACE_STYLES = Object.values(SurfaceStyle) as readonly SurfaceStyle[];

export const LogoSize = { SMALL: 'SMALL', MEDIUM: 'MEDIUM', LARGE: 'LARGE' } as const;
export type LogoSize = ValueOf<typeof LogoSize>;
export const LOGO_SIZES = Object.values(LogoSize) as readonly LogoSize[];

/**
 * Typefaces a tenant may choose. Bundled or built in, never a free-form font name: Arabic text
 * always falls back to the bundled Arabic face.
 */
export const FontFamily = { INTER: 'INTER', SYSTEM: 'SYSTEM', SERIF: 'SERIF' } as const;
export type FontFamily = ValueOf<typeof FontFamily>;
export const FONT_FAMILIES = Object.values(FontFamily) as readonly FontFamily[];

/** The screens a tenant may brand differently from its defaults. */
export const BrandSurface = {
  LOGIN: 'login',
  POS: 'pos',
  KDS: 'kds',
  KIOSK: 'kiosk',
  WEBSITE: 'website',
} as const;
export type BrandSurface = ValueOf<typeof BrandSurface>;
export const BRAND_SURFACES = Object.values(BrandSurface) as readonly BrandSurface[];

/** Files a tenant uploads for its branding. */
export const TenantFileKind = { LOGO: 'LOGO', FAVICON: 'FAVICON' } as const;
export type TenantFileKind = ValueOf<typeof TenantFileKind>;
export const TENANT_FILE_KINDS = Object.values(TenantFileKind) as readonly TenantFileKind[];

/**
 * Image types accepted for branding files. Raster only: an SVG can carry script, so it is never
 * accepted. The bytes must match the declared type.
 */
export const BRANDING_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon'] as const;
export type BrandingImageType = (typeof BRANDING_IMAGE_TYPES)[number];

/** Largest accepted upload of each kind, in bytes. */
export const TENANT_FILE_MAX_BYTES: Record<TenantFileKind, number> = {
  LOGO: 512 * 1024,
  FAVICON: 128 * 1024,
};

/** Corner radius limits, in pixels (the medium radius; small and large scale from it). */
export const BORDER_RADIUS_MIN = 0;
export const BORDER_RADIUS_MAX = 24;

/** Every branding setting. Colours are `#rrggbb`; null colours and files use the theme's own. */
export interface BrandingValues {
  displayNameEn: string | null;
  displayNameAr: string | null;
  logoFileId: string | null;
  faviconFileId: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: FontFamily;
  logoSize: LogoSize;
  themeMode: ThemeMode;
  surfaceStyle: SurfaceStyle;
  borderRadius: number;
}
export type BrandingKey = keyof BrandingValues;

export const BRANDING_KEYS = [
  'displayNameEn',
  'displayNameAr',
  'logoFileId',
  'faviconFileId',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'fontFamily',
  'logoSize',
  'themeMode',
  'surfaceStyle',
  'borderRadius',
] as const satisfies readonly BrandingKey[];

/** What one layer (the tenant, or one surface) says; a missing or null key inherits. */
export type BrandingLayer = { [K in BrandingKey]?: BrandingValues[K] | null };

/** The tenant's per-surface overrides. */
export type SurfaceOverrides = Partial<Record<BrandSurface, BrandingLayer>>;

/** Branding as one screen renders it: every value set, and the layer each one came from. */
export interface ResolvedBranding extends BrandingValues {
  displayNameEn: string;
  displayNameAr: string;
  /** The surface it was resolved for; null: the tenant's defaults (the admin). */
  surface: BrandSurface | null;
  sources: Record<BrandingKey, ConfigLayer>;
}
