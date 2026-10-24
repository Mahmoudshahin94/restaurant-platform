import { useCurrentLocale, useSupportedLocales } from '@pos/app-kit';
import { showsLanguageSwitcher } from '@pos/domain';
import { Button, cn } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useSession } from '../stores/session';

/**
 * The tenant's languages as large buttons, each named in its own language (ADR 0020). The choice
 * lasts for this customer's visit only. Hidden when the tenant offers one language.
 */
export function LanguageButtons({ className }: { className?: string }) {
  const { t } = useTranslation(['common', 'kiosk']);
  const locale = useCurrentLocale();
  const offered = useSupportedLocales();
  const setLocale = useSession((s) => s.setLocale);
  if (!showsLanguageSwitcher(offered)) return null;
  return (
    <div
      role="group"
      aria-label={t('kiosk:welcome.language')}
      className={cn('flex gap-2', className)}
    >
      {offered.map((l) => (
        <Button
          key={l}
          type="button"
          size="touch"
          lang={l}
          variant={l === locale ? 'default' : 'outline'}
          aria-pressed={l === locale}
          onClick={() => {
            setLocale(l);
          }}
        >
          {t(`common:language.${l}`, { lng: l })}
        </Button>
      ))}
    </div>
  );
}
