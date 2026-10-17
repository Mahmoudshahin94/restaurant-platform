import { LOCALES, type Locale } from '@pos/shared-types';
import { NativeSelect } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useCurrentLocale } from '../locale';

export function LanguageSwitcher({
  className,
  onLocaleChange,
}: {
  className?: string;
  /** Persist the choice (e.g. in app preferences). */
  onLocaleChange?: (locale: Locale) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = useCurrentLocale();
  return (
    <NativeSelect
      aria-label={t('language.label')}
      className={className ?? 'h-9 w-auto'}
      value={locale}
      onChange={(event) => {
        const next = event.target.value as Locale;
        onLocaleChange?.(next);
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
