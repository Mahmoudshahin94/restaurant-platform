import { useCurrentLocale, useFormatOptions } from '@pos/app-kit';
import { formatTime, pickLocalized } from '@pos/i18n';
import type { PublicOrder } from '@pos/validation';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@pos/ui';
import { Check, Clock, CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { joinNames } from '../lib/format';
import { OrderTotals } from './order-totals';

const STEPS = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'] as const;
const REASONS = new Set([
  'TOO_BUSY',
  'ITEM_UNAVAILABLE',
  'CLOSING_SOON',
  'DELIVERY_AREA',
  'OTHER',
  'ACCEPTANCE_TIMEOUT',
]);

/** Where the order stands, its progress, what was ordered and how it is paid and handed over. */
export function OrderStatusView({ order }: { order: PublicOrder }) {
  const { t } = useTranslation(['customer', 'orders']);
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const tz = order.location.timezone;
  const cancelled = order.status === 'CANCELLED' || order.status === 'REFUNDED';
  const reached = new Set(order.timeline.map((e) => e.status));
  const currentIndex = STEPS.findIndex((s) => s === order.status);
  const detailKey =
    order.status === 'READY'
      ? order.fulfillmentType === 'DELIVERY'
        ? 'READY_DELIVERY'
        : 'READY_PICKUP'
      : order.status;
  const reason =
    order.cancelReason && REASONS.has(order.cancelReason) ? order.cancelReason : 'OTHER';
  const voided = order.paymentOption === 'ONLINE_CARD' && order.paymentStatus === 'REFUNDED';
  const address = order.deliveryAddress
    ? joinNames(
        [
          order.deliveryAddress.line1,
          order.deliveryAddress.line2,
          order.deliveryAddress.city,
        ].filter((part): part is string => Boolean(part)),
        locale,
      )
    : '';

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-xl">
              {t('customer:status.title', { number: order.orderNumber })}
            </CardTitle>
            <Badge
              variant={
                cancelled ? 'destructive' : order.status === 'PLACED' ? 'warning' : 'success'
              }
              data-testid="order-status"
              className="gap-1 text-sm"
            >
              {cancelled ? <CircleX aria-hidden className="size-3.5" /> : null}
              {t(`customer:status.label.${order.status}`)}
            </Badge>
          </div>
          <p role="status" aria-live="polite" className="text-muted-foreground">
            {t(`customer:status.detail.${detailKey}`)}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {cancelled ? (
            <Alert variant="destructive">
              {t(`customer:status.cancelReason.${reason as 'OTHER'}`)}
              {voided ? <span className="block">{t('customer:status.voided')}</span> : null}
            </Alert>
          ) : (
            <ol aria-label={t('customer:status.progress')} className="grid grid-cols-5 gap-1">
              {STEPS.map((step, index) => {
                const done = reached.has(step) || index <= currentIndex;
                return (
                  <li
                    key={step}
                    aria-current={step === order.status ? 'step' : undefined}
                    className="grid justify-items-center gap-1 text-center text-xs"
                  >
                    <span
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full border-2',
                        done
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border',
                      )}
                    >
                      {done ? (
                        <Check aria-hidden className="size-4" />
                      ) : (
                        <Clock aria-hidden className="size-4" />
                      )}
                    </span>
                    <span className={cn(step === order.status && 'font-semibold')}>
                      {t(`customer:status.step.${step}`)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {order.status === 'PLACED' && order.acceptBy ? (
            <p className="text-sm text-muted-foreground">
              {t('customer:status.acceptBy', {
                time: formatTime(order.acceptBy, tz, locale, formatOptions),
              })}
            </p>
          ) : null}
          <div className="grid gap-1 text-sm">
            <p>
              {order.fulfillmentType === 'DELIVERY'
                ? t('customer:status.deliverTo', { address })
                : t('customer:status.pickupAt', {
                    location: pickLocalized(order.location, 'name', locale),
                  })}
            </p>
            <p className="text-muted-foreground">
              {order.paymentOption === 'ONLINE_CARD'
                ? t('customer:status.paidOnline')
                : order.paymentOption === 'PAY_AT_PICKUP'
                  ? t('customer:status.payAtPickup')
                  : t('customer:status.payOnDelivery')}
            </p>
            {order.location.phone ? (
              <p className="text-muted-foreground">
                {t('customer:status.call', { phone: '' })}
                <bdi className="ltr-nums">{order.location.phone}</bdi>
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('customer:checkout.summary')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="divide-y">
            {order.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3 py-2 text-sm">
                <span>
                  <bdi dir="ltr" className="ltr-nums me-1">
                    {item.quantity}×
                  </bdi>
                  {pickLocalized(item, 'name', locale)}
                  {item.variantNameEn ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · {pickLocalized(item, 'variantName', locale)}
                    </span>
                  ) : null}
                  {item.modifiers.length > 0 ? (
                    <span className="block text-muted-foreground">
                      {joinNames(
                        item.modifiers.map((m) => pickLocalized(m, 'name', locale)),
                        locale,
                      )}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <OrderTotals
            currency={order.currencyCode}
            taxInclusive={order.taxInclusive}
            totals={{
              subtotal: order.subtotal,
              discount: order.discountTotal,
              tax: order.taxTotal,
              fees: order.feeTotal,
              total: order.total,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
