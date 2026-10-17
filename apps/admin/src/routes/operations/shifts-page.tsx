import { QueryState, useCurrentLocale } from '@pos/app-kit';
import type { Shift } from '@pos/validation';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  NativeSelect,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LocationRequired } from '../../components/location-required';
import { api } from '../../lib/api';
import { useDateTime } from '../../lib/format';
import { useMoney } from '../../lib/money';
import { keys } from '../../lib/queries';

function Difference({ value }: { value: number | null }) {
  const { t } = useTranslation('admin');
  const { format } = useMoney();
  if (value === null) return null;
  const label = value < 0 ? t('shifts.short') : value > 0 ? t('shifts.over') : t('shifts.even');
  return (
    <span className="inline-flex items-center gap-1">
      <span className="ltr-nums">{format(value, { sign: 'exceptZero' })}</span>
      <Badge variant={value < 0 ? 'destructive' : value > 0 ? 'warning' : 'success'}>{label}</Badge>
    </span>
  );
}

function ShiftList({ locationId }: { locationId: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const { format } = useMoney();
  const formatDate = useDateTime();
  const [status, setStatus] = useState<'' | 'OPEN' | 'CLOSED'>('');
  const shifts = useQuery({
    queryKey: keys.shifts(locationId, status),
    queryFn: () => api.shifts.list(locationId, status || undefined),
  });
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Field label={t('admin:shifts.filter')}>
          <NativeSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
            }}
          >
            <option value="">{t('admin:shifts.all')}</option>
            <option value="OPEN">{t('admin:shifts.statuses.OPEN')}</option>
            <option value="CLOSED">{t('admin:shifts.statuses.CLOSED')}</option>
          </NativeSelect>
        </Field>
      </div>
      <QueryState
        query={shifts}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:shifts.empty') }}
      >
        {(rows) => (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:shifts.register')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead>{t('admin:shifts.opened')}</TableHead>
                  <TableHead>{t('admin:shifts.closed')}</TableHead>
                  <TableHead className="text-end">{t('admin:shifts.expected')}</TableHead>
                  <TableHead className="text-end">{t('admin:shifts.counted')}</TableHead>
                  <TableHead>{t('admin:shifts.difference')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <Link
                        className="hover:underline"
                        to={`/operations/shifts/${locationId}/${s.id}`}
                      >
                        {locale === 'ar' ? s.cashRegisterNameAr : s.cashRegisterNameEn}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'OPEN' ? 'warning' : 'secondary'}>
                        {t(`admin:shifts.statuses.${s.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDate(s.openedAt, locationId)}
                      <div className="text-xs text-muted-foreground">{s.openedByName}</div>
                    </TableCell>
                    <TableCell>{formatDate(s.closedAt, locationId)}</TableCell>
                    <TableCell className="ltr-nums text-end">
                      {format(s.expectedCash ?? s.summary.cash.expectedCash)}
                    </TableCell>
                    <TableCell className="ltr-nums text-end">
                      {s.countedCash === null ? '' : format(s.countedCash)}
                    </TableCell>
                    <TableCell>
                      <Difference value={s.cashDifference} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </QueryState>
    </>
  );
}

export function ShiftsPage() {
  const { t } = useTranslation('admin');
  return (
    <>
      <PageHeader title={t('shifts.title')} description={t('shifts.description')} />
      <LocationRequired>
        {(locationId) => <ShiftList key={locationId} locationId={locationId} />}
      </LocationRequired>
    </>
  );
}

function ShiftDetail({ shift }: { shift: Shift }) {
  const { t } = useTranslation(['admin', 'payments']);
  const locale = useCurrentLocale();
  const { format } = useMoney();
  const formatDate = useDateTime();
  const cash = shift.summary.cash;
  const line = (label: string, value: number) => (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="ltr-nums">{format(value)}</span>
    </div>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:shifts.cash')}</CardTitle>
        </CardHeader>
        <CardContent>
          {line(t('admin:shifts.openingFloat'), cash.openingFloat)}
          {line(t('payments:shift.cashSales'), cash.cashSales)}
          {line(t('payments:shift.cashRefunds'), -cash.cashRefunds)}
          {line(t('payments:shift.payIns'), cash.payIns)}
          {line(t('payments:shift.payOuts'), -cash.payOuts)}
          {line(t('admin:shifts.expected'), shift.expectedCash ?? cash.expectedCash)}
          {shift.countedCash !== null ? line(t('admin:shifts.counted'), shift.countedCash) : null}
          {shift.cashDifference !== null ? (
            <div className="flex justify-between gap-4 py-1 text-sm">
              <span className="text-muted-foreground">{t('admin:shifts.difference')}</span>
              <Difference value={shift.cashDifference} />
            </div>
          ) : null}
          {shift.closingNotes ? (
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">{t('admin:shifts.notes')}: </span>
              {shift.closingNotes}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:shifts.byMethod')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shift.summary.byMethod.map((m) => (
            <div key={m.paymentMethodId} className="flex justify-between gap-4 py-1 text-sm">
              <span>{locale === 'ar' ? m.nameAr : m.nameEn}</span>
              <span className="ltr-nums">{format(m.net)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between gap-4 border-t pt-2 text-sm">
            <span className="text-muted-foreground">{t('admin:shifts.orders')}</span>
            <span className="ltr-nums">{shift.summary.orderCount}</span>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('admin:shifts.movements')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shift.cashTransactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin:shifts.noMovements')}</p>
          ) : (
            <Table>
              <TableBody>
                {shift.cashTransactions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{formatDate(c.createdAt, shift.locationId)}</TableCell>
                    <TableCell>{t(`admin:shifts.movementTypes.${c.type}`)}</TableCell>
                    <TableCell>{c.reason ?? ''}</TableCell>
                    <TableCell className="ltr-nums text-end">
                      {format(c.type === 'REFUND' || c.type === 'PAY_OUT' ? -c.amount : c.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ShiftDetailPage() {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const formatDate = useDateTime();
  const { locationId = '', shiftId = '' } = useParams();
  const query = useQuery({
    queryKey: keys.shift(locationId, shiftId),
    queryFn: () => api.shifts.get(locationId, shiftId),
  });
  const shift = query.data;
  return (
    <>
      <div className="mb-2">
        <Link
          to="/operations/shifts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t('shifts.back')}
        </Link>
      </div>
      <PageHeader
        title={
          shift
            ? `${locale === 'ar' ? shift.cashRegisterNameAr : shift.cashRegisterNameEn} · ${formatDate(shift.openedAt, locationId)}`
            : t('shifts.detailTitle')
        }
        description={
          shift ? `${t(`shifts.statuses.${shift.status}`)} · ${shift.openedByName}` : undefined
        }
      />
      <QueryState query={query}>{(data) => <ShiftDetail shift={data} />}</QueryState>
    </>
  );
}
