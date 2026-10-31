import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG, signIn, stubApi } from '../../test/api-stub';
import { dashboard, overview } from '../../test/org-fixtures';
import { renderNeutral } from '../../test/render';
import { OrgDashboardPage } from './org-dashboard-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

function page() {
  return (
    <Routes>
      <Route path="/org/:organizationId" element={<OrgDashboardPage />} />
    </Routes>
  );
}

function stubOrg() {
  return stubApi()
    .on('GET', /\/organizations\/[^/]+$/, overview)
    .on('GET', /\/organizations\/[^/]+\/dashboard$/, dashboard);
}

describe('organization dashboard', () => {
  it('shows stat cards, the sales chart and the tables by brand and by branch', async () => {
    signIn();
    stubOrg();
    await renderNeutral(page(), { route: `/org/${ORG}` });

    expect(await screen.findByRole('heading', { name: 'Demo Group' })).toBeInTheDocument();
    const today = screen.getByText('Sales today').parentElement as HTMLElement;
    expect(today).toHaveTextContent(/1,250\.00/);
    expect(today).toHaveTextContent('Orders: 10');
    expect(screen.getByText('Sales, last 7 days').parentElement).toHaveTextContent(/8,000\.00/);
    expect(screen.getByText('Sales, last 30 days').parentElement).toHaveTextContent(/33,000\.00/);
    expect(screen.getByText('Branch hubs online').parentElement).toHaveTextContent('1 of 2');

    expect(screen.getByRole('img', { name: /Sales per day for each brand/ })).toBeInTheDocument();

    const brands = screen.getByRole('region', { name: 'By brand' });
    const burger = within(brands).getByRole('row', { name: /Burger House/ });
    expect(burger).toHaveTextContent(/20,000\.00/);
    expect(burger).toHaveTextContent('180');
    expect(burger).toHaveTextContent('60.6%'); // share of the organization's 30-day sales

    const branches = screen.getByRole('region', { name: 'By branch' });
    const harbor = within(branches).getByRole('row', { name: /Pizza Harbor/ });
    expect(harbor).toHaveTextContent('Pizza Point');
    expect(harbor).toHaveTextContent('Offline');
    expect(within(branches).getByRole('row', { name: /Burger Downtown/ })).toHaveTextContent(
      'Online',
    );
  });

  it('reads in Arabic with the brand names in Arabic', async () => {
    signIn();
    stubOrg();
    await renderNeutral(page(), { route: `/org/${ORG}`, locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'مجموعة العرض' })).toBeInTheDocument();
    const brands = screen.getByRole('region', { name: 'حسب العلامة التجارية' });
    expect(within(brands).getByRole('row', { name: /بيت البرغر/ })).toBeInTheDocument();
  });

  it('says so when the organization could not be loaded', async () => {
    signIn();
    stubApi().on('GET', /\/organizations\/[^/]+$/, () => ({
      status: 404,
      body: { code: 'ORGANIZATION_NOT_FOUND', message: 'x', details: {} },
    }));
    await renderNeutral(page(), { route: `/org/${ORG}` });
    expect(await screen.findByText('Organization not found.')).toBeInTheDocument();
  });
});
