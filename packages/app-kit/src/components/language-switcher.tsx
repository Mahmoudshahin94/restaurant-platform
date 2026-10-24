import { showsLanguageSwitcher } from '@pos/domain';
import type { Locale } from '@pos/shared-types';
import { NativeSelect } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useCurrentLocale } from '../locale';
import { useSupportedLocales } from '../localization';

/**
 * The language switcher (ADR 0020): it offers only the tenant's languages (`locales`, else those
 * of the `LocalizationProvider` above, else every platform locale) and is not shown at all when
 * the tenant has one language.
 */
export function LanguageSwitcher({
  className,
  locales,
  onLocaleChange,
}: {
  className?: string;
  locales?: readonly Locale[];
  /** Persist the choice (e.g. in app preferences). */
  onLocaleChange?: (locale: Locale) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = useCurrentLocale();
  const provided = useSupportedLocales();
  const offered = locales ?? provided;
  if (!showsLanguageSwitcher(offered)) return null;
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
      {offered.map((l) => (
        <option key={l} value={l} lang={l}>
          {t(`language.${l}`)}
        </option>
      ))}
    </NativeSelect>
  );
}
