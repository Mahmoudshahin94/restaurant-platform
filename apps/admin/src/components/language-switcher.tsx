import { LanguageSwitcher as BaseLanguageSwitcher } from '@pos/app-kit';
import { usePreferences } from '../stores/preferences';

/** Language picker that remembers the choice on this browser. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const setLocale = usePreferences((s) => s.setLocale);
  return <BaseLanguageSwitcher className={className} onLocaleChange={setLocale} />;
}
