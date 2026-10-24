import { isApiError } from '@pos/api-client';
import {
  QueryState,
  tKey,
  useCurrentLocale,
  useErrorText,
  useFeature,
  useFormatOptions,
  useMoneyFormat,
  usePermissionChecks,
} from '@pos/app-kit';
import { allowedTransitions, canModifyItems, refundableAmount } from '@pos/domain';
import { formatDateTime, pickLocalized } from '@pos/i18n';
import { Feature } from '@pos/shared-types';
import type { Order, OrderPayment } from '@pos/validation';
import { Alert, Button, Card, Dialog, DialogContent, EmptyState, cn } from '@pos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { CancelOrderDialog } from '../components/cancel-order-dialog';
import { KitchenProgress, hasLiveTickets } from '../components/kitchen-progress';
import { OrderStatusBadge } from '../components/order-status-badge';
import { PaymentDialog } from '../components/payment-dialog';
import { ReceiptPreview } from '../components/receipt-preview';
import { RefundDialog } from '../components/refund-dialog';
import {
  useCurrentShift,
  useLocationId,
  useLocations,
  useOrderMutation,
  useOrders,
  usePaymentMethods,
} from '../lib/queries';
import { useReceiptBuilder } from '../lib/receipt';
import { api, useSession } from '../lib/session';
import { useCart } from '../stores/cart';

const PAYABLE = new Set<Order['status']>(['PLACED', 'CONFIRMED', 'PREPARING', 'READY']);

type DetailDialog = 'cancel' | 'pay' | 'receipt' | { refund: OrderPayment } | null;

