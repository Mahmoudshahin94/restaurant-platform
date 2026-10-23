import { QueryState, useMoneyFormat } from '@pos/app-kit';
import { OrderChannel, OrderStatus, PaymentStatus, enumValues } from '@pos/shared-types';
import {
  Button,
  Card,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { OrderStatusBadge, PaymentStatusBadge } from '../../components/order-badges';
import { Pagination } from '../../components/pagination';
import { api } from '../../lib/api';
import { useLocationLookup } from '../../lib/format';
import { keys, useTenant, useTenantId } from '../../lib/queries';

interface Filters {
  locationId: string;
  from: string;
  to: string;
  status: string;
  channel: string;
  paymentStatus: string;
  search: string;
}
const EMPTY: Filters = {
  locationId: '',
  from: '',
  to: '',
  status: '',
  channel: '',
  paymentStatus: '',
  search: '',
};
const PAGE_SIZE = 25;

export function OrdersPage() {
  const { t } = useTranslation(['admin', 'orders', 'common']);
  const tid = useTenantId();
  const tenant = useTenant();
  const { format } = useMoneyFormat(tenant.data?.currencyCode ?? null);
  const { list, name } = useLocationLookup();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const query = {
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.status ? { status: [filters.status] } : {}),
    ...(filters.channel ? { channel: [filters.channel] } : {}),
    ...(filters.paymentStatus ? { paymentStatus: [filters.paymentStatus] } : {}),
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    page,
    pageSize: PAGE_SIZE,
  };
  const orders = useQuery({
    queryKey: keys.orders(tid, query),
    queryFn: () => api.admin.orders(tid, query),
    placeholderData: keepPreviousData,
  });
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t('admin:orders.title')} description={t('admin:orders.description')} />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('admin:shared.search')}>
            <Input
              type="search"
              placeholder={t('admin:orders.searchPlaceholder')}
              value={filters.search}
              onChange={(e) => {
                set({ search: e.target.value });
              }}
            />
          </Field>
          <Field label={t('admin:shared.location')}>
            <NativeSelect
              value={filters.locationId}
              onChange={(e) => {
                set({ locationId: e.target.value });
              }}
            >
              <option value="">{t('admin:shared.allLocations')}</option>
              {list.map((l) => (
                <option key={l.id} value={l.id}>
                  {name(l.id)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:shared.from')}>
            <Input
              type="date"
              dir="ltr"
              value={filters.from}
              onChange={(e) => {
                set({ from: e.target.value });
              }}
            />
          </Field>
          <Field label={t('admin:shared.to')}>
            <Input
              type="date"
              dir="ltr"
              value={filters.to}
              onChange={(e) => {
                set({ to: e.target.value });
              }}
            />
          </Field>
          <Field label={t('orders:fields.status')}>
            <NativeSelect
              value={filters.status}
              onChange={(e) => {
                set({ status: e.target.value });
              }}
            >
              <option value="">{t('admin:shared.any')}</option>
              {enumValues(OrderStatus).map((s) => (
                <option key={s} value={s}>
                  {t(`orders:status.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('orders:fields.channel')}>
            <NativeSelect
              value={filters.channel}
              onChange={(e) => {
                set({ channel: e.target.value });
              }}
            >
              <option value="">{t('admin:shared.any')}</option>
              {enumValues(OrderChannel).map((c) => (
                <option key={c} value={c}>
                  {t(`orders:channel.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:orders.payment')}>
            <NativeSelect
              value={filters.paymentStatus}
              onChange={(e) => {
                set({ paymentStatus: e.target.value });
              }}
            >
              <option value="">{t('admin:shared.any')}</option>
              {enumValues(PaymentStatus).map((p) => (
                <option key={p} value={p}>
                  {t(`orders:payment.${p}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={() => {
                set(EMPTY);
              }}
            >
              {t('admin:shared.clear')}
            </Button>
          </div>
        </div>
      </Card>
      <QueryState
        query={orders}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: t('admin:orders.empty'), description: t('admin:orders.emptyHint') }}
      >
        {(data) => (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin:orders.number')}</TableHead>
                    <TableHead>{t('admin:orders.date')}</TableHead>
                    <TableHead>{t('admin:shared.location')}</TableHead>
                    <TableHead>{t('orders:fields.channel')}</TableHead>
                    <TableHead>{t('admin:orders.customer')}</TableHead>
                    <TableHead>{t('orders:fields.status')}</TableHead>
                    <TableHead>{t('admin:orders.payment')}</TableHead>
                    <TableHead className="text-end">{t('orders:totals.total')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">
                        <Link
                          className="ltr-nums underline-offset-2 hover:underline"
                          to={`/operations/orders/${o.locationId}/${o.id}`}
                        >
                          {o.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="ltr-nums">{o.businessDate}</TableCell>
                      <TableCell>{name(o.locationId)}</TableCell>
                      <TableCell>{t(`orders:channel.${o.channel}`)}</TableCell>
                      <TableCell>
                        {o.customerName ?? ''}
                        {o.customerPhone ? (
                          <span className="ltr-nums block text-xs text-muted-foreground" dir="ltr">
                            {o.customerPhone}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </TableCell>
                      <TableCell className="ltr-nums text-end">{format(o.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={setPage}
            />
          </>
        )}
      </QueryState>
    </>
  );
}
