import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { useSession } from '../stores/session';
import { UserMenu } from './user-menu';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('user menu', () => {
  it('shows who is signed in and offers language, theme and sign out', async () => {
    signIn();
    stubApi();
    await renderWithProviders(<UserMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Account/ }));
    expect(screen.getByText('owner@test.local')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'العربية' })).not.toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Business default' })).toBeChecked();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('switches the language', async () => {
    signIn();
    stubApi();
    const { i18n } = await renderWithProviders(<UserMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Account/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'العربية' }));
    expect(i18n.language).toBe('ar');
  });

  it('signs out and goes to the sign-in page', async () => {
    signIn();
    stubApi().on('POST', /\/auth\/logout$/, { status: 204 });
    await renderWithProviders(
      <>
        <UserMenu />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Account/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await vi.waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/login');
    });
    expect(useSession.getState().status).toBe('anonymous');
  });
});
