import { LOCALES, type Locale } from '@pos/shared-types';
import { NativeSelect } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useCurrentLocale } from '../lib/locale';
import { usePreferences } from '../stores/preferences';

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const locale = useCurrentLocale();
  const setLocale = usePreferences((s) => s.setLocale);
  return (
    <NativeSelect
      aria-label={t('language.label')}
      className={className ?? 'h-9 w-auto'}
      value={locale}
      onChange={(event) => {
        const next = event.target.value as Locale;
        setLocale(next);
        void i18n.changeLanguage(next);
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l} lang={l}>
          {t(`language.${l}`)}
        </option>
      ))}
    </NativeSelect>
  );
}
