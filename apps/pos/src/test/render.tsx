import { TenantContextProvider, ThemeProvider, tenantContextFixture } from '@pos/app-kit';
import type { Feature, Locale } from '@pos/shared-types';
import { DirectionProvider } from '@pos/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { i18n as I18nInstance } from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { setupI18n } from '../i18n';

/**
 * Renders with real translations, router, query client and a restaurant's modules (`features`
 * overrides some) — no mocked i18n.
 */
export async function renderWithProviders(
  ui: ReactElement,
  {
    locale = 'en',
    route = '/',
    features = {},
  }: { locale?: Locale; route?: string; features?: Partial<Record<Feature, boolean>> } = {},
): Promise<RenderResult & { i18n: I18nInstance }> {
  const i18n = await setupI18n(locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <I18nextProvider i18n={i18n}>
      <DirectionProvider dir={i18n.dir(locale)}>
        <QueryClientProvider client={client}>
          <ThemeProvider app="pos" surface="pos">
            <TenantContextProvider value={tenantContextFixture(features)}>
              <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            </TenantContextProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </DirectionProvider>
    </I18nextProvider>,
  );
  return { ...result, i18n };
}
