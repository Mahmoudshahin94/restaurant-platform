import { ApiError } from '@pos/api-client';
import { initI18n } from '@pos/i18n';
import { MADAR_VERSION } from '@pos/shared-types';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformFooter } from './theme/platform-footer';
import { UpgradeRequiredGate, reportUpgradeRequired, useUpgradeRequired } from './upgrade';

afterEach(() => {
  cleanup();
  useUpgradeRequired.setState({ required: null });
});

async function renderIn(locale: 'en' | 'ar') {
  const i18n = await initI18n({ locale, plugins: [initReactI18next] });
  return render(
    <I18nextProvider i18n={i18n}>
      <UpgradeRequiredGate app="admin">
        <p>The app</p>
      </UpgradeRequiredGate>
    </I18nextProvider>,
  );
}

const refusal = () =>
  new ApiError('CLIENT_UPGRADE_REQUIRED', 'too old', 426, {
    minimumVersion: '9.0.0',
    version: '0.9.0',
  });

describe('an app the cloud no longer serves (ADR 0026)', () => {
  it('shows the app until the cloud refuses it, then what to install', async () => {
    await renderIn('en');
    expect(screen.getByText('The app')).toBeTruthy();
    act(() => {
      reportUpgradeRequired(refusal());
    });
    expect(screen.queryByText('The app')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Update required' })).toBeTruthy();
    expect(screen.getByText(/This version of MADAR Admin is no longer supported/)).toBeTruthy();
    // The version the cloud saw, and the one it requires.
    expect(screen.getByText('0.9.0')).toBeTruthy();
    expect(screen.getByText('9.0.0')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('says so in Arabic', async () => {
    await renderIn('ar');
    act(() => {
      reportUpgradeRequired(refusal());
    });
    expect(screen.getByRole('heading', { name: 'يلزم التحديث' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تحقّق مجددًا' })).toBeTruthy();
  });
});

describe('the platform footer', () => {
  it('shows the MADAR version this build is', async () => {
    const i18n = await initI18n({ locale: 'en', plugins: [initReactI18next] });
    render(
      <I18nextProvider i18n={i18n}>
        <PlatformFooter app="pos" />
      </I18nextProvider>,
    );
    expect(screen.getByText(`v${MADAR_VERSION}`).getAttribute('title')).toBe(
      `MADAR v${MADAR_VERSION}`,
    );
    expect(screen.getByText(/Powered by JudyTech/)).toBeTruthy();
  });
});
