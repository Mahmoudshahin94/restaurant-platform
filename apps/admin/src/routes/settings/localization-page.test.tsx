import { resolveCurrency, resolveLocales } from '@pos/domain';
import type { TenantLocalizationDto, UpdateLocalizationRequest } from '@pos/validation';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { LocalizationPage } from './localization-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NBSP = '\u00a0';

function localization(settings: Partial<UpdateLocalizationRequest> = {}): TenantLocalizationDto {
  const s: TenantLocalizationDto['settings'] = {
    defaultLocale: 'en',
    supportedLocales: ['en', 'ar'],
    digits: null,
    currencySymbol: null,
    currencyDisplay: null,
    currencyFormatLocale: null,
    ...settings,
  };
  return {
    settings: s,
    currency: resolveCurrency('ILS', {
      symbol: s.currencySymbol,
      display: s.currencyDisplay,
      formatLocale: s.currencyFormatLocale,
    }),
    locales: resolveLocales({
      defaultLocale: s.defaultLocale,
      supportedLocales: s.supportedLocales,
      digits: s.digits,
    }),
    updatedAt: '2026-10-24T00:00:00.000Z',
  };
}

describe('language and currency page (ADR 0020)', () => {
  it('shows the currency read-only and previews amounts in both languages', async () => {
    signIn();
    stubApi().on('GET', /\/localization$/, localization());
    await renderWithProviders(<LocalizationPage />);

    expect(await screen.findByRole('textbox', { name: 'Currency' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Decimal places' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Symbol' })).toHaveAttribute('placeholder', '₪');
    expect(screen.getByTestId('preview-en')).toHaveTextContent('₪1,234.56');
    expect(screen.getByTestId('preview-ar').textContent).toBe(`\u200f1,234.56${NBSP}₪`);
  });

  it('saves one language, Arabic digits and a symbol, previewing them as typed', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/localization$/, localization())
      .on('PUT', /\/localization$/, (body) => ({
        body: localization(body as UpdateLocalizationRequest),
      }));
    await renderWithProviders(<LocalizationPage />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'English' }));
    // The default follows: Arabic is the only language left, and it cannot be removed too.
    expect(screen.getByRole('combobox', { name: 'Default language' })).toHaveValue('ar');
    expect(screen.getByRole('checkbox', { name: 'العربية' })).toBeDisabled();
    expect(screen.getByText(/hide the language switcher/)).toBeInTheDocument();
    expect(screen.queryByTestId('preview-en')).not.toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Digits in Arabic' }),
      'arab',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Symbol' }), 'NIS');
    expect(screen.getByTestId('preview-ar')).toHaveTextContent('١٬٢٣٤٫٥٦ NIS');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/^Saved\./)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      defaultLocale: 'ar',
      supportedLocales: ['ar'],
      digits: 'arab',
      currencySymbol: 'NIS',
      currencyDisplay: null,
      currencyFormatLocale: null,
    });
  });

  it('flags a symbol with digits before saving', async () => {
    signIn();
    stubApi().on('GET', /\/localization$/, localization());
    await renderWithProviders(<LocalizationPage />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Symbol' }), '5₪');
    expect(screen.getByText('Up to 8 characters, without digits.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('reads in Arabic, right to left', async () => {
    signIn();
    stubApi().on('GET', /\/localization$/, localization({ currencyDisplay: 'code' }));
    await renderWithProviders(<LocalizationPage />, { locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'اللغة والعملة' })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'عرض العملة على شكل' })).toHaveValue('code');
    expect(screen.getByTestId('preview-en')).toHaveTextContent('ILS 1,234.56');
    expect(screen.getByTestId('preview-ar').closest('[dir]')).toHaveAttribute('dir', 'rtl');
  });
});
