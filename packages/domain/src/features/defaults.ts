import { type BusinessType, Feature } from '@pos/shared-types';

/**
 * The only place that knows what a business type means (ADR 0018). A type picks which modules a
 * tenant starts with; everything after that asks for capabilities. The lint rule
 * `pos-local/no-business-type-branching` keeps comparisons of `businessType` in this file.
 */

/** MADAR's defaults for every tenant: the till only. */
export const PLATFORM_FEATURE_DEFAULTS: Readonly<Record<Feature, boolean>> = {
  POS: true,
  KDS: false,
  KITCHEN_PRINTER: false,
  ONLINE_ORDERING: false,
  BARCODE: false,
  INVENTORY: false,
  TABLES: false,
  MODIFIERS: false,
  PRODUCT_VARIANTS: false,
  DELIVERY: false,
  SELF_CHECKOUT: false,
  CUSTOMER_DISPLAY: false,
  LOYALTY: false,
  ADVANCED_REPORTING: false,
};

const on = (...features: Feature[]): Partial<Record<Feature, boolean>> =>
  Object.fromEntries(features.map((feature) => [feature, true]));

const RETAIL = on(
  Feature.POS,
  Feature.BARCODE,
  Feature.INVENTORY,
  Feature.PRODUCT_VARIANTS,
  Feature.CUSTOMER_DISPLAY,
  Feature.LOYALTY,
);

const GROCERY = on(
  Feature.POS,
  Feature.BARCODE,
  Feature.INVENTORY,
  Feature.SELF_CHECKOUT,
  Feature.CUSTOMER_DISPLAY,
  Feature.DELIVERY,
  Feature.LOYALTY,
);

/**
 * What each business type switches on above the platform defaults. Only `true` entries: a type
 * adds modules, it never needs to remove one the platform gives everybody.
 */
export const BUSINESS_TYPE_DEFAULTS: Readonly<
  Record<BusinessType, Partial<Record<Feature, boolean>>>
> = {
  RESTAURANT: on(
    Feature.POS,
    Feature.KDS,
    Feature.KITCHEN_PRINTER,
    Feature.ONLINE_ORDERING,
    Feature.TABLES,
    Feature.MODIFIERS,
    Feature.PRODUCT_VARIANTS,
    Feature.DELIVERY,
  ),
  COFFEE_SHOP: on(
    Feature.POS,
    Feature.KDS,
    Feature.MODIFIERS,
    Feature.ONLINE_ORDERING,
    Feature.SELF_CHECKOUT,
  ),
  SUPERMARKET: GROCERY,
  GROCERY,
  CLOTHING: RETAIL,
  RETAIL,
  OTHER: {},
};

/** The defaults of a stored business type; an unknown type gets the platform defaults only. */
export function businessTypeDefaults(businessType: string): Partial<Record<Feature, boolean>> {
  return Object.hasOwn(BUSINESS_TYPE_DEFAULTS, businessType)
    ? BUSINESS_TYPE_DEFAULTS[businessType as BusinessType]
    : {};
}
