import { QueryState, useCurrentLocale, useFormatOptions, useMoneyFormat } from '@pos/app-kit';
import { formatMinorAsDecimal, parseDecimalToMinor } from '@pos/domain';
import { formatBps, formatBusinessDate, formatNumber, pickLocalized } from '@pos/i18n';
import type { OrgDashboard, OrganizationOverview } from '@pos/validation';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  PageHeader,
  StatCard,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Chart } from '../../components/chart';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { useOrganizationOverview } from './org-queries';

interface BrandRow {
  tenantId: string;
  name: string;
  salesTotal: number;
  orderCount: number;
}

interface BranchRow extends BrandRow {
  locationId: string;
  brand: string;
  hubOnline: boolean;
}

const average = (sales: number, orders: number) => (orders > 0 ? Math.round(sales / orders) : 0);

function DashboardBody({
  overview,
  dashboard,
}: {
  overview: OrganizationOverview;
  dashboard: OrgDashboard;
}) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const { format } = useMoneyFormat(dashboard.currencyCode);
  const number = (n: number) => formatNumber(n, locale, formatOptions);

  const brandNames = useMemo(
    () => new Map(overview.brands.map((b) => [b.id, pickLocalized(b, 'name', locale)] as const)),
    [overview.brands, locale],
  );
  const branchNames = useMemo(
    () =>
      new Map(
        overview.brands.flatMap((b) =>
          b.locations.map((l) => [l.id, pickLocalized(l, 'name', locale)] as const),
        ),
      ),
    [overview.brands, locale],
  );

  const brandRows: BrandRow[] = dashboard.byBrand.map((r) => ({
    ...r,
    name: brandNames.get(r.tenantId) ?? '',
  }));
  const branchRows: BranchRow[] = dashboard.byLocation.map((r) => ({
    ...r,
    name: branchNames.get(r.locationId) ?? '',
    brand: brandNames.get(r.tenantId) ?? '',
  }));
  const total = dashboard.periods.last30.salesTotal;

  const figures = (p: { orderCount: number; averageTicket: number }) =>
    t('org.dashboard.figures', { orders: number(p.orderCount), average: format(p.averageTicket) });
  const onlineHubs = dashboard.byLocation.filter((l) => l.hubOnline).length;

  const figureColumns = <R extends BrandRow>(): DataTableColumn<R>[] => [
    {
      id: 'sales',
      header: t('org.dashboard.sales'),
      align: 'end',
      cell: (r) => <span className="ltr-nums">{format(r.salesTotal)}</span>,
      sortValue: (r) => r.salesTotal,
    },
    {
      id: 'orders',
      header: t('org.dashboard.orders'),
      align: 'end',
      cell: (r) => <span className="ltr-nums">{number(r.orderCount)}</span>,
      sortValue: (r) => r.orderCount,
    },
    {
      id: 'average',
      header: t('org.dashboard.average'),
      align: 'end',
      cell: (r) => <span className="ltr-nums">{format(average(r.salesTotal, r.orderCount))}</span>,
      sortValue: (r) => average(r.salesTotal, r.orderCount),
    },
  ];

  const brandColumns: DataTableColumn<BrandRow>[] = [
    {
      id: 'brand',
      header: t('org.dashboard.brand'),
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortValue: (r) => r.name,
    },
    ...figureColumns<BrandRow>(),
    {
      id: 'share',
      header: t('org.dashboard.share'),
      align: 'end',
      cell: (r) => (
        <span className="ltr-nums">
          {formatBps(
            total > 0 ? Math.round((r.salesTotal * 10_000) / total) : 0,
            locale,
            formatOptions,
          )}
        </span>
      ),
      sortValue: (r) => r.salesTotal,
    },
  ];

  const branchColumns: DataTableColumn<BranchRow>[] = [
    {
      id: 'branch',
      header: t('org.dashboard.branch'),
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortValue: (r) => r.name,
    },
    {
      id: 'brand',
      header: t('org.dashboard.brand'),
      cell: (r) => r.brand,
      sortValue: (r) => r.brand,
    },
    ...figureColumns<BranchRow>(),
    {
      id: 'hub',
      header: t('org.dashboard.hub'),
      cell: (r) => (
        <Badge variant={r.hubOnline ? 'success' : 'secondary'}>
          {r.hubOnline ? t('org.dashboard.online') : t('org.dashboard.offline')}
        </Badge>
      ),
      sortValue: (r) => Number(r.hubOnline),
    },
  ];

  // Money in the chart is in the currency's major units; the tooltip and table show it formatted.
  const major = (minor: number) => Number(formatMinorAsDecimal(minor, dashboard.currencyCode));
  const chartData = dashboard.daily.map((day) => ({
    day: formatBusinessDate(day.date, locale, formatOptions),
    ...Object.fromEntries(overview.brands.map((b) => [b.id, major(day.byTenant[b.id] ?? 0)])),
  }));
  const series = overview.brands.map((b) => ({
    key: b.id,
    label: pickLocalized(b, 'name', locale),
  }));

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('org.dashboard.salesToday')}
          value={<span className="ltr-nums">{format(dashboard.periods.today.salesTotal)}</span>}
          hint={figures(dashboard.periods.today)}
        />
        <StatCard
          label={t('org.dashboard.sales7')}
          value={<span className="ltr-nums">{format(dashboard.periods.last7.salesTotal)}</span>}
          hint={figures(dashboard.periods.last7)}
        />
        <StatCard
          label={t('org.dashboard.sales30')}
          value={<span className="ltr-nums">{format(dashboard.periods.last30.salesTotal)}</span>}
          hint={figures(dashboard.periods.last30)}
        />
        <StatCard
          label={t('org.dashboard.hubs')}
          value={t('org.dashboard.hubsValue', {
            online: number(onlineHubs),
            total: number(dashboard.byLocation.length),
          })}
          hint={t('org.dashboard.hubsHint')}
        />
      </div>
      {chartData.length > 0 && series.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t('org.dashboard.trendTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Chart
              kind="line"
              data={chartData}
              series={series}
              x="day"
              xLabel={t('org.dashboard.day')}
              ariaLabel={t('org.dashboard.trendLabel')}
              formatValue={(v) => format(parseDecimalToMinor(String(v), dashboard.currencyCode))}
            />
          </CardContent>
        </Card>
      ) : null}
      <section className="grid gap-2" aria-labelledby="org-by-brand">
        <h2 id="org-by-brand" className="text-sm font-semibold">
          {t('org.dashboard.byBrand')}
        </h2>
        <DataTable
          columns={brandColumns}
          rows={brandRows}
          rowKey={(r) => r.tenantId}
          empty={t('org.dashboard.noBrands')}
        />
      </section>
      <section className="grid gap-2" aria-labelledby="org-by-branch">
        <h2 id="org-by-branch" className="text-sm font-semibold">
          {t('org.dashboard.byBranch')}
        </h2>
        <DataTable
          columns={branchColumns}
          rows={branchRows}
          rowKey={(r) => r.locationId}
          empty={t('org.dashboard.noBranches')}
        />
      </section>
    </div>
  );
}

/** `/org/:organizationId`: the organization's last 30 days across its brands. */
export function OrgDashboardPage() {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const { organizationId = '' } = useParams();
  const overview = useOrganizationOverview(organizationId);
  const dashboard = useQuery({
    queryKey: keys.orgDashboard(organizationId),
    queryFn: () => api.organizations.dashboard(organizationId),
  });
  return (
    <QueryState query={overview}>
      {(ov) => (
        <>
          <PageHeader
            title={pickLocalized(ov.organization, 'name', locale)}
            description={t('org.dashboard.description', { currency: ov.organization.currencyCode })}
          />
          <QueryState query={dashboard}>
            {(data) => <DashboardBody overview={ov} dashboard={data} />}
          </QueryState>
        </>
      )}
    </QueryState>
  );
}
