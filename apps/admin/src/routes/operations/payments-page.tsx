import { QueryState, useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { PaymentMethodType, PaymentTransactionType, enumValues } from '@pos/shared-types';
import type { PaymentListItem } from '@pos/validation';
import {
  Button,
  Card,
  Dialog,
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
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Pagination } from '../../components/pagination';
import { RefundDialog } from '../../components/refund-dialog';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { keys, useTenant, useTenantId } from '../../lib/queries';

const PAGE_SIZE = 25;

export function PaymentsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const tenant = useTenant();
  const { format } = useMoneyFormat(tenant.data?.currencyCode ?? null);
  const formatDate = useDateTime();
  const { list, name } = useLocationLookup();
  const { canAt } = usePermissions();
  const [filters, setFilters] = useState({
    locationId: '',
    from: '',
    to: '',
    type: '',
    methodType: '',
  });
  const [page, setPage] = useState(1);
  const [refunding, setRefunding] = useState<PaymentListItem | null>(null);
  const query = {
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.type ? { type: filters.type as PaymentListItem['type'] } : {}),
    ...(filters.methodType
      ? { methodType: filters.methodType as PaymentListItem['methodType'] }
      : {}),
    page,
    pageSize: PAGE_SIZE,
  };
  const payments = useQuery({
    queryKey: keys.payments(tid, query),
    queryFn: () => api.admin.payments(tid, query),
    placeholderData: keepPreviousData,
  });
  const set = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t('admin:payments.title')} description={t('admin:payments.description')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
        <Field label={t('admin:payments.kind')}>
          <NativeSelect
            value={filters.type}
            onChange={(e) => {
              set({ type: e.target.value });
            }}
          >
            <option value="">{t('admin:shared.any')}</option>
            {enumValues(PaymentTransactionType).map((type) => (
              <option key={type} value={type}>
                {t(`admin:payments.kinds.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('admin:payments.method')}>
          <NativeSelect
            value={filters.methodType}
            onChange={(e) => {
              set({ methodType: e.target.value });
            }}
          >
            <option value="">{t('admin:shared.any')}</option>
            {enumValues(PaymentMethodType).map((type) => (
              <option key={type} value={type}>
                {t(`admin:paymentMethods.types.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <QueryState
        query={payments}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: t('admin:payments.empty') }}
      >
        {(data) => (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin:payments.when')}</TableHead>
                    <TableHead>{t('admin:payments.order')}</TableHead>
                    <TableHead>{t('admin:shared.location')}</TableHead>
                    <TableHead>{t('admin:payments.kind')}</TableHead>
                    <TableHead>{t('admin:payments.method')}</TableHead>
                    <TableHead>{t('admin:shared.status')}</TableHead>
                    <TableHead className="text-end">{t('admin:payments.amount')}</TableHead>
                    <TableHead className="text-end">{t('admin:payments.refundable')}</TableHead>
                    <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{formatDate(p.createdAt, p.locationId)}</TableCell>
                      <TableCell>
                        <Link
                          className="ltr-nums hover:underline"
                          to={`/operations/orders/${p.locationId}/${p.orderId}`}
                        >
                          {p.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{name(p.locationId)}</TableCell>
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
                      <TableCell className="ltr-nums text-end">
                        {p.type === 'CHARGE' ? format(p.refundable) : ''}
                      </TableCell>
                      <TableCell className="text-end">
                        {p.methodType === 'ONLINE' &&
                        p.refundable > 0 &&
                        canAt(p.locationId, 'payments.refund') ? (
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
                  ))}
                </TableBody>
              </Table>
            </Card>
            <p className="mt-2 text-xs text-muted-foreground">{t('admin:payments.atTill')}</p>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={setPage}
            />
          </>
        )}
      </QueryState>
      <Dialog
        open={refunding !== null}
        onOpenChange={(open) => {
          if (!open) setRefunding(null);
        }}
      >
        {refunding ? (
          <RefundDialog
            locationId={refunding.locationId}
            paymentId={refunding.id}
            orderNumber={refunding.orderNumber}
            refundable={refunding.refundable}
            currency={refunding.currencyCode}
            onClose={() => {
              setRefunding(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
