import { applyDocumentLocale, initI18n, isLocale } from '@pos/i18n';
import type { Locale } from '@pos/shared-types';
import { DirectionProvider } from '@pos/ui';
import type { i18n as I18nInstance } from 'i18next';
import { type ReactNode, useSyncExternalStore } from 'react';
import { initReactI18next } from 'react-i18next';

/** Initializes i18next for React and keeps <html lang/dir> in sync with the active language. */
export async function setupReactI18n(locale: Locale): Promise<I18nInstance> {
  const i18n = await initI18n({ locale, plugins: [initReactI18next] });
  applyDocumentLocale(locale);
  i18n.on('languageChanged', (lng) => {
    if (isLocale(lng)) applyDocumentLocale(lng);
  });
  return i18n;
}

/** Feeds the active direction to Radix primitives and re-renders on language change. */
export function DirectionBridge({ i18n, children }: { i18n: I18nInstance; children: ReactNode }) {
  const lng = useSyncExternalStore(
    (notify) => {
      i18n.on('languageChanged', notify);
      return () => {
        i18n.off('languageChanged', notify);
      };
    },
    () => i18n.language,
  );
  return <DirectionProvider dir={i18n.dir(lng)}>{children}</DirectionProvider>;
}

/** Initial locale: the stored preference, else the browser language if supported, else English. */
export function initialLocale(stored: Locale | null): Locale {
  const browser = typeof navigator === 'undefined' ? '' : navigator.language.slice(0, 2);
  return stored ?? (isLocale(browser) ? browser : 'en');
}
