import { QueryState, useMoneyFormat } from '@pos/app-kit';
import type { OrderSummary } from '@pos/validation';
import {
  Card,
  CardContent,
  Field,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { OrderStatusBadge, PaymentStatusBadge } from '../../components/order-badges';
import { Pagination } from '../../components/pagination';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { keys, useTenantId } from '../../lib/queries';

const PAGE_SIZE = 25;

function useCurrencyFormat() {
  return useMoneyFormat().format;
}

export function CustomersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const format = useCurrencyFormat();
  const formatDate = useDateTime();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = {
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
    pageSize: PAGE_SIZE,
  };
  const customers = useQuery({
    queryKey: keys.customers(tid, query),
    queryFn: () => api.admin.customers(tid, query),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title={t('admin:customers.title')}
        description={t('admin:customers.description')}
      />
      <div className="mb-4 max-w-sm">
        <Field label={t('admin:shared.search')}>
          <Input
            type="search"
            placeholder={t('admin:customers.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      <QueryState
        query={customers}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: t('admin:customers.empty'), description: t('admin:customers.emptyHint') }}
      >
        {(data) => (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin:customers.name')}</TableHead>
                    <TableHead>{t('admin:customers.phone')}</TableHead>
                    <TableHead>{t('admin:customers.orders')}</TableHead>
                    <TableHead>{t('admin:customers.spent')}</TableHead>
                    <TableHead>{t('admin:customers.last')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.key}>
                      <TableCell className="font-medium">
                        <Link className="hover:underline" to={`/operations/customers/${c.key}`}>
                          {c.name ?? c.phone}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span dir="ltr" className="ltr-nums">
                          {c.phone}
                        </span>
                      </TableCell>
                      <TableCell className="ltr-nums">{c.orderCount}</TableCell>
                      <TableCell className="ltr-nums">{format(c.totalSpent)}</TableCell>
                      <TableCell>{formatDate(c.lastOrderAt)}</TableCell>
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

export function OrderSummaryTable({ orders }: { orders: OrderSummary[] }) {
  const { t } = useTranslation(['admin', 'orders']);
  const format = useCurrencyFormat();
  const { name } = useLocationLookup();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('admin:orders.number')}</TableHead>
          <TableHead>{t('admin:orders.date')}</TableHead>
          <TableHead>{t('admin:shared.location')}</TableHead>
          <TableHead>{t('orders:fields.status')}</TableHead>
          <TableHead>{t('admin:orders.payment')}</TableHead>
          <TableHead className="text-end">{t('orders:totals.total')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell>
              <Link
                className="ltr-nums hover:underline"
                to={`/operations/orders/${o.locationId}/${o.id}`}
              >
                {o.orderNumber}
              </Link>
            </TableCell>
            <TableCell className="ltr-nums">{o.businessDate}</TableCell>
            <TableCell>{name(o.locationId)}</TableCell>
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
  );
}

export function CustomerDetailPage() {
  const { t } = useTranslation('admin');
  const tid = useTenantId();
  const format = useCurrencyFormat();
  const formatDate = useDateTime();
  const { key = '' } = useParams();
  const query = useQuery({
    queryKey: keys.customer(tid, key),
    queryFn: () => api.admin.customer(tid, key),
  });
  return (
    <>
      <div className="mb-2">
        <Link
          to="/operations/customers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t('customers.back')}
        </Link>
      </div>
      <PageHeader title={query.data?.customer.name ?? t('customers.detailTitle')} />
      <QueryState query={query}>
        {({ customer, orders }) => (
          <div className="grid gap-6">
            <Card>
              <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">{t('customers.phone')}</div>
                  <div dir="ltr" className="ltr-nums text-start">
                    {customer.phone}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('customers.email')}</div>
                  <div dir="ltr" className="text-start">
                    {customer.email ?? ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('customers.spent')}</div>
                  <div className="ltr-nums">{format(customer.totalSpent)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('customers.orders')}</div>
                  <div className="ltr-nums">{customer.orderCount}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('customers.first')}</div>
                  <div>{formatDate(customer.firstOrderAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t('customers.last')}</div>
                  <div>{formatDate(customer.lastOrderAt)}</div>
                </div>
              </CardContent>
            </Card>
            <Card className="overflow-x-auto">
              <OrderSummaryTable orders={orders} />
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}
