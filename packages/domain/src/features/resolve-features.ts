import {
  type Feature,
  FEATURES,
  type FeatureSetting,
  type OverrideLayer,
  type ResolvedFeatures,
  isFeature,
} from '@pos/shared-types';
import { type LayerValues, resolveLayered } from '../config/resolve-layered';
import { PLATFORM_FEATURE_DEFAULTS, businessTypeDefaults } from './defaults';

/** What the platform allows a tenant for one module (its plan). */
export interface FeatureEntitlement {
  /** Without it the module is off for the tenant, whatever any layer says. */
  entitled: boolean;
  /** Whether the tenant, its locations and devices may switch the module. */
  tenantConfigurable: boolean;
}

/**
 * A tenant without an entitlement row for a module may use it and switch it: until the platform
 * operator sells plans (Phase M9), every tenant is entitled to every module.
 */
export const DEFAULT_ENTITLEMENT: Readonly<FeatureEntitlement> = {
  entitled: true,
  tenantConfigurable: true,
};

export interface FeatureLayers {
  /** The tenant's stored business type; picks the business-type layer. */
  businessType: string;
  /** The platform's entitlements; a missing module gets DEFAULT_ENTITLEMENT. */
  entitlements?: Partial<Record<Feature, FeatureEntitlement>>;
  tenant?: LayerValues<Feature, boolean>;
  location?: LayerValues<Feature, boolean>;
  device?: LayerValues<Feature, boolean>;
}

/**
 * Resolves every module for one scope (ADR 0018): platform defaults, business-type defaults,
 * then the tenant's, location's and device's overrides, each overriding the one before. The
 * entitlement caps the result: a module outside the tenant's plan is off, and a module the tenant
 * may not configure ignores the tenant, location and device layers.
 */
export function resolveFeatures(layers: FeatureLayers): ResolvedFeatures {
  const entitlementOf = (feature: Feature): FeatureEntitlement =>
    layers.entitlements?.[feature] ?? DEFAULT_ENTITLEMENT;
  const configurableOnly = (values: LayerValues<Feature, boolean> | undefined) =>
    values &&
    (Object.fromEntries(
      Object.entries(values).filter(
        ([feature]) => isFeature(feature) && entitlementOf(feature).tenantConfigurable,
      ),
    ) as LayerValues<Feature, boolean>);

  const layered = resolveLayered(FEATURES, {
    PLATFORM: PLATFORM_FEATURE_DEFAULTS,
    BUSINESS_TYPE: businessTypeDefaults(layers.businessType),
    TENANT: configurableOnly(layers.tenant),
    LOCATION: configurableOnly(layers.location),
    DEVICE: configurableOnly(layers.device),
  });

  const result = {} as ResolvedFeatures;
  for (const feature of FEATURES) {
    const { entitled, tenantConfigurable } = entitlementOf(feature);
    const { value, source } = layered[feature];
    result[feature] = entitled
      ? { feature, enabled: value, source, entitled, configurable: tenantConfigurable }
      : { feature, enabled: false, source: 'PLATFORM', entitled, configurable: tenantConfigurable };
  }
  return result;
}

/** A stored override: tenant-wide (no location, no device), for a location, or for a device. */
export interface FeatureOverrideRow {
  feature: string;
  enabled: boolean;
  locationId: string | null;
  deviceId: string | null;
}

export interface FeatureEntitlementRow extends FeatureEntitlement {
  feature: string;
}

/**
 * Builds the layers of one scope from stored rows. Overrides of other locations or devices, and
 * rows naming a module this version does not know, are ignored.
 */
export function featureLayersFromRows(input: {
  businessType: string;
  entitlements: readonly FeatureEntitlementRow[];
  overrides: readonly FeatureOverrideRow[];
  locationId?: string | null;
  deviceId?: string | null;
}): FeatureLayers {
  const tenant: LayerValues<Feature, boolean> = {};
  const location: LayerValues<Feature, boolean> = {};
  const device: LayerValues<Feature, boolean> = {};
  for (const row of input.overrides) {
    if (!isFeature(row.feature)) continue;
    if (row.deviceId !== null) {
      if (input.deviceId && row.deviceId === input.deviceId) device[row.feature] = row.enabled;
    } else if (row.locationId !== null) {
      if (input.locationId && row.locationId === input.locationId) {
        location[row.feature] = row.enabled;
      }
    } else {
      tenant[row.feature] = row.enabled;
    }
  }
  const entitlements: Partial<Record<Feature, FeatureEntitlement>> = {};
  for (const row of input.entitlements) {
    if (!isFeature(row.feature)) continue;
    entitlements[row.feature] = {
      entitled: row.entitled,
      tenantConfigurable: row.tenantConfigurable,
    };
  }
  return { businessType: input.businessType, entitlements, tenant, location, device };
}

const OWN_LAYER = { TENANT: 'tenant', LOCATION: 'location', DEVICE: 'device' } as const;

/**
 * The Modules page of one scope: each module's value, what the scope would inherit without its
 * own override (the layer's values removed), and the override itself. Layers more specific than
 * the scope must be absent (a tenant's page knows no location).
 */
export function featureSettings(layers: FeatureLayers, layer: OverrideLayer): FeatureSetting[] {
  const own = layers[OWN_LAYER[layer]] ?? {};
  const resolved = resolveFeatures(layers);
  const inherited = resolveFeatures({ ...layers, [OWN_LAYER[layer]]: {} });
  return FEATURES.map((feature) => ({
    ...resolved[feature],
    inherited: { enabled: inherited[feature].enabled, source: inherited[feature].source },
    override: own[feature] ?? null,
  }));
}
