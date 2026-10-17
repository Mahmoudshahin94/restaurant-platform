import type { PublicLocation } from '@pos/validation';
import { Alert, Badge } from '@pos/ui';
import { CircleCheck, CirclePause, CircleX, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const ICONS = { OPEN: CircleCheck, PAUSED: CirclePause, CLOSED: CircleX, OFFLINE: WifiOff };

/** Whether the branch takes orders, with icon and words (never colour alone). */
export function OrderingBadge({ status }: { status: PublicLocation['status'] }) {
  const { t } = useTranslation('customer');
  const Icon = ICONS[status.state];
  return (
    <Badge variant={status.state === 'OPEN' ? 'success' : 'secondary'} className="gap-1">
      <Icon aria-hidden className="size-3.5" />
      {t(`ordering.${status.state}`)}
    </Badge>
  );
}

/** Explains why orders cannot be placed; nothing when the branch is open. */
export function OrderingNotice({ status }: { status: PublicLocation['status'] }) {
  const { t } = useTranslation('customer');
  if (status.state === 'OPEN' || status.reason === null) return null;
  return (
    <Alert title={t(`ordering.${status.state}`)}>
      {t(`ordering.reason.${status.reason}`)} {t('menu.orderingUnavailable')}
    </Alert>
  );
}
