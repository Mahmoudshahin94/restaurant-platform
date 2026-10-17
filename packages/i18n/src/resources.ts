import arFloor from './locales/ar/floor.json';
import arOrders from './locales/ar/orders.json';
import arPos from './locales/ar/pos.json';
import arPricing from './locales/ar/pricing.json';
import arAdmin from './locales/ar/admin.json';
import arAuth from './locales/ar/auth.json';
import arCommon from './locales/ar/common.json';
import arErrors from './locales/ar/errors.json';
import arMenu from './locales/ar/menu.json';
import enFloor from './locales/en/floor.json';
import enOrders from './locales/en/orders.json';
import enPos from './locales/en/pos.json';
import enPricing from './locales/en/pricing.json';
import enAdmin from './locales/en/admin.json';
import enAuth from './locales/en/auth.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enMenu from './locales/en/menu.json';

/**
 * Translation resources. English is the reference language: its JSON shape is the type that
 * every other language must match (verified by resources.test.ts).
 */
export const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    auth: enAuth,
    admin: enAdmin,
    menu: enMenu,
    orders: enOrders,
    pricing: enPricing,
    floor: enFloor,
    pos: enPos,
  },
  ar: {
    common: arCommon,
    errors: arErrors,
    auth: arAuth,
    admin: arAdmin,
    menu: arMenu,
    orders: arOrders,
    pricing: arPricing,
    floor: arFloor,
    pos: arPos,
  },
} as const;

export type I18nResources = (typeof resources)['en'];
export type Namespace = keyof I18nResources;
export const NAMESPACES = Object.keys(resources.en) as Namespace[];
export const DEFAULT_NAMESPACE = 'common' satisfies Namespace;
