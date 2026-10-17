import { PERMISSIONS } from '@pos/shared-types';
import type { Role } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { RolesPage } from './roles-page';

const at = '2026-10-01T00:00:00.000Z';
const roles: Role[] = [
  {
    id: '01a146e8-0000-7000-8000-0000000000f1',
    name: 'Owner',
    description: 'Full access',
    isSystem: true,
    permissions: [...PERMISSIONS],
    userCount: 1,
    createdAt: at,
    updatedAt: at,
  },
  {
    id: '01a146e8-0000-7000-8000-0000000000f2',
    name: 'Cashier',
    description: null,
    isSystem: false,
    permissions: ['orders.view', 'orders.create'],
    userCount: 2,
    createdAt: at,
    updatedAt: at,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('roles page', () => {
  it('shows the permission matrix and protects the system role', async () => {
    signIn();
    stubApi().on('GET', /\/roles$/, roles);
    await renderWithProviders(<RolesPage />);
    const takeOrders = await screen.findByRole('row', { name: /Take orders/ });
    expect(within(takeOrders).getAllByLabelText('Yes')).toHaveLength(2);
    const refund = screen.getByRole('row', { name: /Refund payments/ });
    expect(within(refund).getAllByLabelText('Yes')).toHaveLength(1);
    expect(within(refund).getAllByLabelText('No')).toHaveLength(1);
    const owner = screen.getByRole('row', { name: /Owner System role/ });
    expect(within(owner).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('only offers permissions the editor holds, and saves the selection', async () => {
    signIn(['roles.manage', 'orders.view', 'orders.create', 'orders.update']);
    const api = stubApi()
      .on('GET', /\/roles$/, roles)
      .on('PATCH', /\/roles\/[^/]+$/, (body) => ({ body: { ...roles[1], ...(body as object) } }));
    await renderWithProviders(<RolesPage />);
    // The first match is the roles table; the matrix header lists the role too.
    const [cashier] = await screen.findAllByRole('row', { name: /^Cashier/ });
    if (!cashier) throw new Error('no Cashier row');
    await userEvent.click(within(cashier).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Refund payments' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Change orders' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        name: 'Cashier',
        permissions: ['orders.view', 'orders.create', 'orders.update'],
      });
    });
  });
});
