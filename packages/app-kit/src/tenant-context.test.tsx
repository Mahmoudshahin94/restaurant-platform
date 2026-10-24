import type { ApiClient } from '@pos/api-client';
import { Feature } from '@pos/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeatureGate,
  TenantContextProvider,
  TenantProvider,
  tenantContextFixture,
  useFeature,
} from './tenant-context';
import { setupReactI18n } from './i18n';
import { ThemeProvider } from './theme/theme-provider';

afterEach(cleanup);

function KitchenLabel() {
  return <p>{useFeature(Feature.KDS) ? 'kitchen on' : 'kitchen off'}</p>;
}

const withContext = (features: Parameters<typeof tenantContextFixture>[0], ui: ReactNode) =>
  render(
    <TenantContextProvider value={tenantContextFixture(features)}>{ui}</TenantContextProvider>,
  );

describe('useFeature and FeatureGate', () => {
  it('follow the resolved modules', () => {
    withContext(
      { TABLES: false },
      <>
        <KitchenLabel />
        <FeatureGate feature={Feature.TABLES} fallback={<p>no tables</p>}>
          <p>tables</p>
        </FeatureGate>
        <FeatureGate feature={[Feature.KDS, Feature.MODIFIERS]}>
          <p>kitchen and modifiers</p>
        </FeatureGate>
      </>,
    );
    expect(screen.getByText('kitchen on')).toBeInTheDocument();
    expect(screen.getByText('no tables')).toBeInTheDocument();
    expect(screen.queryByText('tables')).not.toBeInTheDocument();
    expect(screen.getByText('kitchen and modifiers')).toBeInTheDocument();
  });

  it('hide a gate when any listed module is off', () => {
    withContext(
      { MODIFIERS: false },
      <FeatureGate feature={[Feature.KDS, Feature.MODIFIERS]}>
        <p>kitchen and modifiers</p>
      </FeatureGate>,
    );
    expect(screen.queryByText('kitchen and modifiers')).not.toBeInTheDocument();
  });

  it('refuse to guess outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<KitchenLabel />)).toThrow(/TenantProvider/);
  });
});

describe('TenantProvider', () => {
  it('renders its children once the context has loaded', async () => {
    const context = vi.fn(() => Promise.resolve(tenantContextFixture({ KDS: false }, 'loc')));
    const api = { tenants: { context } } as unknown as ApiClient;
    const i18n = await setupReactI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <ThemeProvider app="kds" surface="kds">
            <TenantProvider api={api} tenantId="tenant" locationId="loc">
              <KitchenLabel />
            </TenantProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(screen.queryByText(/kitchen/)).not.toBeInTheDocument();
    expect(await screen.findByText('kitchen off')).toBeInTheDocument();
    // The branding asked for is the surface of the ThemeProvider above (ADR 0019).
    expect(context).toHaveBeenCalledWith('tenant', 'loc', 'kds');
  });
});
