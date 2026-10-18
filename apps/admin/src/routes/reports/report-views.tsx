import { useCurrentLocale } from '@pos/app-kit';
import { formatBusinessDate, pickLocalized } from '@pos/i18n';
import type {
  CategoryReport,
  ChannelReport,
  DailySalesReport,
  DiscountReport,
  PaymentReport,
  PrepTimeReport,
  ProductReport,
  ReportKind,
  SalesFigures,
  ShiftReport,
  TaxReport,
} from '@pos/validation';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDateTime, useLocationLookup } from '../../lib/format';
import {
  type CellKind,
  type CellValue,
  type Column,
  ExportButton,
  ReportTable,
  downloadFile,
  toCsv,
  useCellFormat,
} from './report-table';

interface Summary {
  label: string;
  kind: CellKind;
  value: CellValue;
}

interface Header {
  from: string;
  to: string;
  currencyCode: string;
}

/** Headline figures, an optional chart, the table and its CSV export. */
function ReportBody<R>({
  kind,
  header,
  note,
  summary,
  chart,
  columns,
  rows,
  rowKey,
  extra,
}: {
  kind: ReportKind;
  header: Header;
  note: string;
  summary: readonly Summary[];
  chart?: ReactNode;
  columns: readonly Column<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  extra?: ReactNode;
}) {
  const { t } = useTranslation('admin');
  const cell = useCellFormat(header.currencyCode);
  const title = t(`reports.kinds.${kind}`);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summary.map((s) => (
          <Card key={s.label}>
            <CardContent className="grid gap-0.5 p-4">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <span className="ltr-nums text-lg font-semibold">{cell(s.kind, s.value)}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      {chart}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-muted-foreground">{note}</p>
        <ExportButton
          onExport={() => {
            downloadFile(
              `${kind}_${header.from}_${header.to}.csv`,
              toCsv(columns, rows, header.currencyCode, t('reports.total')),
            );
          }}
        />
      </div>
      <ReportTable
        caption={title}
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        currency={header.currencyCode}
      />
      {extra}
    </div>
  );
}

/** The columns every sales report shares (daily, channel). */
function useSalesColumns() {
  const { t } = useTranslation('admin');
  return <R extends SalesFigures>(totals: SalesFigures): Column<R>[] => {
    const col = (
      id: string,
      label: string,
      kind: CellKind,
      pick: (f: SalesFigures) => number,
    ): Column<R> => ({ id, label, kind, value: pick, total: pick(totals) });
    return [
      col('orders', t('reports.columns.orders'), 'count', (f) => f.orders),
      col('grossSales', t('reports.columns.grossSales'), 'money', (f) => f.grossSales),
      col('discounts', t('reports.columns.discounts'), 'money', (f) => f.discounts),
      col('netSales', t('reports.columns.netSales'), 'money', (f) => f.netSales),
      col('tax', t('reports.columns.tax'), 'money', (f) => f.tax),
      col('fees', t('reports.columns.fees'), 'money', (f) => f.fees),
      col('totalSales', t('reports.columns.totalSales'), 'money', (f) => f.totalSales),
      col('refunds', t('reports.columns.refunds'), 'money', (f) => f.refunds.amount),
      col(
        'netSalesAfterRefunds',
        t('reports.columns.netSalesAfterRefunds'),
        'money',
        (f) => f.netSalesAfterRefunds,
      ),
      col('averageNetSale', t('reports.columns.averageNetSale'), 'money', (f) => f.averageNetSale),
      col(
        'cancelledOrders',
        t('reports.columns.cancelledOrders'),
        'count',
        (f) => f.cancelledOrders,
      ),
    ];
  };
}

function salesSummary(t: TFunction<'admin'>, totals: SalesFigures): Summary[] {
  return [
    { label: t('reports.columns.orders'), kind: 'count', value: totals.orders },
    { label: t('reports.columns.netSales'), kind: 'money', value: totals.netSales },
    { label: t('reports.columns.tax'), kind: 'money', value: totals.tax },
    { label: t('reports.columns.totalSales'), kind: 'money', value: totals.totalSales },
    { label: t('reports.columns.refunds'), kind: 'money', value: totals.refunds.amount },
    {
      label: t('reports.columns.netSalesAfterRefunds'),
      kind: 'money',
      value: totals.netSalesAfterRefunds,
    },
  ];
}

/** Net sales per day as thin bars (a single series: the title names it; the table is below). */
function DailyChart({ data }: { data: DailySalesReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const cell = useCellFormat(data.currencyCode);
  const max = Math.max(...data.rows.map((r) => r.netSales), 0);
  if (data.rows.length < 2 || max === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('reports.chart.netSalesByDay')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          aria-hidden
          className="flex h-40 items-end gap-0.5 border-b border-border"
          data-testid="daily-chart"
        >
          {data.rows.map((r) => {
            const label = t('reports.chart.bar', {
              date: formatBusinessDate(r.businessDate, locale),
              amount: cell('money', r.netSales),
            });
            return (
              <div
                key={r.businessDate}
                className="group flex h-full flex-1 items-end"
                title={label}
              >
                <div
                  className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{
                    height: `${String((r.netSales / max) * 100)}%`,
                    minHeight: r.netSales > 0 ? 2 : 0,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{formatBusinessDate(data.from, locale)}</span>
          <span>{formatBusinessDate(data.to, locale)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function DailySalesView({ data }: { data: DailySalesReport }) {
  const { t } = useTranslation('admin');
  const sales = useSalesColumns();
  type Row = DailySalesReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'businessDate',
      label: t('reports.columns.businessDate'),
      kind: 'date',
      value: (r) => r.businessDate,
    },
    ...sales<Row>(data.totals),
  ];
  return (
    <ReportBody
      kind="daily-sales"
      header={data}
      note={t('reports.notes.sales')}
      summary={salesSummary(t, data.totals)}
      chart={<DailyChart data={data} />}
      columns={columns}
      // Newest day first, like the other admin lists.
      rows={[...data.rows].reverse()}
      rowKey={(r) => r.businessDate}
    />
  );
}

export function ChannelsView({ data }: { data: ChannelReport }) {
  const { t } = useTranslation(['admin', 'orders']);
  const { t: tAdmin } = useTranslation('admin');
  const sales = useSalesColumns();
  type Row = ChannelReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'channel',
      label: t('admin:reports.columns.channel'),
      kind: 'text',
      value: (r) => t(`orders:channel.${r.channel}`),
    },
    ...sales<Row>(data.totals),
    {
      id: 'share',
      label: t('admin:reports.columns.share'),
      kind: 'percent',
      value: (r) => r.shareBps,
      bar: true,
    },
  ];
  return (
    <ReportBody
      kind="channels"
      header={data}
      note={t('admin:reports.notes.sales')}
      summary={salesSummary(tAdmin, data.totals)}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.channel}
    />
  );
}

export function PaymentsView({ data }: { data: PaymentReport }) {
  const { t } = useTranslation(['admin', 'orders']);
  const locale = useCurrentLocale();
  type Row = PaymentReport['rows'][number];
  type ChannelRow = PaymentReport['byChannel'][number];
  const money = <
    R extends {
      charges: number;
      chargeCount: number;
      refunds: number;
      refundCount: number;
      net: number;
    },
  >(
    totals: boolean,
  ): Column<R>[] => [
    {
      id: 'chargeCount',
      label: t('admin:reports.columns.chargeCount'),
      kind: 'count',
      value: (r) => r.chargeCount,
      ...(totals ? { total: data.totals.chargeCount } : {}),
    },
    {
      id: 'charges',
      label: t('admin:reports.columns.charges'),
      kind: 'money',
      value: (r) => r.charges,
      ...(totals ? { total: data.totals.charges } : {}),
    },
    {
      id: 'refundCount',
      label: t('admin:reports.columns.refundCount'),
      kind: 'count',
      value: (r) => r.refundCount,
      ...(totals ? { total: data.totals.refundCount } : {}),
    },
    {
      id: 'refunds',
      label: t('admin:reports.columns.refunds'),
      kind: 'money',
      value: (r) => r.refunds,
      ...(totals ? { total: data.totals.refunds } : {}),
    },
    {
      id: 'net',
      label: t('admin:reports.columns.net'),
      kind: 'money',
      value: (r) => r.net,
      ...(totals ? { total: data.totals.net } : {}),
    },
  ];
  const columns: Column<Row>[] = [
    {
      id: 'method',
      label: t('admin:reports.columns.method'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    ...money<Row>(true),
    {
      id: 'rounding',
      label: t('admin:reports.columns.rounding'),
      kind: 'money',
      value: (r) => r.roundingAdjustment,
      total: data.totals.roundingAdjustment,
    },
  ];
  const channelColumns: Column<ChannelRow>[] = [
    {
      id: 'channel',
      label: t('admin:reports.columns.channel'),
      kind: 'text',
      value: (r) => t(`orders:channel.${r.channel}`),
    },
    ...money<ChannelRow>(false),
  ];
  return (
    <ReportBody
      kind="payments"
      header={data}
      note={t('admin:reports.notes.payments')}
      summary={[
        { label: t('admin:reports.columns.charges'), kind: 'money', value: data.totals.charges },
        { label: t('admin:reports.columns.refunds'), kind: 'money', value: data.totals.refunds },
        { label: t('admin:reports.columns.net'), kind: 'money', value: data.totals.net },
        {
          label: t('admin:reports.columns.chargeCount'),
          kind: 'count',
          value: data.totals.chargeCount,
        },
      ]}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.paymentMethodId}
      extra={
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold">{t('admin:reports.byChannel')}</h2>
          <ReportTable
            caption={t('admin:reports.byChannel')}
            columns={channelColumns}
            rows={data.byChannel}
            rowKey={(r) => r.channel}
            currency={data.currencyCode}
          />
        </section>
      }
    />
  );
}

type LineTotals = ProductReport['totals'];

function lineColumns<R extends LineTotals>(t: TFunction<'admin'>, totals: LineTotals): Column<R>[] {
  const col = (id: keyof LineTotals, label: string, kind: CellKind): Column<R> => ({
    id,
    label,
    kind,
    value: (r) => r[id],
    total: totals[id],
    ...(id === 'shareBps' ? { bar: true } : {}),
  });
  return [
    col('quantity', t('reports.columns.quantity'), 'count'),
    col('orders', t('reports.columns.orders'), 'count'),
    col('grossSales', t('reports.columns.grossSales'), 'money'),
    col('discounts', t('reports.columns.discounts'), 'money'),
    col('tax', t('reports.columns.tax'), 'money'),
    col('netSales', t('reports.columns.netSales'), 'money'),
    col('shareBps', t('reports.columns.share'), 'percent'),
  ];
}

function lineSummary(t: TFunction<'admin'>, totals: LineTotals): Summary[] {
  return [
    { label: t('reports.columns.quantity'), kind: 'count', value: totals.quantity },
    { label: t('reports.columns.orders'), kind: 'count', value: totals.orders },
    { label: t('reports.columns.discounts'), kind: 'money', value: totals.discounts },
    { label: t('reports.columns.netSales'), kind: 'money', value: totals.netSales },
  ];
}

export function ProductsView({ data }: { data: ProductReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  type Row = ProductReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'product',
      label: t('reports.columns.product'),
      kind: 'text',
      value: (r) => {
        const name = pickLocalized(r, 'name', locale);
        const variant = locale === 'ar' ? r.variantNameAr : r.variantNameEn;
        return variant ? `${name} · ${variant}` : name;
      },
    },
    {
      id: 'category',
      label: t('reports.columns.category'),
      kind: 'text',
      value: (r) => (locale === 'ar' ? r.categoryNameAr : r.categoryNameEn),
    },
    ...lineColumns<Row>(t, data.totals),
  ];
  return (
    <ReportBody
      kind="products"
      header={data}
      note={t('reports.notes.lines')}
      summary={lineSummary(t, data.totals)}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => `${r.productId}:${r.variantId ?? ''}`}
    />
  );
}

export function CategoriesView({ data }: { data: CategoryReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  type Row = CategoryReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'category',
      label: t('reports.columns.category'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    {
      id: 'products',
      label: t('reports.columns.products'),
      kind: 'count',
      value: (r) => r.products,
    },
    ...lineColumns<Row>(t, data.totals),
  ];
  return (
    <ReportBody
      kind="categories"
      header={data}
      note={t('reports.notes.lines')}
      summary={lineSummary(t, data.totals)}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.categoryId}
    />
  );
}

export function TaxesView({ data }: { data: TaxReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  type Row = TaxReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'taxName',
      label: t('reports.columns.taxName'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    { id: 'rate', label: t('reports.columns.rate'), kind: 'percent', value: (r) => r.rateBps },
    {
      id: 'priceMode',
      label: t('reports.columns.priceMode'),
      kind: 'text',
      value: (r) => t(`reports.priceModes.${r.taxInclusive ? 'inclusive' : 'exclusive'}`),
    },
    {
      id: 'orders',
      label: t('reports.columns.orders'),
      kind: 'count',
      value: (r) => r.orders,
      total: data.totals.orders,
    },
    {
      id: 'taxableAmount',
      label: t('reports.columns.taxableAmount'),
      kind: 'money',
      value: (r) => r.taxableAmount,
    },
    {
      id: 'tax',
      label: t('reports.columns.tax'),
      kind: 'money',
      value: (r) => r.tax,
      total: data.totals.tax,
    },
    {
      id: 'refundedTax',
      label: t('reports.columns.refundedTax'),
      kind: 'money',
      value: (r) => r.refundedTax,
      total: data.totals.refundedTax,
    },
    {
      id: 'netTax',
      label: t('reports.columns.netTax'),
      kind: 'money',
      value: (r) => r.netTax,
      total: data.totals.netTax,
    },
  ];
  return (
    <ReportBody
      kind="taxes"
      header={data}
      note={t('reports.notes.taxes')}
      summary={[
        { label: t('reports.columns.tax'), kind: 'money', value: data.totals.tax },
        { label: t('reports.columns.refundedTax'), kind: 'money', value: data.totals.refundedTax },
        { label: t('reports.columns.netTax'), kind: 'money', value: data.totals.netTax },
      ]}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => `${r.taxId}:${String(r.rateBps)}:${String(r.taxInclusive)}`}
    />
  );
}

export function DiscountsView({ data }: { data: DiscountReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const cell = useCellFormat(data.currencyCode);
  type Row = DiscountReport['rows'][number];
  const columns: Column<Row>[] = [
    {
      id: 'discount',
      label: t('reports.columns.discount'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    {
      id: 'value',
      label: t('reports.columns.value'),
      kind: 'text',
      value: (r) => (r.type === 'PERCENTAGE' ? cell('percent', r.value) : cell('money', r.value)),
    },
    {
      id: 'applications',
      label: t('reports.columns.applications'),
      kind: 'count',
      value: (r) => r.applications,
      total: data.totals.applications,
    },
    {
      id: 'orders',
      label: t('reports.columns.orders'),
      kind: 'count',
      value: (r) => r.orders,
      total: data.totals.orders,
    },
    {
      id: 'amount',
      label: t('reports.columns.amount'),
      kind: 'money',
      value: (r) => r.amount,
      total: data.totals.amount,
    },
  ];
  return (
    <ReportBody
      kind="discounts"
      header={data}
      note={t('reports.notes.discounts')}
      summary={[
        { label: t('reports.columns.discounts'), kind: 'money', value: data.totals.amount },
        { label: t('reports.columns.orders'), kind: 'count', value: data.totals.orders },
        { label: t('reports.columns.grossSales'), kind: 'money', value: data.totals.grossSales },
        { label: t('reports.columns.share'), kind: 'percent', value: data.totals.shareOfGrossBps },
      ]}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => `${r.discountId}:${r.type}:${String(r.value)}`}
    />
  );
}

export function ShiftsView({ data }: { data: ShiftReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const { name } = useLocationLookup();
  const formatDate = useDateTime();
  type Row = ShiftReport['rows'][number];
  const tot = data.totals;
  const columns: Column<Row>[] = [
    {
      id: 'opened',
      label: t('reports.columns.opened'),
      kind: 'text',
      value: (r) => formatDate(r.openedAt, r.locationId),
    },
    {
      id: 'location',
      label: t('reports.columns.location'),
      kind: 'text',
      value: (r) => name(r.locationId),
    },
    {
      id: 'drawer',
      label: t('reports.columns.drawer'),
      kind: 'text',
      value: (r) => (locale === 'ar' ? r.cashRegisterNameAr : r.cashRegisterNameEn),
    },
    {
      id: 'status',
      label: t('reports.columns.status'),
      kind: 'text',
      value: (r) => t(`shifts.statuses.${r.status}`),
    },
    {
      id: 'openedBy',
      label: t('reports.columns.openedBy'),
      kind: 'text',
      value: (r) => r.openedByName,
    },
    {
      id: 'openingFloat',
      label: t('reports.columns.openingFloat'),
      kind: 'money',
      value: (r) => r.openingFloat,
      total: tot.openingFloat,
    },
    {
      id: 'cashSales',
      label: t('reports.columns.cashSales'),
      kind: 'money',
      value: (r) => r.cashSales,
      total: tot.cashSales,
    },
    {
      id: 'cashRefunds',
      label: t('reports.columns.cashRefunds'),
      kind: 'money',
      value: (r) => r.cashRefunds,
      total: tot.cashRefunds,
    },
    {
      id: 'payIns',
      label: t('reports.columns.payIns'),
      kind: 'money',
      value: (r) => r.payIns,
      total: tot.payIns,
    },
    {
      id: 'payOuts',
      label: t('reports.columns.payOuts'),
      kind: 'money',
      value: (r) => r.payOuts,
      total: tot.payOuts,
    },
    {
      id: 'expectedCash',
      label: t('reports.columns.expectedCash'),
      kind: 'money',
      value: (r) => r.expectedCash,
      total: tot.expectedCash,
    },
    {
      id: 'countedCash',
      label: t('reports.columns.countedCash'),
      kind: 'money',
      value: (r) => r.countedCash,
    },
    {
      id: 'cashDifference',
      label: t('reports.columns.cashDifference'),
      kind: 'money',
      value: (r) => r.cashDifference,
      total: tot.cashDifference,
    },
    {
      id: 'orders',
      label: t('reports.columns.orders'),
      kind: 'count',
      value: (r) => r.orders,
      total: tot.orders,
    },
    {
      id: 'netCollected',
      label: t('reports.columns.netCollected'),
      kind: 'money',
      value: (r) => r.netCollected,
      total: tot.netCollected,
    },
  ];
  return (
    <ReportBody
      kind="shifts"
      header={data}
      note={t('reports.notes.shifts')}
      summary={[
        { label: t('nav.shifts'), kind: 'count', value: tot.shifts },
        { label: t('shifts.statuses.OPEN'), kind: 'count', value: tot.openShifts },
        { label: t('reports.columns.cashSales'), kind: 'money', value: tot.cashSales },
        { label: t('reports.columns.netCollected'), kind: 'money', value: tot.netCollected },
        { label: t('reports.columns.cashDifference'), kind: 'money', value: tot.cashDifference },
      ]}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.shiftId}
    />
  );
}

export function PrepTimesView({ data }: { data: PrepTimeReport }) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  type Row = PrepTimeReport['rows'][number];
  type Figures = PrepTimeReport['totals'];
  const col = (id: keyof Figures, label: string, kind: CellKind): Column<Row> => ({
    id,
    label,
    kind,
    value: (r) => r[id],
    total: data.totals[id],
  });
  const columns: Column<Row>[] = [
    {
      id: 'station',
      label: t('reports.columns.station'),
      kind: 'text',
      value: (r) => pickLocalized(r, 'name', locale),
    },
    col('tickets', t('reports.columns.tickets'), 'count'),
    col('averagePrepSeconds', t('reports.columns.averagePrep'), 'duration'),
    col('medianPrepSeconds', t('reports.columns.medianPrep'), 'duration'),
    col('p90PrepSeconds', t('reports.columns.p90Prep'), 'duration'),
    col('maxPrepSeconds', t('reports.columns.maxPrep'), 'duration'),
    col('averageWaitSeconds', t('reports.columns.averageWait'), 'duration'),
    col('lateTickets', t('reports.columns.lateTickets'), 'count'),
    { ...col('lateShareBps', t('reports.columns.lateShare'), 'percent'), bar: true },
  ];
  return (
    <ReportBody
      kind="prep-times"
      header={data}
      note={t('reports.notes.prepTimes')}
      summary={[
        { label: t('reports.columns.tickets'), kind: 'count', value: data.totals.tickets },
        {
          label: t('reports.columns.averagePrep'),
          kind: 'duration',
          value: data.totals.averagePrepSeconds,
        },
        {
          label: t('reports.columns.p90Prep'),
          kind: 'duration',
          value: data.totals.p90PrepSeconds,
        },
        { label: t('reports.columns.lateShare'), kind: 'percent', value: data.totals.lateShareBps },
      ]}
      columns={columns}
      rows={data.rows}
      rowKey={(r) => r.stationId}
    />
  );
}
