/**
 * The module catalog (ADR 0018). Every capability a tenant can have switched on or off is listed
 * here; code asks `isEnabled(Feature.KDS)`, never what kind of business the tenant is. Stored as
 * text (entitlements, overrides), so a new module is a code change here, not a migration.
 */

type ValueOf<T> = T[keyof T];

export const Feature = {
  /** Point of sale: taking orders and payments at a counter or a table. */
  POS: 'POS',
  /** Kitchen display: confirmed orders become kitchen tickets that cooks work through. */
  KDS: 'KDS',
  /** Kitchen chits printed per station. */
  KITCHEN_PRINTER: 'KITCHEN_PRINTER',
  /** The customer website: menus, ordering and order tracking. */
  ONLINE_ORDERING: 'ONLINE_ORDERING',
  /** Scanning product barcodes (Phase M5). */
  BARCODE: 'BARCODE',
  /** Stock levels and movements (Phase M5). */
  INVENTORY: 'INVENTORY',
  /** Floor plan, tables and dine-in orders served at a table. */
  TABLES: 'TABLES',
  /** Modifier groups (extras, removals, choices) on products. */
  MODIFIERS: 'MODIFIERS',
  /** Products sold in variants (sizes, colours). */
  PRODUCT_VARIANTS: 'PRODUCT_VARIANTS',
  /** Orders delivered to the customer. */
  DELIVERY: 'DELIVERY',
  /** Self-service kiosks (Phase M6). */
  SELF_CHECKOUT: 'SELF_CHECKOUT',
  /** A screen facing the customer at the till. */
  CUSTOMER_DISPLAY: 'CUSTOMER_DISPLAY',
  /** Customer loyalty programmes. */
  LOYALTY: 'LOYALTY',
  /** Reports beyond the daily summary. */
  ADVANCED_REPORTING: 'ADVANCED_REPORTING',
} as const;
export type Feature = ValueOf<typeof Feature>;

/** Every module, in catalog order (the admin lists them in this order). */
export const FEATURES = Object.values(Feature) as readonly Feature[];

export function isFeature(value: unknown): value is Feature {
  return typeof value === 'string' && (FEATURES as readonly string[]).includes(value);
}

/**
 * Configuration layers, from the least to the most specific (docs/configuration.md). A more
 * specific layer overrides a less specific one; the platform entitlement caps the result.
 */
export const ConfigLayer = {
  PLATFORM: 'PLATFORM',
  BUSINESS_TYPE: 'BUSINESS_TYPE',
  TENANT: 'TENANT',
  LOCATION: 'LOCATION',
  DEVICE: 'DEVICE',
} as const;
export type ConfigLayer = ValueOf<typeof ConfigLayer>;

/** Layers in precedence order: later entries win. */
export const CONFIG_LAYERS = Object.values(ConfigLayer) as readonly ConfigLayer[];

/** Layers a tenant administrator may write (the others belong to MADAR). */
export const TENANT_CONFIG_LAYERS: readonly ConfigLayer[] = [
  ConfigLayer.TENANT,
  ConfigLayer.LOCATION,
  ConfigLayer.DEVICE,
];

/** One module as resolved for a tenant, location or device. */
export interface ResolvedFeature {
  feature: Feature;
  enabled: boolean;
  /**
   * The layer that decided `enabled`. `PLATFORM` also when the platform entitlement capped the
   * value (then `entitled` is false).
   */
  source: ConfigLayer;
  /** Whether the tenant's plan includes the module. Without it, the module is off everywhere. */
  entitled: boolean;
  /** Whether tenant administrators may switch the module (tenant, location and device layers). */
  configurable: boolean;
}

/** Every module, resolved; keyed by feature. */
export type ResolvedFeatures = Record<Feature, ResolvedFeature>;

/** The layers an override is written at, and the scope of the admin's Modules page. */
export type OverrideLayer = 'TENANT' | 'LOCATION' | 'DEVICE';

/** One module as the Modules page shows it for one scope (tenant, location or device). */
export interface FeatureSetting extends ResolvedFeature {
  /** What the scope gets without its own override, and from which layer. */
  inherited: { enabled: boolean; source: ConfigLayer };
  /** The scope's own override; null when it inherits. */
  override: boolean | null;
}
