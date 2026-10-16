import { type I18nResources, applyDocumentLocale, initI18n, isLocale } from '@pos/i18n';
import type { Locale } from '@pos/shared-types';
import type { i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: I18nResources;
  }
}

/** Initializes i18next for React and keeps <html lang/dir> in sync with the active language. */
export async function setupI18n(locale: Locale): Promise<I18nInstance> {
  const i18n = await initI18n({ locale, plugins: [initReactI18next] });
  applyDocumentLocale(locale);
  i18n.on('languageChanged', (lng) => {
    if (isLocale(lng)) applyDocumentLocale(lng);
  });
  return i18n;
}
