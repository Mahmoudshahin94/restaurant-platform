import type { PlatformApp } from '@pos/shared-types';
import { cn } from '@pos/ui';
import { useTranslation } from 'react-i18next';

/** "MADAR POS · Powered by JudyTech", from PLATFORM_BRAND through the translations. */
export function PlatformFooter({ app, className }: { app: PlatformApp; className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      <span dir="ltr">{t(`platform.products.${app}`)}</span>
      {' · '}
      {t('poweredBy')}
    </p>
  );
}
