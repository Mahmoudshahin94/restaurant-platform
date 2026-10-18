import type { ChannelReport, DailySalesReport, SalesFigures } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOC, signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { type Column, toCsv } from './report-table';
import { ReportsPage, periodRange } from './reports-page';

const noRefunds = { count: 0, amount: 0, tax: 0, fees: 0, netSales: 0 };
const figures = (patch: Partial<SalesFigures> = {}): SalesFigures => ({
  orders: 0,
  grossSales: 0,
  discounts: 0,
  netSales: 0,
  tax: 0,
  fees: 0,
  totalSales: 0,
  averageNetSale: 0,
  refunds: noRefunds,
  netSalesAfterRefunds: 0,
  taxAfterRefunds: 0,
  cancelledOrders: 0,
  ...patch,
});
const header = {
  from: '2026-10-10',
  to: '2026-10-11',
  currencyCode: 'SAR',
  locationIds: [LOC],
  channels: null,
  generatedAt: '2026-10-12T08:00:00.000Z',
};

const daily: DailySalesReport = {
  ...header,
  rows: [
    {
      businessDate: '2026-10-10',
      ...figures({ orders: 2, grossSales: 6_700, discounts: 580, netSales: 5_361, tax: 759 }),
    },
    {
      businessDate: '2026-10-11',
      ...figures({
        orders: 1,
        netSales: 2_500,
        refunds: { count: 1, amount: 575, tax: 75, fees: 0, netSales: 500 },
        netSalesAfterRefunds: 2_000,
      }),
    },
  ],
  totals: figures({
    orders: 3,
    grossSales: 9_700,
    discounts: 1_080,
    netSales: 7_861,
    tax: 1_134,
    totalSales: 8_995,
    refunds: { count: 1, amount: 575, tax: 75, fees: 0, netSales: 500 },
    netSalesAfterRefunds: 7_361,
  }),
};

const channels: ChannelReport = {
  ...header,
  rows: (['DINE_IN', 'TAKEAWAY', 'PHONE', 'WEBSITE', 'DELIVERY'] as const).map((channel) => ({
    channel,
    ...figures(channel === 'DINE_IN' ? { orders: 3, netSales: 7_861 } : {}),
    shareBps: channel === 'DINE_IN' ? 10_000 : 0,
  })),
  totals: figures({ orders: 3, netSales: 7_861 }),
};

function renderReports(path: string, locale: 'en' | 'ar' = 'en') {
  return renderWithProviders(
    <Routes>
      <Route path="/reports/:kind" element={<ReportsPage />} />
    </Routes>,
    { locale, route: path },
  );
}

