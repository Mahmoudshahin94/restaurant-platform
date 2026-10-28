import type { PlatformPermission } from '@pos/shared-types';
import { EmptyState } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { usePlatformCan } from '../lib/permissions';

/** Pages the operator's role cannot use say so instead of failing (the API refuses anyway). */
export function RequirePermission({ permission }: { permission: PlatformPermission }) {
  const { t } = useTranslation('platform');
  const can = usePlatformCan();
  return can(permission) ? <Outlet /> : <EmptyState title={t('forbidden')} />;
}
