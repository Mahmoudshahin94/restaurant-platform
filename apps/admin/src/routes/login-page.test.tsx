import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../stores/session';
import { renderWithProviders } from '../test/render';
import { LoginPage } from './login-page';

afterEach(() => {
  vi.unstubAllGlobals();
  useSession.setState({ status: 'unknown', accessToken: null, user: null });
});

describe('LoginPage', () => {
  it('validates in the active language before calling the API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await renderWithProviders(<LoginPage />, { locale: 'ar', route: '/login' });
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
    expect(await screen.findAllByText('هذا الحقل مطلوب')).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the translated server error for bad credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: 'INVALID_CREDENTIALS', message: 'no', details: {} }),
            { status: 401 },
          ),
        ),
      ),
    );
    await renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });
});
