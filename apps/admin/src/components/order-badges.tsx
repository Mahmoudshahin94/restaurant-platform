import type { OrderStatus, PaymentStatus } from '@pos/shared-types';
import { Badge, type BadgeProps } from '@pos/ui';
import { useTranslation } from 'react-i18next';

const STATUS_VARIANT: Record<OrderStatus, BadgeProps['variant']> = {
  DRAFT: 'outline',
  PLACED: 'warning',
  CONFIRMED: 'secondary',
  PREPARING: 'secondary',
  READY: 'success',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
  REFUNDED: 'outline',
};

const PAYMENT_VARIANT: Record<PaymentStatus, BadgeProps['variant']> = {
  UNPAID: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  PARTIALLY_REFUNDED: 'outline',
  REFUNDED: 'outline',
};

/** Order status in words (colour is only a second cue). */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation('orders');
  return <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation('orders');
  return <Badge variant={PAYMENT_VARIANT[status]}>{t(`payment.${status}`)}</Badge>;
}
