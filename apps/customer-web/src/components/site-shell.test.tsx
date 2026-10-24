import { useMoneyFormat } from '@pos/app-kit';
import type { Locale } from '@pos/shared-types';
import { resolveCurrency } from '@pos/domain';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreferences } from '../stores/preferences';
import { publicSite } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { SiteShell } from './site-shell';

function serve(tenant: ReturnType<typeof publicSite>) {
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
  return <output data-testid="price">{useMoneyFormat('ILS').format(4000)}</output>;
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

describe('the site of the host (ADR 0023)', () => {
  it('waits for the site before rendering its pages, and says when there is none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'SITE_NOT_FOUND', message: 'x', details: {} }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    await render();
    expect(await screen.findByText('This website was not found.')).toBeInTheDocument();
    expect(screen.queryByTestId('price')).not.toBeInTheDocument();
  });

  it('marks a preview of the draft', async () => {
    serve(publicSite('en', ['en'], { preview: true }));
    await render();
    expect(await screen.findByText(/Preview of unpublished changes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave preview' })).toBeInTheDocument();
  });

  it('shows the website’s navigation in the header', async () => {
    serve(publicSite('en', ['en']));
    await render();
    const nav = await screen.findByRole('navigation', { name: 'Site navigation' });
    expect(nav).toHaveTextContent('Branches');
  });
});

describe("the website follows the store's languages (ADR 0020)", () => {
  it("starts in the store's default language when the visitor chose none", async () => {
    serve(publicSite('ar', ['en', 'ar']));
    const { i18n } = await render();
    await waitFor(() => {
      expect(i18n.language).toBe('ar');
    });
    expect(document.documentElement.dir).toBe('rtl');
    const switcher = screen.getByRole('combobox', { name: 'اللغة' });
    expect([...switcher.querySelectorAll('option')].map((o) => o.value)).toEqual(['en', 'ar']);
  });

  it("keeps the visitor's own choice when the store offers it", async () => {
    serve(publicSite('ar', ['en', 'ar']));
    const { i18n } = await render('en');
    expect(await screen.findByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(i18n.language).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('hides the switcher for a single-language store, whatever the visitor chose', async () => {
    serve(publicSite('ar', ['ar']));
    const { i18n } = await render('en');
    await waitFor(() => {
      expect(i18n.language).toBe('ar');
    });
    expect(screen.queryByRole('combobox', { name: /Language|اللغة/ })).not.toBeInTheDocument();
  });

  it("shows prices in shekels with ₪, in the store's currency display", async () => {
    serve(publicSite('en', ['en']));
    await render();
    expect(await screen.findByTestId('price')).toHaveTextContent('₪40.00');
    cleanup();
    serve({ ...publicSite('en', ['en']), currency: resolveCurrency('ILS', { display: 'code' }) });
    await render();
    await waitFor(() => {
      expect(screen.getByTestId('price')).toHaveTextContent('ILS 40.00');
    });
  });
});
