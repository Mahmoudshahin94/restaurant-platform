import { QueryState } from '@pos/app-kit';
import { businessDateFor } from '@pos/domain';
import { OrderChannel, enumValues } from '@pos/shared-types';
import {
  type ChannelReport,
  type DailySalesReport,
  type PrepTimeReport,
  REPORT_KINDS,
  type ReportKind,
  type ReportQuery,
} from '@pos/validation';
import { Alert, Field, NativeSelect, PageHeader, cn } from '@pos/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, useLocation, useParams } from 'react-router';
import { api } from '../../lib/api';
import { useLocationLookup } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { keys, useTenant, useTenantId } from '../../lib/queries';
import {
  CategoriesView,
  ChannelsView,
  DailySalesView,
  DiscountsView,
  PaymentsView,
  PrepTimesView,
  ProductsView,
  ShiftsView,
  TaxesView,
} from './report-views';
import { PeriodFields, periodRange, useReportFilters } from './report-filters';

export { periodRange };

/** Shifts belong to drawers, not channels. */
const WITHOUT_CHANNELS: readonly ReportKind[] = ['shifts'];

function isKind(value: string | undefined): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value ?? '');
}

/** `/reports` opens the first report, keeping any filters in the query string. */
export function ReportsIndex() {
  const { search } = useLocation();
  return <Navigate to={`/reports/daily-sales${search}`} replace />;
}

export function ReportsPage() {
  const { t } = useTranslation(['admin', 'orders']);
  const { kind } = useParams();
  const { search } = useLocation();
  const tenant = useTenant();
  const { list, name } = useLocationLookup();
  const { canAt } = usePermissions();

  const today = businessDateFor(new Date(), tenant.data?.timezone ?? 'UTC');
  const { params, from, to, period, rangeError, set } = useReportFilters(today);
  const locationId = params.get('location') ?? '';
  const channel = params.get('channel') ?? '';

  const reportable = list.filter((l) => canAt(l.id, 'reports.view'));

  if (!isKind(kind)) return <Navigate to={`/reports/daily-sales${search}`} replace />;
  const usesChannels = !WITHOUT_CHANNELS.includes(kind);
  const query: ReportQuery = {
    from,
    to,
    ...(locationId ? { locationIds: [locationId] } : {}),
    ...(channel && usesChannels ? { channels: [channel as OrderChannel] } : {}),
  };

  return (
    <>
      <PageHeader title={t('admin:reports.title')} description={t('admin:reports.description')} />
      <nav aria-label={t('admin:reports.picker')} className="mb-4 flex flex-wrap gap-1">
        {REPORT_KINDS.map((k) => (
          <NavLink
            key={k}
            to={`/reports/${k}${search}`}
            className={({ isActive }) =>
              cn(
                'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted',
              )
            }
          >
            {t(`admin:reports.kinds.${k}`)}
          </NavLink>
        ))}
      </nav>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <PeriodFields from={from} to={to} period={period} today={today} set={set} />
        <Field label={t('admin:reports.filters.location')}>
          <NativeSelect
            value={locationId}
            onChange={(e) => {
              set({ location: e.target.value });
            }}
          >
            <option value="">{t('admin:reports.filters.allLocations')}</option>
            {reportable.map((l) => (
              <option key={l.id} value={l.id}>
                {name(l.id)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {usesChannels ? (
          <Field label={t('admin:reports.filters.channel')}>
            <NativeSelect
              value={channel}
              onChange={(e) => {
                set({ channel: e.target.value });
              }}
            >
              <option value="">{t('admin:reports.filters.allChannels')}</option>
              {enumValues(OrderChannel).map((c) => (
                <option key={c} value={c}>
                  {t(`orders:channel.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      {rangeError ? (
        <Alert variant="destructive" title={rangeError} />
      ) : (
        // Keyed by report so a previous report's data is never shown as another kind.
        <ReportContent key={kind} kind={kind} query={query} ready={tenant.isSuccess} />
      )}
    </>
  );
}

function hasData(kind: ReportKind, data: unknown): boolean {
  switch (kind) {
    case 'daily-sales':
    case 'channels': {
      const totals = (data as DailySalesReport | ChannelReport).totals;
      return totals.orders + totals.refunds.count + totals.cancelledOrders > 0;
    }
    case 'prep-times':
      return (data as PrepTimeReport).totals.tickets > 0;
    default:
      return (data as { rows: unknown[] }).rows.length > 0;
  }
}

function ReportContent({
  kind,
  query,
  ready,
}: {
  kind: ReportKind;
  query: ReportQuery;
  ready: boolean;
}) {
  const { t } = useTranslation('admin');
  const tid = useTenantId();
  const fetchers = useMemo(
    () =>
      ({
        'daily-sales': api.admin.reports.dailySales,
        channels: api.admin.reports.channels,
        payments: api.admin.reports.payments,
        products: api.admin.reports.products,
        categories: api.admin.reports.categories,
        taxes: api.admin.reports.taxes,
        discounts: api.admin.reports.discounts,
        shifts: api.admin.reports.shifts,
        'prep-times': api.admin.reports.prepTimes,
      }) satisfies Record<ReportKind, (tid: string, q: ReportQuery) => Promise<unknown>>,
    [],
  );
  const report = useQuery({
    queryKey: keys.report(tid, kind, query),
    queryFn: (): Promise<unknown> => fetchers[kind](tid, query),
    placeholderData: keepPreviousData,
    enabled: ready,
  });
  return (
    <QueryState
      query={report}
      isEmpty={(data) => !hasData(kind, data)}
      empty={{ title: t('reports.empty'), description: t('reports.emptyHint') }}
    >
      {(data) => renderReport(kind, data)}
    </QueryState>
  );
}

function renderReport(kind: ReportKind, data: unknown): ReactNode {
  switch (kind) {
    case 'daily-sales':
      return <DailySalesView data={data as DailySalesReport} />;
    case 'channels':
      return <ChannelsView data={data as ChannelReport} />;
    case 'payments':
      return <PaymentsView data={data as Parameters<typeof PaymentsView>[0]['data']} />;
    case 'products':
      return <ProductsView data={data as Parameters<typeof ProductsView>[0]['data']} />;
    case 'categories':
      return <CategoriesView data={data as Parameters<typeof CategoriesView>[0]['data']} />;
    case 'taxes':
      return <TaxesView data={data as Parameters<typeof TaxesView>[0]['data']} />;
    case 'discounts':
      return <DiscountsView data={data as Parameters<typeof DiscountsView>[0]['data']} />;
    case 'shifts':
      return <ShiftsView data={data as Parameters<typeof ShiftsView>[0]['data']} />;
    case 'prep-times':
      return <PrepTimesView data={data as PrepTimeReport} />;
  }
}
