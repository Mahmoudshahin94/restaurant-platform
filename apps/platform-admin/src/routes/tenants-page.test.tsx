import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OID, organizationSummary, signIn, stubApi, tenantSummary } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { TenantsPage } from './tenants-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const page = {
  items: [
    tenantSummary,
    {
      ...tenantSummary,
      id: '01a146e8-0000-7000-8000-000000000002',
      slug: 'ramallah-roasters',
      nameEn: 'Ramallah Roasters',
      nameAr: 'محمصة رام الله',
      businessType: 'COFFEE_SHOP',
      status: 'SUSPENDED',
    },
  ],
  page: 1,
  pageSize: 25,
  total: 2,
};

describe('TenantsPage', () => {
  it('lists tenants with their status, and offers provisioning to operators', async () => {
    signIn('OPERATOR');
    stubApi().on('GET', /\/platform\/tenants$/, page);
    await renderWithProviders(<TenantsPage />);
    expect(await screen.findByRole('link', { name: 'Ramallah Roasters' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Suspended');
    expect(screen.getByRole('table')).toHaveTextContent('Active');
    expect(screen.getByRole('button', { name: 'Provision tenant' })).toBeInTheDocument();
  });

  it('renders right to left in Arabic, without provisioning for a viewer', async () => {
    signIn('VIEWER');
    stubApi().on('GET', /\/platform\/tenants$/, page);
    await renderWithProviders(<TenantsPage />, { locale: 'ar' });
    expect(await screen.findByRole('link', { name: 'محمصة رام الله' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('table')).toHaveTextContent('موقوفة');
    expect(screen.queryByRole('button', { name: 'إنشاء منشأة' })).not.toBeInTheDocument();
  });

  it('shows the organization of each brand and filters by it', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', /\/platform\/organizations$/, {
        items: [organizationSummary],
        page: 1,
        pageSize: 100,
        total: 1,
      })
      .on('GET', /\/platform\/tenants$/, {
        ...page,
        items: [
          {
            ...tenantSummary,
            organization: { id: OID, nameEn: 'Burger House Group', nameAr: 'x' },
          },
        ],
      });
    await renderWithProviders(<TenantsPage />);
    const link = await screen.findByRole('link', { name: 'Burger House Group' });
    expect(link).toHaveAttribute('href', `/organizations/${OID}`);
    expect(screen.getByRole('columnheader', { name: 'Organization' })).toBeInTheDocument();

    await screen.findByRole('option', { name: 'Burger House Group' });
    await userEvent.selectOptions(screen.getByLabelText('Organization'), OID);
    await waitFor(() => {
      expect(api.calls.some((c) => c.path.includes(`organizationId=${OID}`))).toBe(true);
    });
  });

  it('provisions a brand into an organization without asking for an owner', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', /\/platform\/organizations$/, {
        items: [{ ...organizationSummary, currencyCode: 'USD' }],
        page: 1,
        pageSize: 100,
        total: 1,
      })
      .on('GET', /\/platform\/tenants$/, page);
    await renderWithProviders(<TenantsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Provision tenant' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Owner email')).toBeInTheDocument();
    await within(dialog).findByRole('option', { name: /Burger House Group/ });
    await userEvent.selectOptions(within(dialog).getByLabelText('Organization'), OID);
    expect(within(dialog).queryByText('Owner email')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Currency/)).toHaveValue('USD');
    expect(within(dialog).getByLabelText(/^Currency/)).toBeDisabled();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
