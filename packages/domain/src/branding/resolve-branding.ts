import {
  BRANDING_KEYS,
  type BrandSurface,
  type BrandingKey,
  type BrandingLayer,
  type BrandingValues,
  type ResolvedBranding,
  type SurfaceOverrides,
  type ThemeMode,
} from '@pos/shared-types';
import { type LayerValues, resolveLayered } from '../config/resolve-layered';

/**
 * MADAR's defaults for every tenant: the theme's own colours (null) on a dark screen, solid
 * cards, the bundled typeface. Display names default to the tenant's own names.
 */
export const PLATFORM_BRANDING_DEFAULTS: Omit<BrandingValues, 'displayNameEn' | 'displayNameAr'> = {
  logoFileId: null,
  faviconFileId: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: 'INTER',
  logoSize: 'MEDIUM',
  themeMode: 'DARK',
  surfaceStyle: 'SOLID',
  borderRadius: 8,
};

export interface BrandingInput {
  /** The tenant's registered names: the display names when nothing else is set. */
  tenantNames: { nameEn: string; nameAr: string };
  /** The tenant's own settings (null or missing: inherit). */
  tenant?: BrandingLayer | null;
  /** The tenant's per-surface overrides. */
  surfaces?: SurfaceOverrides | null;
  /** The screen being rendered; null or missing: the tenant's defaults. */
  surface?: BrandSurface | null;
  /** The device's own light/dark preference, which wins over the tenant's (null: none). */
  device?: { themeMode?: ThemeMode | null } | null;
}

/** A layer without its unset values: null inherits, like a missing key. */
function present(layer: BrandingLayer | null | undefined): LayerValues<BrandingKey, unknown> {
  const out: LayerValues<BrandingKey, unknown> = {};
  for (const key of BRANDING_KEYS) {
    const value = layer?.[key];
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Resolves a tenant's branding for one screen (docs/configuration.md): MADAR's defaults, then
 * the tenant, then the surface, then the device's theme mode. Every value names its layer.
 * Pure: the cloud, the location hub and the apps resolve the same way.
 */
export function resolveBranding(input: BrandingInput): ResolvedBranding {
  const surface = input.surface ?? null;
  const resolved = resolveLayered<BrandingKey, unknown>(BRANDING_KEYS, {
    PLATFORM: {
      ...PLATFORM_BRANDING_DEFAULTS,
      displayNameEn: input.tenantNames.nameEn,
      displayNameAr: input.tenantNames.nameAr,
    },
    TENANT: present(input.tenant),
    SURFACE: surface ? present(input.surfaces?.[surface]) : {},
    DEVICE: present({ themeMode: input.device?.themeMode ?? null }),
  });
  const values = Object.fromEntries(BRANDING_KEYS.map((k) => [k, resolved[k].value]));
  const sources = Object.fromEntries(BRANDING_KEYS.map((k) => [k, resolved[k].source]));
  return {
    ...(values as unknown as BrandingValues & { displayNameEn: string; displayNameAr: string }),
    surface,
    sources: sources as ResolvedBranding['sources'],
  };
}

/**
 * The device layer on top of branding the server resolved (platform, tenant, surface): a screen's
 * own light/dark choice wins over the tenant's. Null keeps the tenant's.
 */
export function withDeviceThemeMode(
  branding: ResolvedBranding,
  mode: ThemeMode | null,
): ResolvedBranding {
  if (!mode) return branding;
  return { ...branding, themeMode: mode, sources: { ...branding.sources, themeMode: 'DEVICE' } };
}

/** The file ids a tenant's branding refers to, on any surface (logos and favicons). */
export function brandingFileIds(
  tenant: BrandingLayer | null | undefined,
  surfaces: SurfaceOverrides | null | undefined,
): string[] {
  const ids = new Set<string>();
  for (const layer of [tenant, ...Object.values(surfaces ?? {})]) {
    if (layer?.logoFileId) ids.add(layer.logoFileId);
    if (layer?.faviconFileId) ids.add(layer.faviconFileId);
  }
  return [...ids];
}
