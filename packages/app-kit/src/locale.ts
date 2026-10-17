import { isLocale } from '@pos/i18n';
import type { Locale } from '@pos/shared-types';
import { useTranslation } from 'react-i18next';

export function useCurrentLocale(): Locale {
  const { i18n } = useTranslation();
  return isLocale(i18n.language) ? i18n.language : 'en';
}
