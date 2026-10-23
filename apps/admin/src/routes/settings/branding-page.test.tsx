import { resolveBranding } from '@pos/domain';
import type { BrandingLayerDto, TenantBrandingDto } from '@pos/validation';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi, tenant } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { BrandingPage } from './branding-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NONE: BrandingLayerDto = {
  displayNameEn: null,
  displayNameAr: null,
  logoFileId: null,
  faviconFileId: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
  logoSize: null,
  themeMode: null,
  surfaceStyle: null,
  borderRadius: null,
};

function branding(values: Partial<BrandingLayerDto> = {}, surfaces = {}): TenantBrandingDto {
  const layer = { ...NONE, ...values };
  return {
    tenant: layer,
    surfaces,
    resolved: resolveBranding({ tenantNames: tenant, tenant: layer, surfaces }),
    files: [],
    updatedAt: null,
  };
}

describe('branding page', () => {
  it('saves colours, look and a screen override, and previews them', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/tenants\/[^/]+$/, tenant)
      .on('GET', /\/branding$/, branding())
      .on('PUT', /\/branding$/, (body) => ({ body: { ...branding(), ...(body as object) } }));
    await renderWithProviders(<BrandingPage />);

    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Primary colour (hex)' }),
      '#2563EB',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Light or dark' }), 'LIGHT');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cards' }), 'GLASS');
    // The kitchen display stays dark.
    await userEvent.click(screen.getByRole('tab', { name: 'Kitchen display' }));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Light or dark · Kitchen display' }),
      'DARK',
    );

    const preview = screen.getByTestId('branding-preview');
    expect(preview.style.getPropertyValue('--color-primary')).toBe('#2563eb');
    expect(preview.style.getPropertyValue('--color-primary-foreground')).toBe('#ffffff');
    expect(preview).toHaveAttribute('data-surface', 'glass');

    await userEvent.click(screen.getByRole('button', { name: 'Save branding' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        primaryColor: '#2563eb',
        themeMode: 'LIGHT',
        surfaceStyle: 'GLASS',
        surfaces: { kds: { themeMode: 'DARK' } },
      });
    });
    expect(await screen.findByText(/Branding saved/)).toBeInTheDocument();
  });

  it('flags an unreadable colour before saving', async () => {
    signIn();
    stubApi()
      .on('GET', /\/tenants\/[^/]+$/, tenant)
      .on('GET', /\/branding$/, branding());
    await renderWithProviders(<BrandingPage />);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Accent colour (hex)' }),
      '#111827',
    );
    expect(await screen.findByText(/Too dark for dark screens/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save branding' })).toBeDisabled();
  });

  it('is translated into Arabic and laid out right to left', async () => {
    signIn();
    stubApi()
      .on('GET', /\/tenants\/[^/]+$/, tenant)
      .on('GET', /\/branding$/, branding({ displayNameAr: 'بيت الفلافل' }));
    const view = await renderWithProviders(<BrandingPage />, { locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'الهوية البصرية' })).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'شاشة المطبخ' })).toBeInTheDocument();
    expect(within(screen.getByTestId('branding-preview')).getByText('بيت الفلافل')).toBeVisible();
    expect(view.i18n.dir()).toBe('rtl');
  });
});
