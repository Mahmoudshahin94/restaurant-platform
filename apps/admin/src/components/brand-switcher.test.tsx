import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { Toaster } from '@pos/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG, PIZZA, RID, signIn, stubApi } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';
import { BrandSwitcher } from './brand-switcher';

const burger = {
  id: RID,
  nameEn: 'Burger House',
  nameAr: 'بيت البرغر',
  logoFileId: null,
  organizationId: ORG,
};
const pizza = {
  id: PIZZA,
  nameEn: 'Pizza Point',
  nameAr: 'بيتزا بوينت',
  logoFileId: null,
  organizationId: ORG,
};
const group = { id: ORG, nameEn: 'Demo Group', nameAr: 'مجموعة العرض', role: 'OWNER' as const };

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('brand switcher', () => {
  it('lists the organization overview and both brands, with the current brand checked', async () => {
    signIn(undefined, null, { tenants: [burger, pizza], organizations: [group] });
    stubApi();
    await renderWithProviders(<BrandSwitcher />);
    await userEvent.click(screen.getByRole('button', { name: /Burger House/ }));
    expect(screen.getByText('Demo Group')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Organization overview' })).not.toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Burger House/ })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Pizza Point/ })).not.toBeChecked();
  });

  it('switches brand: replaces the session, clears the query cache and goes to the dashboard', async () => {
    const user = signIn(undefined, null, { tenants: [burger, pizza], organizations: [group] });
    const api = stubApi().on('POST', /\/auth\/switch$/, {
      accessToken: 'second-token',
      expiresIn: 900,
      user: { ...user, tenantId: PIZZA },
    });
    const client = new QueryClient();
    client.setQueryData(['users', RID], ['cached']);
    usePreferences.getState().setLocationId('location-of-the-old-brand');
    await renderWithProviders(
      <>
        <BrandSwitcher />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      { client, route: '/settings/taxes' },
    );
    await userEvent.click(screen.getByRole('button', { name: /Burger House/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Pizza Point/ }));
    await vi.waitFor(() => {
      expect(useSession.getState().user?.tenantId).toBe(PIZZA);
    });
    expect(api.calls.find((c) => c.path.endsWith('/auth/switch'))?.body).toEqual({
      tenantId: PIZZA,
    });
    expect(useSession.getState().accessToken).toBe('second-token');
    expect(client.getQueryData(['users', RID])).toBeUndefined();
    expect(usePreferences.getState().locationId).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('stays and shows the translated error when the switch fails', async () => {
    signIn(undefined, null, { tenants: [burger, pizza], organizations: [group] });
    stubApi().on('POST', /\/auth\/switch$/, () => ({
      status: 404,
      body: { code: 'ORGANIZATION_NOT_FOUND', message: 'x', details: {} },
    }));
    await renderWithProviders(
      <>
        <BrandSwitcher />
        <Toaster closeLabel="Close" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
      { route: '/settings/taxes' },
    );
    await userEvent.click(screen.getByRole('button', { name: /Burger House/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Pizza Point/ }));
    expect(await screen.findByText('Could not switch brand')).toBeInTheDocument();
    expect(screen.getByText('Organization not found.')).toBeInTheDocument();
    expect(useSession.getState().user?.tenantId).toBe(RID);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/taxes');
  });

  it('opens the organization overview', async () => {
    signIn(undefined, null, { tenants: [burger, pizza], organizations: [group] });
    stubApi();
    await renderWithProviders(
      <>
        <BrandSwitcher />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Burger House/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Organization overview' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/org/${ORG}`);
  });

  it('shows just the brand name, without a menu, for a one-brand session', async () => {
    signIn();
    stubApi();
    await renderWithProviders(<BrandSwitcher />);
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the brand in Arabic', async () => {
    signIn(undefined, null, { tenants: [burger, pizza], organizations: [group] });
    stubApi();
    await renderWithProviders(<BrandSwitcher />, { locale: 'ar' });
    expect(screen.getByRole('button', { name: /بيت البرغر/ })).toBeInTheDocument();
  });
});
