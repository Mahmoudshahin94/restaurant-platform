import type { Role, StaffUser } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOC, signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { UsersPage } from './users-page';

const at = '2026-10-01T00:00:00.000Z';
const cashierRole: Role = {
  id: '01a146e8-0000-7000-8000-0000000000f2',
  name: 'Cashier',
  description: null,
  isSystem: false,
  permissions: ['orders.view'],
  userCount: 1,
  createdAt: at,
  updatedAt: at,
};
const sara: StaffUser = {
  id: '01a146e8-0000-7000-8000-0000000000a2',
  email: 'sara@test.local',
  displayName: 'Sara',
  preferredLocale: 'ar',
  isActive: true,
  lastLoginAt: null,
  roles: [{ roleId: cashierRole.id, roleName: 'Cashier', locationId: LOC }],
  employee: { id: '01a146e8-0000-7000-8000-0000000000a3', employeeCode: '1001' },
  managedByOrganization: false,
  createdAt: at,
  updatedAt: at,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('users page', () => {
  it('lists users with their roles per location', async () => {
    signIn();
    stubApi()
      .on('GET', /\/users$/, [sara])
      .on('GET', /\/roles$/, [cashierRole]);
    await renderWithProviders(<UsersPage />, { locale: 'ar' });
    const row = await screen.findByRole('row', { name: /Sara/ });
    expect(within(row).getByText('Cashier · الفرع الرئيسي')).toBeInTheDocument();
    expect(within(row).getByText('1001')).toBeInTheDocument();
    expect(within(row).getByText('أبدًا')).toBeInTheDocument(); // never signed in
  });

  it('shows why a deactivation was refused', async () => {
    signIn();
    stubApi()
      .on('GET', /\/users$/, [sara])
      .on('GET', /\/roles$/, [cashierRole])
      .on('PATCH', /\/users\/[^/]+$/, () => ({
        status: 409,
        body: { code: 'CONFLICT', message: 'x', details: { reason: 'LAST_OWNER' } },
      }));
    await renderWithProviders(<UsersPage />);
    const row = await screen.findByRole('row', { name: /Sara/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The business needs at least one active owner.',
    );
  });

  it('creates a user with a location role', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/users$/, [])
      .on('GET', /\/roles$/, [cashierRole])
      .on('POST', /\/users$/, (body) => ({ status: 201, body: { ...sara, ...(body as object) } }));
    await renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@test.local');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New Person');
    await userEvent.type(within(dialog).getByLabelText('Password'), 'long-enough-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add role' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Where'), LOC);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        email: 'new@test.local',
        displayName: 'New Person',
        preferredLocale: 'en',
        password: 'long-enough-1',
        roles: [{ roleId: cashierRole.id, locationId: LOC }],
      });
    });
    expect(JSON.stringify(api.calls.filter((c) => c.method === 'GET'))).not.toContain(
      'long-enough-1',
    );
  });
});
