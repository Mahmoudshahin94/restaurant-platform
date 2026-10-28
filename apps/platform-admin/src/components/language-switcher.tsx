import { LanguageSwitcher as BaseLanguageSwitcher } from '@pos/app-kit';
import { LOCALES } from '@pos/shared-types';
import { usePreferences } from '../stores/preferences';

/** Every platform language, remembered on this browser. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const setLocale = usePreferences((s) => s.setLocale);
  return (
    <BaseLanguageSwitcher className={className} locales={LOCALES} onLocaleChange={setLocale} />
  );
}
