import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OID,
  apiError,
  organizationDetail,
  organizationSummary,
  signIn,
  stubApi,
} from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { OrganizationsPage } from './organizations-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const suspended = {
  ...organizationSummary,
  id: '01a146e8-0000-7000-8000-0000000000c1',
  slug: 'coffee-club',
  nameEn: 'Coffee Club',
  nameAr: 'نادي القهوة',
  status: 'SUSPENDED',
  brandCount: 3,
  memberCount: 2,
};
const page = { items: [organizationSummary, suspended], page: 1, pageSize: 25, total: 2 };

describe('OrganizationsPage', () => {
  it('lists organizations and filters them by status', async () => {
    signIn('OPERATOR');
    const api = stubApi().on('GET', /\/platform\/organizations$/, page);
    await renderWithProviders(<OrganizationsPage />);

    const link = await screen.findByRole('link', { name: 'Burger House Group' });
    expect(link).toHaveAttribute('href', `/organizations/${OID}`);
    expect(screen.getByRole('table')).toHaveTextContent('burger-house-group');
    expect(screen.getByRole('table')).toHaveTextContent('Suspended');
    expect(screen.getByRole('table')).toHaveTextContent('ILS');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'SUSPENDED');
    await waitFor(() => {
      expect(api.calls.some((c) => c.path.includes('status=SUSPENDED'))).toBe(true);
    });
  });

  it('creates an organization with its first owner', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', /\/platform\/organizations$/, page)
      .on('POST', /\/platform\/organizations$/, organizationDetail);
    await renderWithProviders(<OrganizationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create organization' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Web address name'), 'burger-house-group');
    await userEvent.type(within(dialog).getByLabelText('Name (English)'), 'Burger House Group');
    await userEvent.type(within(dialog).getByLabelText('Name (Arabic)'), 'مجموعة بيت البرغر');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Currency/), 'USD');
    await userEvent.type(within(dialog).getByLabelText('Owner email'), 'owner@burger.test');
    await userEvent.type(within(dialog).getByLabelText('Owner name'), 'Dana Owner');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        slug: 'burger-house-group',
        nameEn: 'Burger House Group',
        nameAr: 'مجموعة بيت البرغر',
        currencyCode: 'USD',
        // No password: the person may already have an account.
        owner: { email: 'owner@burger.test', displayName: 'Dana Owner' },
      });
    });
  });

  it('shows a translated message when the address is taken', async () => {
    signIn('OWNER');
    stubApi()
      .on('GET', /\/platform\/organizations$/, page)
      .on('POST', /\/platform\/organizations$/, () => apiError('ORGANIZATION_SLUG_TAKEN'));
    await renderWithProviders(<OrganizationsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create organization' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Web address name'), 'burger-house-group');
    await userEvent.type(within(dialog).getByLabelText('Name (English)'), 'Burger House Group');
    await userEvent.type(within(dialog).getByLabelText('Name (Arabic)'), 'مجموعة');
    await userEvent.type(within(dialog).getByLabelText('Owner email'), 'owner@burger.test');
    await userEvent.type(within(dialog).getByLabelText('Owner name'), 'Dana Owner');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText(/address is already taken/i)).toBeInTheDocument();
  });

  it('offers no create button to a viewer', async () => {
    signIn('VIEWER');
    stubApi().on('GET', /\/platform\/organizations$/, page);
    await renderWithProviders(<OrganizationsPage />);
    await screen.findByRole('link', { name: 'Burger House Group' });
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
  });

  it('renders right to left in Arabic', async () => {
    signIn('SUPPORT');
    stubApi().on('GET', /\/platform\/organizations$/, page);
    await renderWithProviders(<OrganizationsPage />, { locale: 'ar' });
    expect(await screen.findByRole('link', { name: 'مجموعة بيت البرغر' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('table')).toHaveTextContent('موقوفة');
    expect(screen.queryByRole('button', { name: 'إنشاء مؤسسة' })).not.toBeInTheDocument();
  });
});