/** Payment, receipt and refund actions shared by the orders screen and the order entry screen. */
export function OrderPaymentDialogs({
  order,
  dialog,
  setDialog,
}: {
  order: Order;
  dialog: DetailDialog;
  setDialog: (d: DetailDialog) => void;
}) {
  const { t } = useTranslation(['payments', 'common']);
  const locale = useCurrentLocale();
  const navigate = useNavigate();
  const methods = usePaymentMethods();
  const location = useLocations().data?.find((l) => l.id === order.locationId);
  const { shiftId } = useCurrentShift(order.locationId);
  const buildReceipt = useReceiptBuilder();
  const [latest, setLatest] = useState(order);
  const needsShift =
    (dialog === 'pay' || (typeof dialog === 'object' && dialog !== null)) && !shiftId;

  return (
    <Dialog
      open={dialog !== null && dialog !== 'cancel'}
      onOpenChange={(open) => {
        if (!open) setDialog(null);
      }}
    >
      {needsShift ? (
        <DialogContent closeLabel={t('common:actions.close')}>
          <Alert
            action={
              <Button onClick={() => void navigate('/shift')}>{t('payments:goToShift')}</Button>
            }
          >
            {t('payments:needShift')}
          </Alert>
        </DialogContent>
      ) : null}
      {dialog === 'pay' && shiftId && methods.data ? (
        <PaymentDialog
          order={order}
          methods={methods.data}
          shiftId={shiftId}
          cashRoundingIncrement={location?.cashRoundingIncrement ?? null}
          onPaid={setLatest}
        />
      ) : null}
      {dialog === 'receipt' && buildReceipt ? (
        <ReceiptPreview doc={buildReceipt(latest.version >= order.version ? latest : order)} />
      ) : null}
      {typeof dialog === 'object' && dialog !== null && shiftId ? (
        <RefundDialog
          order={order}
          charge={dialog.refund}
          shiftId={shiftId}
          refundable={refundableAmount(
            dialog.refund,
            order.payments.filter((p) => p.status === 'CAPTURED'),
          )}
          methodName={pickLocalized(
            { nameEn: dialog.refund.methodNameEn, nameAr: dialog.refund.methodNameAr },
            'name',
            locale,
          )}
          onDone={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function PaymentsList({
  order,
  canRefund,
  onRefund,
}: {
  order: Order;
  canRefund: boolean;
  onRefund: (p: OrderPayment) => void;
}) {
  const { t } = useTranslation(['payments']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(order.currencyCode);
  const settled = order.payments.filter((p) => p.status === 'CAPTURED');
  if (settled.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-2 font-semibold">{t('payments:payments')}</h3>
      <ul className="grid gap-1 text-sm">
        {settled.map((p) => {
          const name = pickLocalized(
            { nameEn: p.methodNameEn, nameAr: p.methodNameAr },
            'name',
            locale,
          );
          const refundable = p.type === 'CHARGE' ? refundableAmount(p, settled) : 0;
          return (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span>
                {p.type === 'REFUND' ? `${t('payments:refunded')} · ${name}` : name}
                {p.reference ? (
                  <span className="ltr-nums text-muted-foreground"> · {p.reference}</span>
                ) : null}
                {p.change > 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('payments:change')} {format(p.change)}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="whitespace-nowrap">
                  {format(p.type === 'REFUND' ? -p.amount : p.amount)}
                </span>
                {canRefund && refundable > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onRefund(p);
                    }}
                  >
                    {t('payments:refund')}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OrderDetail({ order, timeZone }: { order: Order; timeZone: string }) {
  const { t } = useTranslation(['orders', 'pos', 'common', 'payments']);
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const errorText = useErrorText();
  const { format } = useMoneyFormat(order.currencyCode);
  const user = useSession((s) => s.user);
  const { canAt } = usePermissionChecks(user);
  const kitchenOn = useFeature(Feature.KDS);
  const loadOrder = useCart((s) => s.loadOrder);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DetailDialog>(null);
  const cancelling = dialog === 'cancel';
  const setCancelling = (open: boolean) => {
    setDialog(open ? 'cancel' : null);
  };
  const [error, setError] = useState<string | null>(null);

  const transition = useOrderMutation((body: { to: Order['status']; reason?: string }) =>
    api.orders.transition(order.locationId, order.id, { ...body, version: order.version }),
  );
  const run = async (body: { to: Order['status']; reason?: string }) => {
    setError(null);
    try {
      await transition.mutateAsync(body);
      setCancelling(false);
    } catch (e) {
      const reason = isApiError(e) ? (e.details.reason as string | undefined) : undefined;
      setError(reason ? tKey(t, `orders:reasons.${reason}`) : errorText(e));
    }
  };

  const next = allowedTransitions(order.status, 'STAFF');
  const canConfirm = next.includes('CONFIRMED') && canAt(order.locationId, 'orders.update');
  const canCancel = next.includes('CANCELLED') && canAt(order.locationId, 'orders.cancel');
  const canEdit = canModifyItems(order.status) && canAt(order.locationId, 'orders.update');
  const canPay =
    PAYABLE.has(order.status) && order.balanceDue > 0 && canAt(order.locationId, 'payments.create');
  // A confirmed order may skip READY only when the kitchen has nothing of it left (without a
  // kitchen display, nothing is waited for).
  const canComplete =
    next.includes('COMPLETED') &&
    order.paymentStatus === 'PAID' &&
    !(order.status === 'CONFIRMED' && kitchenOn && hasLiveTickets(order)) &&
    canAt(order.locationId, 'orders.update');
  const rush = useOrderMutation((priority: 'RUSH' | 'NORMAL') =>
    api.orders.kitchenPriority(order.locationId, order.id, { priority }),
  );
  const canRefund = canAt(order.locationId, 'payments.refund');

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <h2 className="ltr-nums text-2xl font-bold">{order.orderNumber}</h2>
        <OrderStatusBadge status={order.status} />
        <span className="text-muted-foreground">{t(`orders:channel.${order.channel}`)}</span>
        {order.tableLabel ? <span className="ltr-nums font-medium">{order.tableLabel}</span> : null}
        <span className="ms-auto text-sm text-muted-foreground">
          {formatDateTime(order.createdAt, timeZone, locale, formatOptions)}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {order.customerName || order.customerPhone ? (
          <p className="mb-3 text-sm">
            {order.customerName}{' '}
            {order.customerPhone ? <bdi dir="ltr">{order.customerPhone}</bdi> : null}
          </p>
        ) : null}
        <ul className="grid gap-2">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 border-b pb-2">
              <div>
                <span className="ltr-nums font-semibold">{item.quantity}×</span>{' '}
                {pickLocalized(item, 'name', locale)}
                {item.variantNameEn
                  ? ` · ${locale === 'ar' ? (item.variantNameAr ?? '') : item.variantNameEn}`
                  : ''}
                {item.modifiers.length > 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {item.modifiers.map((m) => pickLocalized(m, 'name', locale)).join('، ')}
                  </div>
                ) : null}
                {item.notes ? (
                  <div className="text-sm italic text-muted-foreground">{item.notes}</div>
                ) : null}
              </div>
              <span className="whitespace-nowrap">{format(item.gross)}</span>
            </li>
          ))}
        </ul>
        {order.notes ? <p className="mt-3 text-sm italic">{order.notes}</p> : null}
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-1 text-sm">
          <dt>{t('orders:totals.subtotal')}</dt>
          <dd className="text-end">{format(order.subtotal)}</dd>
          {order.discountTotal > 0 ? (
            <>
              <dt>{t('orders:totals.discount')}</dt>
              <dd className="text-end">{format(-order.discountTotal)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">
            {order.taxInclusive ? t('orders:totals.taxIncluded') : t('orders:totals.tax')}
          </dt>
          <dd className="text-end text-muted-foreground">{format(order.taxTotal)}</dd>
          <dt className="text-lg font-bold">{t('orders:totals.total')}</dt>
          <dd className="text-end text-lg font-bold">{format(order.total)}</dd>
          {order.paidTotal > 0 ? (
            <>
              <dt>{t('payments:paid')}</dt>
              <dd className="text-end">{format(order.paidTotal - order.refundedTotal)}</dd>
            </>
          ) : null}
          <dt className="font-semibold">{t('payments:balanceDue')}</dt>
          <dd className="text-end font-semibold">{format(order.balanceDue)}</dd>
        </dl>
        <KitchenProgress
          order={order}
          canRush={canAt(order.locationId, 'orders.update')}
          rushing={rush.isPending}
          onRush={(priority) => {
            setError(null);
            rush.mutate(priority, {
              onError: (e) => {
                setError(errorText(e));
              },
            });
          }}
        />
        <PaymentsList
          order={order}
          canRefund={canRefund}
          onRefund={(p) => {
            setDialog({ refund: p });
          }}
        />
        <h3 className="mt-6 mb-2 font-semibold">{t('orders:history')}</h3>
        <ol className="grid gap-1 text-sm text-muted-foreground">
          {order.statusHistory.map((h) => (
            <li key={h.createdAt + h.toStatus}>
              {formatDateTime(h.createdAt, timeZone, locale, formatOptions)} ·{' '}
              {t(`orders:status.${h.toStatus}`)}
              {h.reason ? ` — ${h.reason}` : ''}
            </li>
          ))}
        </ol>
      </div>
      <footer className="grid gap-2 border-t p-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          {canPay ? (
            <Button
              size="touch"
              onClick={() => {
                setDialog('pay');
              }}
            >
              {t('payments:takePayment')}
            </Button>
          ) : null}
          {canComplete ? (
            <Button
              size="touch"
              disabled={transition.isPending}
              onClick={() => void run({ to: 'COMPLETED' })}
            >
              {t('payments:complete')}
            </Button>
          ) : null}
          {order.status !== 'DRAFT' ? (
            <Button
              size="touch"
              variant="outline"
              onClick={() => {
                setDialog('receipt');
              }}
            >
              {t('payments:printReceipt')}
            </Button>
          ) : null}
          {canConfirm ? (
            <Button
              size="touch"
              disabled={transition.isPending}
              onClick={() => void run({ to: 'CONFIRMED' })}
            >
              {t('orders:actions.confirm')}
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              size="touch"
              variant="outline"
              onClick={() => {
                loadOrder(order);
                void navigate('/order');
              }}
            >
              {t('orders:actions.edit')}
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              size="touch"
              variant="destructive"
              className="ms-auto"
              onClick={() => {
                setCancelling(true);
              }}
            >
              {t('orders:actions.cancelOrder')}
            </Button>
          ) : null}
        </div>
      </footer>
      <OrderPaymentDialogs order={order} dialog={dialog} setDialog={setDialog} />
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        {cancelling ? (
          <CancelOrderDialog
            orderNumber={order.orderNumber}
            pending={transition.isPending}
            onConfirm={(reason) => void run({ to: 'CANCELLED', reason })}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

/** Open orders of this location, newest first, with details and allowed actions. */
export function OrdersPage() {
  const { t } = useTranslation(['pos', 'orders']);
  const locationId = useLocationId();
  const locations = useLocations();
  const timeZone = locations.data?.find((l) => l.id === locationId)?.timezone ?? 'UTC';
  const orders = useOrders(locationId, { open: true });
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('order');
  const { format } = useMoneyFormat(orders.data?.[0]?.currencyCode ?? null);

  return (
    <QueryState
      query={orders}
      isEmpty={(rows) => rows.length === 0}
      empty={{ title: t('orders:empty'), description: t('orders:emptyHint') }}
    >
      {(rows) => {
        const selected = rows.find((o) => o.id === selectedId) ?? rows[0];
        return (
          <div className="grid h-full min-h-0 grid-cols-[minmax(18rem,26rem)_1fr] gap-3">
            <ul
              className="grid min-h-0 auto-rows-min gap-2 overflow-y-auto"
              aria-label={t('pos:orders.open')}
            >
              {rows.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    aria-current={o.id === selected?.id}
                    onClick={() => {
                      setParams({ order: o.id });
                    }}
                    className={cn(
                      'grid w-full gap-1 rounded-xl border-2 bg-card p-3 text-start',
                      o.id === selected?.id
                        ? 'border-primary'
                        : 'border-transparent hover:border-border',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="ltr-nums text-lg font-bold">{o.orderNumber}</span>
                      <OrderStatusBadge status={o.status} />
                    </span>
                    <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span>
                        {t(`orders:channel.${o.channel}`)}
                        {o.tableLabel ? ` · ${o.tableLabel}` : ''} ·{' '}
                        {t('orders:items', { count: o.items.length })}
                      </span>
                      <span className="whitespace-nowrap font-medium text-foreground">
                        {format(o.total)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <OrderDetail key={selected.id} order={selected} timeZone={timeZone} />
            ) : (
              <EmptyState title={t('pos:orders.select')} />
            )}
          </div>
        );
      }}
    </QueryState>
  );
}
