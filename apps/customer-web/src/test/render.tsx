import type { Locale } from '@pos/shared-types';
import { DirectionProvider } from '@pos/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { i18n as I18nInstance } from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { setupI18n } from '../i18n';

/**
 * Renders with real translations, router and query client — no mocked i18n. With `path`, the
 * element is mounted on that route pattern (for pages reading URL params).
 */
export async function renderWithProviders(
  ui: ReactElement,
  { locale = 'en', route = '/', path }: { locale?: Locale; route?: string; path?: string } = {},
): Promise<RenderResult & { i18n: I18nInstance }> {
  const i18n = await setupI18n(locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <I18nextProvider i18n={i18n}>
      <DirectionProvider dir={i18n.dir(locale)}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>
            {path ? (
              <Routes>
                <Route path={path} element={ui} />
              </Routes>
            ) : (
              ui
            )}
          </MemoryRouter>
        </QueryClientProvider>
      </DirectionProvider>
    </I18nextProvider>,
  );
  return { ...result, i18n };
}
