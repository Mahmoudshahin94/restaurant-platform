import { describe, expect, it } from 'vitest';
import { contrastRatio, normalizeHex, parseColour, relativeLuminance } from './colour';
import { brandingContrastIssues, colourContrastIssues, readableForeground } from './contrast';
import { brandingFileIds, resolveBranding, withDeviceThemeMode } from './resolve-branding';
import { BRAND_FOREGROUNDS, THEME_BACKGROUNDS } from './theme-tokens';

const names = { nameEn: 'Falafel House', nameAr: 'بيت الفلافل' };

describe('colour arithmetic', () => {
  it('computes WCAG luminance and contrast', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#2563eb', '#ffffff')).toBeCloseTo(5.17, 2);
  });

  it('reads the OKLCH theme tokens', () => {
    expect(relativeLuminance('oklch(1 0 0)')).toBeCloseTo(1, 3);
    expect(relativeLuminance('oklch(0% 0 0)')).toBe(0);
    expect(relativeLuminance(THEME_BACKGROUNDS.DARK)).toBeLessThan(0.01);
    expect(relativeLuminance(THEME_BACKGROUNDS.LIGHT)).toBeGreaterThan(0.95);
    expect(() => parseColour('red')).toThrow('Unsupported colour');
  });

  it('normalizes hex colours', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' #12AB9f ')).toBe('#12ab9f');
  });
});

describe('readable foregrounds', () => {
  it('puts white on dark colours and near-black on light ones', () => {
    expect(readableForeground('#1e3a8a')).toBe(BRAND_FOREGROUNDS.light);
    expect(readableForeground('#facc15')).toBe(BRAND_FOREGROUNDS.dark);
    expect(readableForeground('#ffffff')).toBe(BRAND_FOREGROUNDS.dark);
  });

  it('always reaches AA for text, whatever the colour', () => {
    for (let v = 0; v <= 255; v += 15) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      expect(contrastRatio(hex, readableForeground(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('contrast validation', () => {
  it('accepts brand colours readable on both themes', () => {
    expect(
      colourContrastIssues({
        primaryColor: '#2563eb',
        accentColor: '#dc2626',
        secondaryColor: '#f59e0b',
      }),
    ).toEqual([]);
  });

  it('rejects a primary that disappears into the dark or the light page', () => {
    expect(colourContrastIssues({ primaryColor: '#111827' })).toEqual([
      expect.objectContaining({ path: ['primaryColor'], against: 'DARK', required: 3 }),
    ]);
    expect(colourContrastIssues({ accentColor: '#f59e0b' })).toEqual([
      expect.objectContaining({ path: ['accentColor'], against: 'LIGHT' }),
    ]);
  });

  it('checks every surface override and names its path', () => {
    const issues = brandingContrastIssues(
      { primaryColor: '#2563eb' },
      { kds: { primaryColor: '#ffffff' }, website: { secondaryColor: '#000000' } },
    );
    expect(issues.map((i) => [i.path.join('.'), i.against])).toEqual([
      ['surfaces.kds.primaryColor', 'LIGHT'],
    ]);
  });

  it('has nothing to check without colours', () => {
    expect(brandingContrastIssues(null, null)).toEqual([]);
  });
});

describe('resolveBranding', () => {
  it('starts from MADAR defaults and the tenant names', () => {
    const b = resolveBranding({ tenantNames: names });
    expect(b).toMatchObject({
      displayNameEn: 'Falafel House',
      displayNameAr: 'بيت الفلافل',
      primaryColor: null,
      themeMode: 'DARK',
      surfaceStyle: 'SOLID',
      fontFamily: 'INTER',
      logoSize: 'MEDIUM',
      borderRadius: 8,
      surface: null,
    });
    expect(b.sources.themeMode).toBe('PLATFORM');
  });

  it('applies tenant, then surface, then the device theme mode', () => {
    const input = {
      tenantNames: names,
      tenant: { primaryColor: '#2563eb', themeMode: 'LIGHT' as const, displayNameEn: 'FH' },
      surfaces: { kds: { themeMode: 'DARK' as const, primaryColor: null, borderRadius: 4 } },
    };
    const pos = resolveBranding({ ...input, surface: 'pos' });
    expect(pos.primaryColor).toBe('#2563eb');
    expect(pos.themeMode).toBe('LIGHT');
    expect(pos.sources.themeMode).toBe('TENANT');

    const kds = resolveBranding({ ...input, surface: 'kds' });
    expect(kds).toMatchObject({ themeMode: 'DARK', primaryColor: '#2563eb', borderRadius: 4 });
    expect(kds.sources).toMatchObject({ themeMode: 'SURFACE', primaryColor: 'TENANT' });
    expect(kds.displayNameEn).toBe('FH');

    const device = resolveBranding({ ...input, surface: 'kds', device: { themeMode: 'SYSTEM' } });
    expect(device.themeMode).toBe('SYSTEM');
    expect(device.sources.themeMode).toBe('DEVICE');
  });

  it('ignores a device without a preference', () => {
    const b = resolveBranding({ tenantNames: names, device: { themeMode: null } });
    expect(b.sources.themeMode).toBe('PLATFORM');
    expect(withDeviceThemeMode(b, null)).toBe(b);
  });

  it('puts a device’s choice on branding the server resolved, like the device layer', () => {
    const tenant = { themeMode: 'LIGHT' as const };
    const server = resolveBranding({ tenantNames: names, tenant, surface: 'pos' });
    expect(withDeviceThemeMode(server, 'DARK')).toEqual(
      resolveBranding({
        tenantNames: names,
        tenant,
        surface: 'pos',
        device: { themeMode: 'DARK' },
      }),
    );
  });

  it('lists the files branding refers to', () => {
    expect(
      brandingFileIds(
        { logoFileId: 'a', faviconFileId: 'b' },
        { kds: { logoFileId: 'c' }, pos: { logoFileId: 'a' } },
      ).sort(),
    ).toEqual(['a', 'b', 'c']);
  });
});
