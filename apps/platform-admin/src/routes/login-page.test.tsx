import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../lib/api';
import { stubApi } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { LoginPage } from './login-page';

beforeEach(() => {
  useSession.setState({ status: 'anonymous', accessToken: null, user: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('signs in at the platform endpoint and shows a localized error', async () => {
    const api = stubApi().on('POST', /\/platform\/auth\/login$/, () => ({
      status: 401,
      body: { code: 'INVALID_CREDENTIALS', message: 'nope', details: {} },
    }));
    await renderWithProviders(<LoginPage />, { route: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'ops@madar.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/email or password/i);
    expect(api.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/api/v1/platform/auth/login',
      body: { email: 'ops@madar.test', password: 'wrong-password' },
    });
  });

  it('says when sign-in attempts are rate limited, in Arabic', async () => {
    stubApi().on('POST', /\/platform\/auth\/login$/, () => ({
      status: 429,
      body: { code: 'RATE_LIMITED', message: 'slow down', details: {} },
    }));
    await renderWithProviders(<LoginPage />, { route: '/login', locale: 'ar' });
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    await userEvent.type(screen.getByLabelText('البريد الإلكتروني'), 'ops@madar.test');
    await userEvent.type(screen.getByLabelText('كلمة المرور'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('محاولات كثيرة جدًا');
  });
});
