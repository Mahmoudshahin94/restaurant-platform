import type { OrderStatus } from '@pos/shared-types';
import { Badge } from '@pos/ui';
import { useTranslation } from 'react-i18next';

const VARIANT: Record<
  OrderStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  DRAFT: 'outline',
  PLACED: 'default',
  CONFIRMED: 'secondary',
  PREPARING: 'warning',
  READY: 'success',
  COMPLETED: 'outline',
  CANCELLED: 'destructive',
  REFUNDED: 'destructive',
};

/** Always shows the status text, so status never depends on colour alone. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation('orders');
  return <Badge variant={VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}