const reportCalls = (api: ReturnType<typeof stubApi>) =>
  api.calls.filter((c) => c.path.includes('/reports/'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reports page', () => {
  it('shows daily sales with totals for the period in the URL', async () => {
    signIn();
    const api = stubApi().on('GET', /\/reports\/daily-sales$/, daily);
    await renderReports('/reports/daily-sales?from=2026-10-10&to=2026-10-11');
    const table = await screen.findByRole('table', { name: 'Daily sales' });
    const total = within(table).getByRole('row', { name: /^Total/ });
    expect(within(total).getByText('SAR 78.61')).toBeInTheDocument();
    expect(within(total).getByText('SAR 73.61')).toBeInTheDocument();
    // Newest day first; business dates are formatted, not shifted.
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Oct 11, 2026');
    expect(rows[2]).toHaveTextContent('Oct 10, 2026');
    expect(screen.getByTestId('daily-chart')).toBeInTheDocument();
    expect(reportCalls(api)[0]?.path).toContain('from=2026-10-10&to=2026-10-11');
  });

  it('asks the API again when a filter changes', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/reports\/daily-sales$/, daily)
      .on('GET', /\/reports\/channels$/, channels);
    await renderReports('/reports/daily-sales?from=2026-10-10&to=2026-10-11');
    await screen.findByRole('table', { name: 'Daily sales' });
    await userEvent.selectOptions(screen.getByLabelText('Channel'), 'WEBSITE');
    await userEvent.selectOptions(screen.getByLabelText('Location'), LOC);
    await vi.waitFor(() => {
      expect(reportCalls(api).at(-1)?.path).toContain(`locationIds=${LOC}`);
    });
    expect(reportCalls(api).at(-1)?.path).toContain('channels=WEBSITE');
    await userEvent.click(screen.getByRole('link', { name: 'Orders by channel' }));
    const table = await screen.findByRole('table', { name: 'Orders by channel' });
    expect(within(table).getByRole('row', { name: /Dine-in/ })).toHaveTextContent('100%');
    expect(reportCalls(api).at(-1)?.path).toMatch(/\/reports\/channels\?.*channels=WEBSITE/);
  });

  it('refuses an inverted period without asking the API', async () => {
    signIn();
    const api = stubApi();
    await renderReports('/reports/products?from=2026-10-12&to=2026-10-01');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date must be on or before the end date.',
    );
    expect(reportCalls(api)).toEqual([]);
  });

  it('shows an empty state', async () => {
    signIn();
    stubApi().on('GET', /\/reports\/products$/, {
      ...header,
      rows: [],
      totals: {
        quantity: 0,
        orders: 0,
        grossSales: 0,
        discounts: 0,
        tax: 0,
        netSales: 0,
        shareBps: 0,
      },
    });
    await renderReports('/reports/products?from=2026-10-10&to=2026-10-11');
    expect(await screen.findByText('Nothing to report for this period')).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    signIn();
    const api = stubApi().on('GET', /\/reports\/taxes$/, () => ({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'x', details: {} },
    }));
    await renderReports('/reports/taxes?from=2026-10-10&to=2026-10-11');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => {
      expect(reportCalls(api)).toHaveLength(2);
    });
  });

  it('reads right to left in Arabic with Arabic labels and channel names', async () => {
    signIn();
    stubApi().on('GET', /\/reports\/channels$/, channels);
    await renderReports('/reports/channels?from=2026-10-10&to=2026-10-11', 'ar');
    const table = await screen.findByRole('table', { name: 'الطلبات حسب القناة' });
    expect(within(table).getByRole('columnheader', { name: 'صافي المبيعات' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /محلي/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /الإجمالي/ })).toHaveTextContent('78.61');
    expect(screen.getByRole('button', { name: 'تصدير CSV' })).toBeInTheDocument();
  });
});

describe('report helpers', () => {
  it('builds a spreadsheet-friendly CSV with exact money and a totals row', () => {
    type Row = { name: string; amount: number; share: number; prep: number };
    const columns: Column<Row>[] = [
      { id: 'name', label: 'Name', kind: 'text', value: (r) => r.name },
      { id: 'amount', label: 'Amount', kind: 'money', value: (r) => r.amount, total: 3_625 },
      { id: 'share', label: 'Share', kind: 'percent', value: (r) => r.share },
      { id: 'prep', label: 'Prep', kind: 'duration', value: (r) => r.prep },
    ];
    const csv = toCsv(
      columns,
      [
        { name: 'Machboos, large', amount: 2_625, share: 7_241, prep: 3_725 },
        { name: 'Say "hi"', amount: 1_000, share: 2_759, prep: 65 },
      ],
      'KWD',
      'Total',
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Name,Amount,Share,Prep',
      '"Machboos, large",2.625,72.41,1:02:05',
      '"Say ""hi""",1.000,27.59,1:05',
      'Total,3.625,,',
      '',
    ]);
  });

  it('computes preset periods from the business date', () => {
    expect(periodRange('last7', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
    expect(periodRange('lastMonth', '2026-03-03')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(periodRange('yesterday', '2026-01-01')).toEqual({
      from: '2025-12-31',
      to: '2025-12-31',
    });
  });
});
