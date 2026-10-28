import type { TenantStatus } from '@pos/shared-types';
import { Badge } from '@pos/ui';
import { useTranslation } from 'react-i18next';

const VARIANT = { ACTIVE: 'success', SUSPENDED: 'destructive', ARCHIVED: 'secondary' } as const;

/** A tenant's status, in words and colour. */
export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  const { t } = useTranslation('platform');
  return <Badge variant={VARIANT[status]}>{t(`statuses.${status}`)}</Badge>;
}
