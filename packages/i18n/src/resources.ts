import arAdmin from './locales/ar/admin.json';
import arAuth from './locales/ar/auth.json';
import arCommon from './locales/ar/common.json';
import arErrors from './locales/ar/errors.json';
import arMenu from './locales/ar/menu.json';
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
  en: { common: enCommon, errors: enErrors, auth: enAuth, admin: enAdmin, menu: enMenu },
  ar: { common: arCommon, errors: arErrors, auth: arAuth, admin: arAdmin, menu: arMenu },
} as const;

export type I18nResources = (typeof resources)['en'];
export type Namespace = keyof I18nResources;
export const NAMESPACES = Object.keys(resources.en) as Namespace[];
export const DEFAULT_NAMESPACE = 'common' satisfies Namespace;
