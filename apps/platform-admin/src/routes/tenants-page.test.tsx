import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi, tenantSummary } from '../test/api-stub';
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
});
