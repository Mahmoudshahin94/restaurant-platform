import type { BrandReport, DailySalesReport, SalesFigures } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG, PIZZA, RID, signIn, stubApi } from '../../test/api-stub';
import { L_PIZZA, overview } from '../../test/org-fixtures';
import { renderNeutral } from '../../test/render';
import { OrgReportsPage } from './org-reports-page';

const figures = (patch: Partial<SalesFigures> = {}): SalesFigures => ({
  orders: 0,
  grossSales: 0,
  discounts: 0,
  netSales: 0,
  tax: 0,
  fees: 0,
  totalSales: 0,
  averageNetSale: 0,
  refunds: { count: 0, amount: 0, tax: 0, fees: 0, netSales: 0 },
  netSalesAfterRefunds: 0,
  taxAfterRefunds: 0,
  cancelledOrders: 0,
  ...patch,
});
const header = {
  from: '2026-10-10',
  to: '2026-10-11',
  currencyCode: 'SAR',
  locationIds: [],
  channels: null,
  generatedAt: '2026-10-12T08:00:00.000Z',
};
const brands: BrandReport = {
  ...header,
  rows: [
    {
      tenantId: RID,
      nameEn: 'Burger House',
      nameAr: 'بيت البرغر',
      ...figures({ orders: 3, netSales: 7_500 }),
    },
    {
      tenantId: PIZZA,
      nameEn: 'Pizza Point',
      nameAr: 'بيتزا بوينت',
      ...figures({ orders: 1, netSales: 2_500 }),
    },
  ],
  totals: figures({ orders: 4, netSales: 10_000 }),
};
const daily: DailySalesReport = {
  ...header,
  rows: [{ businessDate: '2026-10-10', ...figures({ orders: 4, netSales: 10_000 }) }],
  totals: figures({ orders: 4, netSales: 10_000 }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  return renderNeutral(
    <Routes>
      <Route path="/org/:organizationId/reports/:kind" element={<OrgReportsPage />} />
    </Routes>,
    { route: `/org/${ORG}/reports/${path}` },
  );
}

function stubOrg() {
  return stubApi()
    .on('GET', /\/organizations\/[^/]+$/, overview)
    .on('GET', /\/reports\/brands$/, brands)
    .on('GET', /\/reports\/daily-sales$/, daily);
}

describe('organization reports page', () => {
  it('shows the sales of each brand in the organization currency', async () => {
    signIn();
    stubOrg();
    await open('brands?from=2026-10-10&to=2026-10-11');
    const row = await screen.findByRole('row', { name: /Pizza Point/ });
    expect(row).toHaveTextContent(/25\.00/);
    expect(screen.getByRole('row', { name: /Burger House/ })).toHaveTextContent(/75\.00/);
    expect(screen.getByRole('link', { name: 'Sales by branch' })).toBeInTheDocument();
  });

  it('narrows the report to a brand and a branch', async () => {
    signIn();
    const api = stubOrg();
    await open('daily-sales?from=2026-10-10&to=2026-10-11');
    await screen.findByRole('row', { name: /Oct 10, 2026/ });
    await userEvent.selectOptions(screen.getByLabelText('Brand'), PIZZA);
    await userEvent.selectOptions(screen.getByLabelText('Branch'), L_PIZZA);
    await vi.waitFor(() => {
      const last = api.calls.filter((c) => c.path.includes('/reports/daily-sales')).at(-1);
      const query = new URLSearchParams(last?.path.split('?')[1]);
      expect(query.get('tenantIds')).toBe(PIZZA);
      expect(query.get('locationIds')).toBe(L_PIZZA);
      expect(query.get('from')).toBe('2026-10-10');
    });
    const options = within(screen.getByLabelText('Branch')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['All branches', 'Pizza Harbor']);
  });

  it('reads in Arabic', async () => {
    signIn();
    stubOrg();
    await renderNeutral(
      <Routes>
        <Route path="/org/:organizationId/reports/:kind" element={<OrgReportsPage />} />
      </Routes>,
      { route: `/org/${ORG}/reports/brands?from=2026-10-10&to=2026-10-11`, locale: 'ar' },
    );
    expect(await screen.findByRole('row', { name: /بيتزا بوينت/ })).toBeInTheDocument();
  });
});
