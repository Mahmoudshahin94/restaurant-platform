import { initI18n } from '@pos/i18n';
import type { ResolvedBranding, ThemeMode } from '@pos/shared-types';
import { Badge, Button, Card, CardContent, CardTitle } from '@pos/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DirectionBridge } from '../i18n';
import { TenantContextProvider, tenantContextFixture } from '../tenant-context';
import { applyTenantTheme, brandingVariables } from './apply-tenant-theme';
import { TenantLogo } from './tenant-logo';
import {
  DEVICE_THEME_KEY,
  ThemeProvider,
  type ThemeState,
  applyStoredThemeMode,
  useTheme,
} from './theme-provider';
import { ThemeSwitcher } from './theme-switcher';

const html = () => document.documentElement;

function reset() {
  cleanup();
  window.localStorage.clear();
  html().removeAttribute('style');
  delete html().dataset.theme;
  delete html().dataset.surface;
  document.title = '';
}
beforeEach(reset);
afterEach(reset);

let theme: ThemeState;
function Probe() {
  theme = useTheme();
  return null;
}

function branded(branding: Parameters<typeof tenantContextFixture>[2], surface = null) {
  return tenantContextFixture({}, null, branding, surface);
}

async function i18nFor(locale: 'en' | 'ar') {
  return initI18n({ locale, plugins: [initReactI18next] });
}

async function renderThemed(ui: ReactNode, locale: 'en' | 'ar' = 'en', app = 'pos' as const) {
  const i18n = await i18nFor(locale);
  return render(
    <I18nextProvider i18n={i18n}>
      <DirectionBridge i18n={i18n}>
        <ThemeProvider app={app} surface="pos">
          <Probe />
          {ui}
        </ThemeProvider>
      </DirectionBridge>
    </I18nextProvider>,
  );
}

describe('theme switching', () => {
  it('starts dark, follows the business, and lets the device choose', async () => {
    await renderThemed(null);
    expect(html().dataset.theme).toBe('dark');
    expect(theme.mode).toBe('DARK');

    cleanup();
    await renderThemed(
      <TenantContextProvider value={branded({ themeMode: 'LIGHT' })}>{null}</TenantContextProvider>,
    );
    expect(html().dataset.theme).toBe('light');
    expect(theme.branding?.sources.themeMode).toBe('TENANT');

    // The device's own choice wins over the business's, and is remembered.
    act(() => {
      theme.setDevicePreference('SYSTEM');
    });
    expect(html().dataset.theme).toBe('system');
    expect(theme.branding?.sources.themeMode).toBe('DEVICE');
    expect(window.localStorage.getItem(DEVICE_THEME_KEY)).toBe('SYSTEM');

    act(() => {
      theme.setDevicePreference(null);
    });
    expect(html().dataset.theme).toBe('light');
    expect(window.localStorage.getItem(DEVICE_THEME_KEY)).toBeNull();
  });

  it('applies the stored choice before the first render', () => {
    window.localStorage.setItem(DEVICE_THEME_KEY, 'LIGHT');
    applyStoredThemeMode();
    expect(html().dataset.theme).toBe('light');
    window.localStorage.setItem(DEVICE_THEME_KEY, 'SEPIA');
    applyStoredThemeMode();
    expect(html().dataset.theme).toBe('dark');
  });

  it('offers the device a choice in its language', async () => {
    await renderThemed(<ThemeSwitcher />, 'ar');
    const select = screen.getByRole('combobox', { name: 'المظهر' });
    expect(select).toHaveValue('');
    fireEvent.change(select, { target: { value: 'LIGHT' } });
    expect(html().dataset.theme).toBe('light');
    expect(window.localStorage.getItem(DEVICE_THEME_KEY)).toBe('LIGHT');
    fireEvent.change(select, { target: { value: '' } });
    expect(theme.devicePreference).toBeNull();
  });

  it('restores MADAR’s look when the tenant’s branding goes away', async () => {
    const view = await renderThemed(
      <TenantContextProvider value={branded({ primaryColor: '#1e3a8a', surfaceStyle: 'GLASS' })}>
        {null}
      </TenantContextProvider>,
    );
    expect(html().style.getPropertyValue('--color-primary')).toBe('#1e3a8a');
    expect(html().dataset.surface).toBe('glass');
    view.rerender(<ThemeProvider app="pos">{null}</ThemeProvider>);
    expect(html().style.getPropertyValue('--color-primary')).toBe('');
    expect(html().dataset.surface).toBeUndefined();
  });
});

