import { useFeatures } from '@pos/app-kit';
import type { Feature } from '@pos/shared-types';
import { Button, EmptyState } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { usePermissions } from '../lib/permissions';

/**
 * Pages of a module (ADR 0018): shown while any of `features` is on for the location chosen in
 * the header, otherwise a note pointing to the Modules page. The API refuses the module's routes
 * anyway (`FEATURE_DISABLED`).
 */
export function RequireModule({ features }: { features: readonly Feature[] }) {
  const { t } = useTranslation(['admin', 'common']);
  const resolved = useFeatures();
  const { can } = usePermissions();
  if (features.some((f) => resolved[f].enabled)) return <Outlet />;
  const feature = features[0];
  return (
    <EmptyState
      title={t('admin:modules.offTitle')}
      description={
        feature
          ? t('admin:modules.offDescription', {
              module: t(`admin:modules.features.${feature}.name`),
            })
          : undefined
      }
      action={
        can('settings.manage') ? (
          <Button asChild variant="outline">
            <Link to="/settings/modules">{t('admin:modules.openModules')}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
