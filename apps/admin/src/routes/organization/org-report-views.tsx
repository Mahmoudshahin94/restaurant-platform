import { useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { BrandReport, LocationReport } from '@pos/validation';
import { useTranslation } from 'react-i18next';
import { type Column } from '../reports/report-table';
import { ReportBody, salesSummary, useSalesColumns } from '../reports/report-views';

/** Sales per brand of the organization (E1 §4.3). */
export function BrandsView({ data }: { data: BrandReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const sales = useSalesColumns();
  type Row = BrandReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'brand',
      label: t('reports.columns.brand'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    ...sales<Row>(data.totals),
  ];
  return (
    <ReportBody
      kind="brands"
      header={data}
      note={t('reports.notes.sales')}
      summary={salesSummary(t, data.totals)}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.tenantId}
    />
  );
}

/** Sales per branch, with its brand; branches without sales are listed too. */
export function LocationsView({
  data,
  brandName,
}: {
  data: LocationReport;
  brandName: (tenantId: string) => string;
}) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const sales = useSalesColumns();
  type Row = LocationReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'branch',
      label: t('reports.columns.branch'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    {
      id: 'brand',
      label: t('reports.columns.brand'),
      kind: 'text',
      value: (r) => brandName(r.tenantId),
    },
    ...sales<Row>(data.totals),
  ];
  return (
    <ReportBody
      kind="locations"
      header={data}
      note={t('reports.notes.sales')}
      summary={salesSummary(t, data.totals)}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.locationId}
    />
  );
}