describe('tenant token application', () => {
  const base = branded({}).branding;

  it('writes brand colours with readable foregrounds, the ring, radii and typeface', () => {
    const vars = brandingVariables({
      ...base,
      primaryColor: '#1e3a8a',
      accentColor: '#facc15',
      borderRadius: 12,
      fontFamily: 'SERIF',
    });
    expect(vars).toMatchObject({
      '--color-primary': '#1e3a8a',
      '--color-primary-foreground': '#ffffff',
      '--color-ring': '#1e3a8a',
      '--color-accent': '#facc15',
      '--color-accent-foreground': '#000000',
      '--radius': '12px',
      '--radius-sm': '7px',
      '--radius-md': '12px',
      '--radius-lg': '17px',
      '--radius-xl': '24px',
    });
    expect(vars['--color-primary-hover']).toBe(
      'color-mix(in oklch, #1e3a8a 85%, var(--color-foreground))',
    );
    expect(vars['--color-primary-subtle']).toBe(
      'color-mix(in oklch, #1e3a8a 12%, var(--color-card))',
    );
    expect(vars['--color-primary-subtle-border']).toBe(
      'color-mix(in oklch, #1e3a8a 30%, var(--color-card))',
    );
    expect(vars['--font-sans']).toMatch(/^ui-serif/);
    // Unset colours keep the theme's own (they differ between light and dark).
    expect(vars).not.toHaveProperty('--color-secondary');
  });

  it('applies to the document and removes itself', () => {
    const remove = applyTenantTheme({ ...base, secondaryColor: '#0d9488', surfaceStyle: 'GLASS' });
    expect(html().style.getPropertyValue('--color-secondary')).toBe('#0d9488');
    expect(html().style.getPropertyValue('--color-secondary-foreground')).toBe('#000000');
    expect(html().dataset.surface).toBe('glass');
    remove();
    expect(html().getAttribute('style')).toBe('');
    expect(html().dataset.surface).toBeUndefined();
  });
});

describe('branding in both directions', () => {
  const names = { displayNameEn: 'Falafel House', displayNameAr: 'بيت الفلافل' };

  it.each([
    ['en', 'ltr', 'Falafel House', 'Falafel House · MADAR POS'],
    ['ar', 'rtl', 'بيت الفلافل', 'بيت الفلافل · MADAR POS'],
  ] as const)('shows the %s name, %s, and titles the page', async (locale, dir, name, title) => {
    await renderThemed(
      <TenantContextProvider value={branded(names)}>
        <header>
          <TenantLogo />
        </header>
      </TenantContextProvider>,
      locale,
    );
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(html().dir || dir).toBe(dir);
    expect(document.title).toBe(title);
  });

  it('shows the logo with the name as its text alternative', async () => {
    const context = branded({ ...names, logoFileId: '01890a5d-ac96-774b-bcce-b302099a8001' });
    const files = () => 'https://hub.local/logo.png';
    await renderThemed(
      <TenantContextProvider value={context} files={files}>
        <TenantLogo />
      </TenantContextProvider>,
      'ar',
    );
    const logo = await screen.findByRole('img', { name: 'بيت الفلافل' });
    expect(logo).toHaveAttribute('src', 'https://hub.local/logo.png');
    expect(logo.className).toContain('h-8');
  });

  it('shows the platform’s name before any tenant is known', async () => {
    await renderThemed(<TenantLogo fallback={<span>platform</span>} />);
    expect(screen.getByText('platform')).toBeInTheDocument();
  });
});

describe('components per theme', () => {
  const cases: [string, ThemeMode | null, Partial<ResolvedBranding>][] = [
    ['dark (MADAR default)', null, {}],
    ['light', 'LIGHT', {}],
    ['system', 'SYSTEM', {}],
    [
      'branded glass, light',
      'LIGHT',
      { primaryColor: '#16a34a', accentColor: '#dc2626', surfaceStyle: 'GLASS', borderRadius: 14 },
    ],
  ];

  it.each(cases)('%s', async (_name, device, branding) => {
    if (device) window.localStorage.setItem(DEVICE_THEME_KEY, device);
    const view = await renderThemed(
      <TenantContextProvider value={branded(branding)}>
        <Card>
          <CardContent>
            <CardTitle>
              <TenantLogo />
            </CardTitle>
            <Button>Pay</Button>
            <Button variant="outline">Hold</Button>
            <Badge variant="success">Paid</Badge>
          </CardContent>
        </Card>
      </TenantContextProvider>,
    );
    expect({
      theme: html().dataset.theme,
      surface: html().dataset.surface ?? null,
      style: html().getAttribute('style'),
      markup: view.container.innerHTML,
    }).toMatchSnapshot();
  });
});
