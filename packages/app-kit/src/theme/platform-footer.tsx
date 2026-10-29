import { MADAR_VERSION, type PlatformApp } from '@pos/shared-types';
import { cn } from '@pos/ui';
import { useTranslation } from 'react-i18next';

/**
 * "MADAR POS · Powered by JudyTech · v1.0.0", from PLATFORM_BRAND through the translations, with
 * the MADAR version this build is (ADR 0026).
 */
export function PlatformFooter({ app, className }: { app: PlatformApp; className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      <span dir="ltr">{t(`platform.products.${app}`)}</span>
      {' · '}
      {t('poweredBy')}
      {' · '}
      <span dir="ltr" title={t('version', { version: MADAR_VERSION })}>
        {t('versionShort', { version: MADAR_VERSION })}
      </span>
    </p>
  );
}
