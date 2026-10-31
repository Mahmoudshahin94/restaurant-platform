import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { businessDateFor } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import { OrderChannel, enumValues } from '@pos/shared-types';
import type {
  BrandReport,
  CategoryReport,
  ChannelReport,
  DailySalesReport,
  LocationReport,
  OrgReportQuery,
  OrganizationOverview,
  PaymentReport,
  ProductReport,
} from '@pos/validation';
import { Alert, Field, NativeSelect, PageHeader, cn } from '@pos/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, useLocation, useParams } from 'react-router';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { PeriodFields, useReportFilters } from '../reports/report-filters';
import {
  CategoriesView,
  ChannelsView,
  DailySalesView,
  PaymentsView,
  ProductsView,
} from '../reports/report-views';
import { BrandsView, LocationsView } from './org-report-views';
import { useOrganizationOverview } from './org-queries';

/** The seven reports an organization has: five of a brand, summed, and two of its own. */
export const ORG_REPORT_KINDS = [
  'daily-sales',
  'brands',
  'locations',
  'channels',
  'payments',
  'products',
  'categories',
] as const;
export type OrgReportKind = (typeof ORG_REPORT_KINDS)[number];

function isKind(value: string | undefined): value is OrgReportKind {
  return (ORG_REPORT_KINDS as readonly string[]).includes(value ?? '');
}

/** `/org/:organizationId/reports` opens the first report, keeping any filters. */
export function OrgReportsIndex() {
  const { organizationId } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/org/${organizationId ?? ''}/reports/daily-sales${search}`} replace />;
}

function hasData(kind: OrgReportKind, data: unknown): boolean {
  if (kind === 'daily-sales' || kind === 'channels') {
    const totals = (data as DailySalesReport | ChannelReport).totals;
    return totals.orders + totals.refunds.count + totals.cancelledOrders > 0;
  }
  return (data as { rows: unknown[] }).rows.length > 0;
}

function ReportContent({
  organizationId,
  kind,
  query,
  overview,
}: {
  organizationId: string;
  kind: OrgReportKind;
  query: OrgReportQuery;
  overview: OrganizationOverview;
}) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const fetchers = useMemo(
    () =>
      ({
        'daily-sales': api.organizations.reports.dailySales,
        brands: api.organizations.reports.brands,
        locations: api.organizations.reports.locations,
        channels: api.organizations.reports.channels,
        payments: api.organizations.reports.payments,
        products: api.organizations.reports.products,
        categories: api.organizations.reports.categories,
      }) satisfies Record<OrgReportKind, (oid: string, q: OrgReportQuery) => Promise<unknown>>,
    [],
  );
  const brandNames = useMemo(
    () => new Map(overview.brands.map((b) => [b.id, pickLocalized(b, 'name', locale)] as const)),
    [overview.brands, locale],
  );
  const report = useQuery({
    queryKey: keys.orgReport(organizationId, kind, query),
    queryFn: (): Promise<unknown> => fetchers[kind](organizationId, query),
    placeholderData: keepPreviousData,
  });
  const render = (data: unknown): ReactNode => {
    switch (kind) {
      case 'daily-sales':
        return <DailySalesView data={data as DailySalesReport} />;
      case 'brands':
        return <BrandsView data={data as BrandReport} />;
      case 'locations':
        return (
          <LocationsView
            data={data as LocationReport}
            brandName={(id) => brandNames.get(id) ?? ''}
          />
        );
      case 'channels':
        return <ChannelsView data={data as ChannelReport} />;
      case 'payments':
        return <PaymentsView data={data as PaymentReport} />;
      case 'products':
        return <ProductsView data={data as ProductReport} />;
      case 'categories':
        return <CategoriesView data={data as CategoryReport} />;
    }
  };
  return (
    <QueryState
      query={report}
      isEmpty={(data) => !hasData(kind, data)}
      empty={{ title: t('reports.empty'), description: t('reports.emptyHint') }}
    >
      {render}
    </QueryState>
  );
}

function Filters({ overview }: { overview: OrganizationOverview }) {
  const { t } = useTranslation(['admin', 'orders']);
  const locale = useCurrentLocale();
  const { kind } = useParams();
  const firstZone = overview.brands.flatMap((b) => b.locations)[0]?.timezone ?? 'UTC';
  const today = businessDateFor(new Date(), firstZone);
  const { params, from, to, period, rangeError, set } = useReportFilters(today);
  const brandId = params.get('brand') ?? '';
  const locationId = params.get('location') ?? '';
  const channel = params.get('channel') ?? '';
  const organizationId = overview.organization.id;

  if (!isKind(kind)) return null;
  const branches = overview.brands
    .filter((b) => !brandId || b.id === brandId)
    .flatMap((b) =>
      b.locations.map((l) => ({
        id: l.id,
        label: brandId
          ? pickLocalized(l, 'name', locale)
          : `${pickLocalized(b, 'name', locale)} · ${pickLocalized(l, 'name', locale)}`,
      })),
    );
  const query: OrgReportQuery = {
    from,
    to,
    ...(brandId ? { tenantIds: [brandId] } : {}),
    ...(locationId ? { locationIds: [locationId] } : {}),
    ...(channel ? { channels: [channel as OrderChannel] } : {}),
  };

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <PeriodFields from={from} to={to} period={period} today={today} set={set} />
        <Field label={t('admin:org.reports.brand')}>
          <NativeSelect
            value={brandId}
            onChange={(e) => {
              // A branch of another brand no longer applies.
              set({ brand: e.target.value, location: '' });
            }}
          >
            <option value="">{t('admin:org.reports.allBrands')}</option>
            {overview.brands.map((b) => (
              <option key={b.id} value={b.id}>
                {pickLocalized(b, 'name', locale)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('admin:org.reports.branch')}>
          <NativeSelect
            value={locationId}
            onChange={(e) => {
              set({ location: e.target.value });
            }}
          >
            <option value="">{t('admin:org.reports.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
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
      </div>
      {rangeError ? (
        <Alert variant="destructive" title={rangeError} />
      ) : (
        // Keyed by report so a previous report's data is never shown as another kind.
        <ReportContent
          key={kind}
          organizationId={organizationId}
          kind={kind}
          query={query}
          overview={overview}
        />
      )}
    </>
  );
}

/** `/org/:organizationId/reports/:kind`: the seven reports over all (or the chosen) brands. */
export function OrgReportsPage() {
  const { t } = useTranslation('admin');
  const { organizationId = '', kind } = useParams();
  const { search } = useLocation();
  const overview = useOrganizationOverview(organizationId);
  if (!isKind(kind)) {
    return <Navigate to={`/org/${organizationId}/reports/daily-sales${search}`} replace />;
  }
  return (
    <>
      <PageHeader title={t('org.reports.title')} description={t('org.reports.description')} />
      <nav aria-label={t('reports.picker')} className="mb-4 flex flex-wrap gap-1">
        {ORG_REPORT_KINDS.map((k) => (
          <NavLink
            key={k}
            to={`/org/${organizationId}/reports/${k}${search}`}
            className={({ isActive }) =>
              cn(
                'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted',
              )
            }
          >
            {t(`reports.kinds.${k}`)}
          </NavLink>
        ))}
      </nav>
      <QueryState query={overview}>{(ov) => <Filters overview={ov} />}</QueryState>
    </>
  );
}
