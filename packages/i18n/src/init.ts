import { LOCALES, type Locale } from '@pos/shared-types';
import i18next, { type Module, type i18n } from 'i18next';
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources';

export interface InitI18nOptions {
  locale: Locale;
  /** Framework bindings, e.g. `initReactI18next` from react-i18next. */
  plugins?: Module[];
}

/** Creates an isolated, fully initialized i18next instance with the bundled resources. */
export async function initI18n({ locale, plugins = [] }: InitI18nOptions): Promise<i18n> {
  const instance = i18next.createInstance();
  for (const plugin of plugins) instance.use(plugin);
  await instance.init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: [...LOCALES],
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
