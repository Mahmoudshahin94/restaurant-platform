import type { PaymentProviderAccount, PaymentProvidersOverview } from '@pos/validation';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOC, signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { PaymentProvidersPage } from './payment-providers-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ACCOUNT_ID = '01a146e8-0000-7000-8000-0000000000c1';

const catalog: PaymentProvidersOverview['catalog'] = [
  {
    key: 'mock-online',
    method: 'ONLINE',
    modes: ['TEST'],
    builtIn: false,
    devOnly: true,
    publicFields: [{ name: 'statementDescriptor', required: false }],
    secretFields: [{ name: 'secretKey', required: false, hint: 'sk_test_…' }],
  },
  {
    key: 'mock-terminal',
    method: 'TERMINAL',
    modes: ['TEST'],
    builtIn: false,
    devOnly: true,
    publicFields: [{ name: 'terminalLabel', required: false }],
    secretFields: [],
  },
];

const account: PaymentProviderAccount = {
  id: ACCOUNT_ID,
  locationId: null,
  method: 'ONLINE',
  providerKey: 'mock-online',
  mode: 'TEST',
  status: 'ACTIVE',
  publicConfig: { statementDescriptor: 'DEMO' },
  secret: { hasSecret: true, fingerprint: 'a1b2c3d4e5f6', updatedAt: '2026-10-27T10:00:00.000Z' },
  createdAt: '2026-10-27T10:00:00.000Z',
  updatedAt: '2026-10-27T10:00:00.000Z',
};

const overview = (accounts: PaymentProviderAccount[]): PaymentProvidersOverview => ({
  catalog,
  accounts,
  effective: [
    {
      locationId: LOC,
      method: 'ONLINE',
      providerKey: accounts.length ? 'mock-online' : null,
      mode: accounts.length ? 'TEST' : null,
      accountId: accounts[0]?.id ?? null,
      source: accounts.length ? 'TENANT' : 'PLATFORM',
    },
    {
      locationId: LOC,
      method: 'TERMINAL',
      providerKey: null,
      mode: null,
      accountId: null,
      source: 'PLATFORM',
    },
  ],
});

describe('payment providers page', () => {
  it('shows each account with its test-mode badge and only the fingerprint of its secret', async () => {
    signIn();
    stubApi().on('GET', /\/payment-providers$/, overview([account]));
    await renderWithProviders(<PaymentProvidersPage />);
    const row = (await screen.findByRole('cell', { name: 'Test card gateway' })).closest('tr');
    if (!row) throw new Error('no row');
    expect(within(row).getByText('Test mode')).toBeInTheDocument();
    expect(within(row).getByText('Whole business')).toBeInTheDocument();
    expect(within(row).getByText('Stored')).toBeInTheDocument();
    expect(within(row).getByText('a1b2c3d4e5f6')).toBeInTheDocument();
    // What is in effect where: cards online from the business-wide account, no kiosk reader.
    expect(screen.getByText('None: pay at the counter')).toBeInTheDocument();
    expect(screen.getByText('Business-wide')).toBeInTheDocument();
  });

  it('adds a provider with a masked secret that is sent once and never shown again', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/payment-providers$/, overview([]))
      .on('POST', /\/payment-providers$/, { body: account });
    await renderWithProviders(<PaymentProvidersPage />);
    expect(await screen.findByText(/No providers yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add provider' }));
    const dialog = await screen.findByRole('dialog');
    const secret = within(dialog).getByLabelText('Secret key');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveAttribute('autocomplete', 'new-password');
    await userEvent.type(within(dialog).getByLabelText('Statement descriptor'), 'DEMO');
    await userEvent.type(secret, 'sk_test_12345678');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        method: 'ONLINE',
        providerKey: 'mock-online',
        locationId: null,
        mode: 'TEST',
        publicConfig: { statementDescriptor: 'DEMO' },
        status: 'ACTIVE',
        secrets: { secretKey: 'sk_test_12345678' },
      });
    });
  });

  it('edits without resending the stored secret unless a new one is typed', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/payment-providers$/, overview([account]))
      .on('PATCH', /\/payment-providers\/[^/]+$/, { body: { ...account, status: 'DISABLED' } });
    await renderWithProviders(<PaymentProvidersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Test card gateway' }));
    const dialog = await screen.findByRole('dialog');
    const secret = within(dialog).getByLabelText('Secret key');
    expect(secret).toHaveValue('');
    expect(secret).toHaveAttribute('placeholder', 'Stored — leave empty to keep');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Enabled' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        mode: 'TEST',
        publicConfig: { statementDescriptor: 'DEMO' },
        status: 'DISABLED',
      });
    });
  });

  it('is translated into Arabic', async () => {
    signIn();
    stubApi().on('GET', /\/payment-providers$/, overview([account]));
    await renderWithProviders(<PaymentProvidersPage />, { locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'مزوّدو الدفع' })).toBeInTheDocument();
    expect((await screen.findAllByText('وضع تجريبي')).length).toBeGreaterThan(0);
    expect(screen.getByText('لا شيء: الدفع عند الكاشير')).toBeInTheDocument();
  });
});
