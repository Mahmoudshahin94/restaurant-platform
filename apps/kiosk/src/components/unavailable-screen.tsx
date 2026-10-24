import { TenantLogo } from '@pos/app-kit';
import { Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';

/** SELF_CHECKOUT is off for this location or kiosk (ADR 0018): nothing to order here. */
export function UnavailableScreen() {
  const { t } = useTranslation('kiosk');
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="grid min-h-full place-items-center p-8 text-center">
      <div className="grid justify-items-center gap-6">
        <TenantLogo />
        <Store aria-hidden className="size-16 text-muted-foreground" />
        <h1 ref={heading} tabIndex={-1} className="text-4xl font-bold outline-none">
          {t('unavailable.title')}
        </h1>
        <p className="text-2xl text-muted-foreground">{t('unavailable.body')}</p>
      </div>
    </main>
  );
}
