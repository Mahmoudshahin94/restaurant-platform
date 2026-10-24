import type { ApiClient } from '@pos/api-client';
import type { Locale } from '@pos/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { i18n as I18nInstance } from 'i18next';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageSwitcher } from './components/language-switcher';
import { setupReactI18n } from './i18n';
import { LocalizationProvider, useLocaleSelection } from './localization';
import { useMoneyFormat } from './money';
import { TenantContextProvider, TenantProvider, tenantContextFixture } from './tenant-context';
import { ThemeProvider } from './theme/theme-provider';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
});

async function withI18n(locale: Locale, ui: ReactNode): Promise<I18nInstance> {
  const i18n = await setupReactI18n(locale);
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
  return i18n;
}

/** A tenant context offering `supported`, defaulting to `defaultLocale` (ADR 0020). */
const tenantWith = (defaultLocale: Locale, supported: Locale[], extra = {}) =>
  tenantContextFixture({}, null, {}, null, {
    locales: { defaultLocale, supportedLocales: supported },
    ...extra,
  });

describe('LanguageSwitcher (ADR 0020)', () => {
  it("offers only the tenant's languages", async () => {
    await withI18n(
      'en',
      <TenantContextProvider value={tenantWith('en', ['en', 'ar'])}>
        <LanguageSwitcher />
      </TenantContextProvider>,
    );
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options).toEqual(['en', 'ar']);
  });

  it('is hidden for a single-locale tenant', async () => {
    await withI18n(
      'ar',
      <TenantContextProvider value={tenantWith('ar', ['ar'])}>
        <LanguageSwitcher />
      </TenantContextProvider>,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers every platform locale before there is a tenant, or the locales it is given', async () => {
    await withI18n(
      'en',
      <>
        <LanguageSwitcher />
        <LanguageSwitcher locales={['en']} />
      </>,
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });

  it('switches the language, its direction, and reports the choice', async () => {
    const chosen = vi.fn();
    const i18n = await withI18n(
      'en',
      <TenantContextProvider value={tenantWith('en', ['en', 'ar'])}>
        <LanguageSwitcher onLocaleChange={chosen} />
      </TenantContextProvider>,
    );
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ar' } });
      await Promise.resolve();
    });
    expect(chosen).toHaveBeenCalledWith('ar');
    expect(i18n.language).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

function Selector(props: {
  locales: ReturnType<typeof tenantWith>['locales'] | undefined;
  stored: Locale | null;
  preferred: Locale | null;
}) {
  useLocaleSelection(props.locales, { stored: props.stored, preferred: props.preferred });
  return null;
}

describe('useLocaleSelection: the screen language and direction per supported-locale set', () => {
  it.each([
    // [supported, default, stored, preferred, expected language, direction]
    [['en', 'ar'], 'en', 'ar', 'en', 'ar', 'rtl'],
    [['en', 'ar'], 'en', null, 'ar', 'ar', 'rtl'],
    [['en', 'ar'], 'ar', null, null, 'ar', 'rtl'],
    [['en', 'ar'], 'ar', 'en', null, 'en', 'ltr'],
    [['ar'], 'ar', 'en', 'en', 'ar', 'rtl'],
    [['en'], 'en', 'ar', 'ar', 'en', 'ltr'],
  ] as const)(
    'supported %j, default %s, stored %s, preferred %s → %s (%s)',
    async (supported, defaultLocale, stored, preferred, expected, dir) => {
      const start: Locale = expected === 'ar' ? 'en' : 'ar';
      const i18n = await withI18n(
        start,
        <Selector
          locales={tenantWith(defaultLocale, [...supported]).locales}
          stored={stored}
          preferred={preferred}
        />,
      );
      expect(i18n.language).toBe(expected);
      expect(document.documentElement.lang).toBe(expected);
      expect(document.documentElement.dir).toBe(dir);
    },
  );

  it('waits for the tenant: without locales the language stays', async () => {
    const i18n = await withI18n('ar', <Selector locales={undefined} stored="en" preferred="en" />);
    expect(i18n.language).toBe('ar');
  });
});

describe('TenantProvider applies the locale rule once the context has loaded', () => {
  it("starts in the user's preferred locale when the device chose nothing", async () => {
    const context = vi.fn(() => Promise.resolve(tenantWith('en', ['en', 'ar'])));
    const api = { tenants: { context } } as unknown as ApiClient;
    const i18n = await setupReactI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider app="admin">
            <TenantProvider api={api} tenantId="t" locale={{ stored: null, preferred: 'ar' }}>
              <p>ready</p>
            </TenantProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByText('ready')).toBeInTheDocument();
    expect(i18n.language).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

function Price({ minor, currency }: { minor: number; currency?: string }) {
  const { format } = useMoneyFormat(currency);
  return <output>{format(minor)}</output>;
}

describe("useMoneyFormat with the tenant's currency configuration", () => {
  const NBSP = '\u00a0';

  it('shows the shekel as ₪ in English and Arabic', async () => {
    const i18n = await withI18n(
      'en',
      <TenantContextProvider value={tenantWith('en', ['en', 'ar'])}>
        <Price minor={1850} />
      </TenantContextProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('₪18.50');
    await act(() => i18n.changeLanguage('ar'));
    expect(screen.getByRole('status').textContent).toBe(`\u200f18.50${NBSP}₪`);
  });

  it("applies the tenant's symbol, display and digits", async () => {
    const value = tenantWith('ar', ['ar'], {
      currencyCode: 'JOD',
      currency: { symbol: 'JD' },
      locales: { defaultLocale: 'ar', supportedLocales: ['ar'], digits: 'arab' },
    });
    await withI18n(
      'ar',
      <TenantContextProvider value={value}>
        <Price minor={12_345} currency="JOD" />
      </TenantContextProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('١٢٫٣٤٥ JD');
  });

  it("formats another currency with MADAR's defaults, and waits for an unknown one", async () => {
    await withI18n(
      'en',
      <LocalizationProvider>
        <Price minor={1850} currency="USD" />
        <Price minor={1850} />
      </LocalizationProvider>,
    );
    const [usd, unknown] = screen.getAllByRole('status');
    expect(usd).toHaveTextContent('$18.50');
    expect(unknown).toHaveTextContent('1850');
  });
});
