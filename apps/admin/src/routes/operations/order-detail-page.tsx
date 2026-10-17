import { QueryState, useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { Order, OrderPayment } from '@pos/validation';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { OrderStatusBadge, PaymentStatusBadge } from '../../components/order-badges';
import { RefundDialog } from '../../components/refund-dialog';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { keys } from '../../lib/queries';

/** What is left to refund of a charge (captured refunds of it subtracted). */
function refundableOf(order: Order, charge: OrderPayment): number {
  if (charge.type !== 'CHARGE' || charge.status !== 'CAPTURED') return 0;
  const refunded = order.payments
    .filter((p) => p.refundOfId === charge.id && p.status === 'CAPTURED')
    .reduce((sum, p) => sum + p.amount, 0);
  return charge.amount - refunded;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end">{value}</span>
    </div>
  );
}

function OrderDetail({ order }: { order: Order }) {
  const { t } = useTranslation(['admin', 'orders', 'payments', 'common']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(order.currencyCode);
  const formatDate = useDateTime();
  const { name } = useLocationLookup();
  const { canAt } = usePermissions();
  const [refunding, setRefunding] = useState<OrderPayment | null>(null);
  const at = (iso: string | null) => formatDate(iso, order.locationId);
  const canRefund = canAt(order.locationId, 'payments.refund');

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.paymentStatus} />
        <Badge variant="outline">{t(`orders:channel.${order.channel}`)}</Badge>
        {order.fulfillmentType ? (
          <Badge variant="outline">
            {order.fulfillmentType === 'DELIVERY'
              ? t('admin:online.delivery')
              : t('admin:online.pickup')}
          </Badge>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('admin:orders.detail.items')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:orders.items')}</TableHead>
                  <TableHead className="w-20">{t('orders:fields.quantity')}</TableHead>
                  <TableHead className="text-end">{t('orders:totals.total')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">
                        {pickLocalized(item, 'name', locale)}
                        {item.variantNameEn
                          ? ` · ${locale === 'ar' ? (item.variantNameAr ?? item.variantNameEn) : item.variantNameEn}`
                          : ''}
                      </div>
                      {item.modifiers.length > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {item.modifiers
                            .map((m) => pickLocalized(m, 'name', locale))
                            .join(locale === 'ar' ? '، ' : ', ')}
                        </div>
                      ) : null}
                      {item.notes ? <div className="text-xs italic">{item.notes}</div> : null}
                    </TableCell>
                    <TableCell className="ltr-nums">{item.quantity}</TableCell>
                    <TableCell className="ltr-nums text-end">{format(item.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 grid gap-0.5 border-t pt-3">
              <Row
                label={t('orders:totals.subtotal')}
                value={<span className="ltr-nums">{format(order.subtotal)}</span>}
              />
              {order.discountTotal > 0 ? (
                <Row
                  label={t('orders:totals.discount')}
                  value={<span className="ltr-nums">{format(-order.discountTotal)}</span>}
                />
              ) : null}
              <Row
                label={order.taxInclusive ? t('orders:totals.taxIncluded') : t('orders:totals.tax')}
                value={<span className="ltr-nums">{format(order.taxTotal)}</span>}
              />
              {order.feeTotal > 0 ? (
                <Row
                  label={t('orders:totals.fees')}
                  value={<span className="ltr-nums">{format(order.feeTotal)}</span>}
                />
              ) : null}
              <Row
                label={t('orders:totals.total')}
                value={<span className="ltr-nums font-semibold">{format(order.total)}</span>}
              />
              <Row
                label={t('payments:paid')}
                value={<span className="ltr-nums">{format(order.paidTotal)}</span>}
              />
              <Row
                label={t('payments:balanceDue')}
                value={<span className="ltr-nums">{format(order.balanceDue)}</span>}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:orders.detail.summary')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-0.5">
            <Row label={t('admin:shared.location')} value={name(order.locationId)} />
            <Row
              label={t('admin:orders.date')}
              value={<span className="ltr-nums">{order.businessDate}</span>}
            />
            <Row
              label={t('admin:orders.detail.placed')}
              value={at(order.placedAt ?? order.createdAt)}
            />
            <Row
              label={t('admin:orders.detail.source')}
              value={t(`admin:sources.${order.source}`)}
            />
            {order.tableLabel ? (
              <Row label={t('orders:fields.table')} value={order.tableLabel} />
            ) : null}
            {order.customerName ? (
              <Row label={t('orders:fields.customerName')} value={order.customerName} />
            ) : null}
            {order.customerPhone ? (
              <Row
                label={t('orders:fields.customerPhone')}
                value={<span dir="ltr">{order.customerPhone}</span>}
              />
            ) : null}
            {order.deliveryAddress ? (
              <Row
                label={t('admin:orders.detail.delivery')}
                value={[
                  order.deliveryAddress.line1,
                  order.deliveryAddress.line2,
                  order.deliveryAddress.city,
                ]
                  .filter(Boolean)
                  .join(locale === 'ar' ? '، ' : ', ')}
              />
            ) : null}
            {order.notes ? <Row label={t('orders:fields.notes')} value={order.notes} /> : null}
            {order.cancelReason ? (
              <Row label={t('orders:status.CANCELLED')} value={order.cancelReason} />
            ) : null}
            <Row
              label={t('admin:orders.detail.version')}
              value={<span className="ltr-nums">{order.version}</span>}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin:orders.detail.payments')}</CardTitle>
        </CardHeader>
        <CardContent>
          {order.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin:orders.detail.noPayments')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:payments.when')}</TableHead>
                  <TableHead>{t('admin:payments.kind')}</TableHead>
                  <TableHead>{t('admin:payments.method')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead className="text-end">{t('admin:payments.amount')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.payments.map((p) => {
                  const refundable = refundableOf(order, p);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{at(p.createdAt)}</TableCell>
                      <TableCell>
                        {t(`admin:payments.kinds.${p.type}`)}
                        {p.reason ? (
                          <div className="text-xs text-muted-foreground">{p.reason}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{locale === 'ar' ? p.methodNameAr : p.methodNameEn}</TableCell>
                      <TableCell>{t(`admin:payments.statuses.${p.status}`)}</TableCell>
                      <TableCell className="ltr-nums text-end">
                        {format(p.type === 'REFUND' ? -p.amount : p.amount)}
                      </TableCell>
                      <TableCell className="text-end">
                        {canRefund && p.methodType === 'ONLINE' && refundable > 0 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRefunding(p);
                            }}
                          >
                            <Undo2 aria-hidden />
                            {t('admin:payments.refund')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {canRefund &&
          order.payments.some((p) => p.methodType !== 'ONLINE' && refundableOf(order, p) > 0) ? (
            <p className="mt-3 text-xs text-muted-foreground">{t('admin:payments.atTill')}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:orders.detail.history')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2">
              {order.statusHistory.map((h, i) => (
                <li
                  key={`${h.createdAt}:${String(i)}`}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="text-muted-foreground">{at(h.createdAt)}</span>
                  <OrderStatusBadge status={h.toStatus} />
                  <span className="text-xs text-muted-foreground">
                    {t(`admin:sources.${h.source}`)}
                  </span>
                  {h.reason ? (
                    <span className="text-xs">
                      {t('admin:orders.detail.reason', { reason: h.reason })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('admin:orders.detail.tickets')}</CardTitle>
          </CardHeader>
          <CardContent>
            {order.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin:orders.detail.noTickets')}</p>
            ) : (
              <ul className="grid gap-2">
                {order.tickets.map((ticket) => (
                  <li key={ticket.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{locale === 'ar' ? ticket.stationNameAr : ticket.stationNameEn}</span>
                    <span className="flex gap-1">
                      {ticket.priority === 'RUSH' ? (
                        <Badge variant="warning">{t('orders:kitchen.rushed')}</Badge>
                      ) : null}
                      <Badge variant="outline">{t(`orders:kitchen.ticket.${ticket.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={refunding !== null}
        onOpenChange={(open) => {
          if (!open) setRefunding(null);
        }}
      >
        {refunding ? (
          <RefundDialog
            locationId={order.locationId}
            paymentId={refunding.id}
            orderNumber={order.orderNumber}
            refundable={refundableOf(order, refunding)}
            currency={order.currencyCode}
            onClose={() => {
              setRefunding(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

export function OrderDetailPage() {
  const { t } = useTranslation('admin');
  const { locationId = '', orderId = '' } = useParams();
  const query = useQuery({
    queryKey: keys.order(locationId, orderId),
    queryFn: () => api.orders.get(locationId, orderId),
  });
  return (
    <>
      <div className="mb-2">
        <Link
          to="/operations/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t('orders.detail.back')}
        </Link>
      </div>
      <PageHeader
        title={t('orders.detail.title', {
          number: query.data?.orderNumber ?? '',
        })}
      />
      <QueryState query={query}>{(order) => <OrderDetail order={order} />}</QueryState>
    </>
  );
}
