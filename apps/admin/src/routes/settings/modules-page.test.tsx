import { featureLayersFromRows, featureSettings } from '@pos/domain';
import type { FeatureSetting } from '@pos/shared-types';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOC, signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { ModulesPage } from './modules-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page's rows as the API computes them, from override rows like the database's. */
function settings(
  overrides: { feature: string; enabled: boolean; locationId: string | null }[],
  locationId: string | null,
  entitlements = [{ feature: 'LOYALTY', entitled: false, tenantConfigurable: true }],
): FeatureSetting[] {
  const layers = featureLayersFromRows({
    businessType: 'RESTAURANT',
    entitlements,
    overrides: overrides.map((o) => ({ ...o, deviceId: null })),
    locationId,
  });
  return featureSettings(layers, locationId ? 'LOCATION' : 'TENANT');
}

describe('modules page', () => {
  it('lists the configurable modules with their inherited value and source', async () => {
    signIn();
    stubApi().on(
      'GET',
      /\/features$/,
      settings([{ feature: 'TABLES', enabled: false, locationId: null }], null),
    );
    await renderWithProviders(<ModulesPage />);
    const kitchen = await screen.findByRole('region', { name: 'Kitchen display' });
    expect(within(kitchen).getByText('From: Business type default')).toBeInTheDocument();
    expect(within(kitchen).getByRole('radio', { name: 'Inherit (On)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const tables = screen.getByRole('region', { name: 'Tables' });
    expect(within(tables).getByText('From: Business setting')).toBeInTheDocument();
    expect(within(tables).getByRole('radio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Outside the plan: not offered at all.
    expect(screen.queryByRole('region', { name: 'Loyalty' })).not.toBeInTheDocument();
  });

  it('switches a module for one location and lets it inherit again', async () => {
    signIn();
    // A small stand-in for the API: overrides are kept, and each scope sees its own.
    let rows: { feature: string; enabled: boolean; locationId: string | null }[] = [];
    const scopeOf = (path: string) => new URLSearchParams(path.split('?')[1]).get('locationId');
    const api = stubApi()
      .on('GET', /\/features$/, () => ({
        body: settings(rows, scopeOf(api.calls.at(-1)?.path ?? '')),
      }))
      .on('PUT', /\/features\/KDS$/, (body) => {
        const { enabled, locationId } = body as { enabled: boolean | null; locationId: string };
        rows = rows.filter((r) => r.locationId !== locationId);
        if (enabled !== null) rows.push({ feature: 'KDS', enabled, locationId });
        return { body: settings(rows, locationId) };
      });
    await renderWithProviders(<ModulesPage />);
    await screen.findByRole('region', { name: 'Kitchen display' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Applies to' }), LOC);
    await vi.waitFor(() => {
      expect(api.calls.some((c) => c.path.includes(`locationId=${LOC}`))).toBe(true);
    });

    const kitchen = await screen.findByRole('region', { name: 'Kitchen display' });
    await userEvent.click(within(kitchen).getByRole('radio', { name: 'Off' }));
    await vi.waitFor(() => {
      expect(within(kitchen).getByText('From: Location setting')).toBeInTheDocument();
    });
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
        locationId: LOC,
        enabled: false,
      });
    });
    await userEvent.click(within(kitchen).getByRole('radio', { name: /Inherit/ }));
    await vi.waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({
        locationId: LOC,
        enabled: null,
      });
    });
  });

  it('is translated into Arabic', async () => {
    signIn();
    stubApi().on('GET', /\/features$/, settings([], null));
    await renderWithProviders(<ModulesPage />, { locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'الوحدات' })).toBeInTheDocument();
    const kitchen = await screen.findByRole('region', { name: 'شاشة المطبخ' });
    expect(within(kitchen).getByText('المصدر: افتراضي نوع النشاط')).toBeInTheDocument();
  });
});
