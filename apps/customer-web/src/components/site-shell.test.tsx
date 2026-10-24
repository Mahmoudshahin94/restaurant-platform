import { useMoneyFormat } from '@pos/app-kit';
import type { Locale } from '@pos/shared-types';
import { resolveCurrency } from '@pos/domain';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreferences } from '../stores/preferences';
import { publicTenant } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { SiteShell } from './site-shell';

function serve(tenant: ReturnType<typeof publicTenant>) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify(tenant), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

function Price() {
  return <output>{useMoneyFormat('ILS').format(4000)}</output>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  usePreferences.setState({ locale: null });
  document.documentElement.removeAttribute('dir');
});

/** The shell with a page that shows a price, as the store's pages do. */
const render = (stored: Locale | null = null) => {
  usePreferences.setState({ locale: stored });
  return renderWithProviders(
    <Routes>
      <Route element={<SiteShell />}>
        <Route index element={<Price />} />
      </Route>
    </Routes>,
  );
};

describe("the website follows the store's languages (ADR 0020)", () => {
  it("starts in the store's default language when the visitor chose none", async () => {
    serve(publicTenant('ar', ['en', 'ar']));
    const { i18n } = await render();
    await waitFor(() => {
      expect(i18n.language).toBe('ar');
    });
    expect(document.documentElement.dir).toBe('rtl');
    const switcher = screen.getByRole('combobox', { name: 'اللغة' });
    expect([...switcher.querySelectorAll('option')].map((o) => o.value)).toEqual(['en', 'ar']);
  });

  it("keeps the visitor's own choice when the store offers it", async () => {
    serve(publicTenant('ar', ['en', 'ar']));
    const { i18n } = await render('en');
    expect(await screen.findByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(i18n.language).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('hides the switcher for a single-language store, whatever the visitor chose', async () => {
    serve(publicTenant('ar', ['ar']));
    const { i18n } = await render('en');
    await waitFor(() => {
      expect(i18n.language).toBe('ar');
    });
    expect(screen.queryByRole('combobox', { name: /Language|اللغة/ })).not.toBeInTheDocument();
  });

  it("shows prices in shekels with ₪, in the store's currency display", async () => {
    serve(publicTenant('en', ['en']));
    await render();
    expect(await screen.findByRole('status')).toHaveTextContent('₪40.00');
    cleanup();
    serve({ ...publicTenant('en', ['en']), currency: resolveCurrency('ILS', { display: 'code' }) });
    await render();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('ILS 40.00');
    });
  });
});
