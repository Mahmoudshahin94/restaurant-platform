import { tenantContextFixture } from '@pos/app-kit';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { usePreferences } from '../stores/preferences';
import { TenantScope } from './tenant-scope';

afterEach(() => {
  vi.unstubAllGlobals();
  usePreferences.getState().setLocationId(null);
});

describe('tenant scope', () => {
  it("drops a remembered location that is not the brand's and shows the default instead", async () => {
    signIn();
    usePreferences.getState().setLocationId('location-of-another-brand');
    const api = stubApi().on('GET', /\/tenants\/[^/]+\/context$/, () => {
      const asked = api.calls.at(-1)?.path ?? '';
      return asked.includes('locationId=')
        ? { status: 404, body: { code: 'LOCATION_NOT_FOUND', message: 'x', details: {} } }
        : { body: tenantContextFixture() };
    });
    await renderWithProviders(
      <TenantScope>
        <p>Brand page</p>
      </TenantScope>,
    );
    expect(await screen.findByText('Brand page')).toBeInTheDocument();
    expect(usePreferences.getState().locationId).toBeNull();
  });

  it('keeps a location of the brand', async () => {
    signIn();
    usePreferences.getState().setLocationId('01a146e8-0000-7000-8000-000000000002');
    stubApi().on('GET', /\/tenants\/[^/]+\/context$/, tenantContextFixture());
    await renderWithProviders(
      <TenantScope>
        <p>Brand page</p>
      </TenantScope>,
    );
    expect(await screen.findByText('Brand page')).toBeInTheDocument();
    expect(usePreferences.getState().locationId).toBe('01a146e8-0000-7000-8000-000000000002');
  });
});
