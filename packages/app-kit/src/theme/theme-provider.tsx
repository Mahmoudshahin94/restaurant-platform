import { PLATFORM_BRANDING_DEFAULTS, withDeviceThemeMode } from '@pos/domain';
import {
  type BrandSurface,
  PLATFORM_BRAND,
  type PlatformApp,
  type ResolvedBranding,
  THEME_MODES,
  type ThemeMode,
} from '@pos/shared-types';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { useCurrentLocale } from '../locale';
import { safeLocalStorage } from '../storage';
import { applyTenantTheme, applyThemeMode } from './apply-tenant-theme';

/**
 * Where a screen gets the bytes of a branding file: a URL it can show directly (public files of
 * the website and the hub's sign-in screens), or a download through the signed-in API client.
 */
export type BrandingFileSource = (fileId: string) => string | Promise<Blob>;

export interface ThemeState {
  app: PlatformApp;
  /** The screen, for its branding overrides; null: the tenant's defaults (the admin). */
  surface: BrandSurface | null;
  /** This device's own choice, which wins over the tenant's; null follows the tenant. */
  devicePreference: ThemeMode | null;
  setDevicePreference: (mode: ThemeMode | null) => void;
  /** What the screen shows: the device's choice, else the branding's, else MADAR's default. */
  mode: ThemeMode;
  /** The tenant's branding with the device layer applied; null before any is known. */
  branding: ResolvedBranding | null;
  files: BrandingFileSource | null;
}

interface Registration {
  branding: ResolvedBranding;
  files: BrandingFileSource | null;
}

const ThemeContext = createContext<ThemeState | null>(null);
const ThemeControl = createContext<((r: Registration) => () => void) | null>(null);

/** Where a device keeps its light/dark choice (per app origin; never business data). */
export const DEVICE_THEME_KEY = 'pos:theme-mode';

export function readDeviceThemeMode(key = DEVICE_THEME_KEY): ThemeMode | null {
  const stored = safeLocalStorage.getItem(key);
  return typeof stored === 'string' && (THEME_MODES as readonly string[]).includes(stored)
    ? (stored as ThemeMode)
    : null;
}

/**
 * Applies the theme before the first render (call it in the app's bootstrap), so a device that
 * chose light never flashes the dark default.
 */
export function applyStoredThemeMode(key = DEVICE_THEME_KEY): void {
  applyThemeMode(readDeviceThemeMode(key) ?? PLATFORM_BRANDING_DEFAULTS.themeMode);
}

/**
 * The look of the app (ADR 0019): light, dark or the system's, and the tenant's branding once a
 * `TenantProvider` (or `useApplyBranding`) below knows it. Writes `data-theme`, the tenant's
 * colour, radius and typeface variables, `data-surface`, the favicon and the page title onto the
 * document; removing the branding restores MADAR's look.
 *
 * The device's own preference (`setDevicePreference`, kept in local storage) wins over the
 * tenant's default, which wins over MADAR's.
 */
export function ThemeProvider({
  app,
  surface = null,
  storageKey = DEVICE_THEME_KEY,
  children,
}: {
  app: PlatformApp;
  surface?: BrandSurface | null;
  storageKey?: string;
  children: ReactNode;
}) {
  const [devicePreference, setPreference] = useState(() => readDeviceThemeMode(storageKey));
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const active = registrations.at(-1) ?? null;

  const setDevicePreference = useCallback(
    (mode: ThemeMode | null) => {
      if (mode) safeLocalStorage.setItem(storageKey, mode);
      else safeLocalStorage.removeItem(storageKey);
      setPreference(mode);
    },
    [storageKey],
  );

  const register = useCallback((registration: Registration) => {
    setRegistrations((list) => [...list, registration]);
    return () => {
      setRegistrations((list) => list.filter((r) => r !== registration));
    };
  }, []);

  const branding = useMemo(
    () => (active ? withDeviceThemeMode(active.branding, devicePreference) : null),
    [active, devicePreference],
  );
  const mode = devicePreference ?? branding?.themeMode ?? PLATFORM_BRANDING_DEFAULTS.themeMode;

  useLayoutEffect(() => {
    applyThemeMode(mode);
  }, [mode]);
  useLayoutEffect(() => (branding ? applyTenantTheme(branding) : undefined), [branding]);

  const state = useMemo<ThemeState>(
    () => ({
      app,
      surface,
      devicePreference,
      setDevicePreference,
      mode,
      branding,
      files: active?.files ?? null,
    }),
    [app, surface, devicePreference, setDevicePreference, mode, branding, active],
  );
  return (
    <ThemeControl.Provider value={register}>
      <ThemeContext.Provider value={state}>
        <DocumentBranding />
        {children}
      </ThemeContext.Provider>
    </ThemeControl.Provider>
  );
}

/** The theme and branding in effect. Only below a `ThemeProvider`. */
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error('useTheme needs a ThemeProvider above it');
  return state;
}

/** The surface of the nearest `ThemeProvider` (null without one). */
export function useThemeSurface(): BrandSurface | null {
  return useContext(ThemeContext)?.surface ?? null;
}

/**
 * Shows `branding` (and its files from `files`) while the calling component is mounted. The
 * most recently mounted caller wins: a sign-in screen's branding, then the signed-in tenant's.
 * Pass a stable `files` (memoized) so the branding is not applied again on every render.
 */
export function useApplyBranding(
  branding: ResolvedBranding | null | undefined,
  files: BrandingFileSource | null = null,
): void {
  const register = useContext(ThemeControl);
  useLayoutEffect(() => {
    if (!register || !branding) return undefined;
    return register({ branding, files });
  }, [register, branding, files]);
}

/**
 * A URL for a branding file (logo, favicon), or null while there is none. Downloads made through
 * the API client become object URLs, released when no longer shown.
 */
export function useBrandingFileUrl(fileId: string | null): string | null {
  const files = useContext(ThemeContext)?.files ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId || !files) {
      setUrl(null);
      return undefined;
    }
    const source = files(fileId);
    if (typeof source === 'string') {
      setUrl(source);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    source.then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => {
        if (!cancelled) setUrl(null);
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, files]);
  return url;
}

/** The tenant's display name in the current language. */
export function useBrandName(): string | null {
  const branding = useContext(ThemeContext)?.branding ?? null;
  const locale = useCurrentLocale();
  if (!branding) return null;
  return locale === 'ar' ? branding.displayNameAr : branding.displayNameEn;
}

/** The favicon and page title of the tenant's branding, while it is shown. */
function DocumentBranding() {
  const { app, branding } = useTheme();
  const name = useBrandName();
  const favicon = useBrandingFileUrl(branding?.faviconFileId ?? null);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const product = PLATFORM_BRAND.products[app];
    // The website is the tenant's own; every other app is a MADAR product used by the tenant.
    document.title = name ? (app === 'website' ? name : `${name} · ${product}`) : product;
    return () => {
      document.title = product;
    };
  }, [app, name]);

  useEffect(() => {
    if (typeof document === 'undefined' || !favicon) return undefined;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return undefined;
    const original = { href: link.href, type: link.type };
    link.href = favicon;
    link.removeAttribute('type');
    return () => {
      link.href = original.href;
      if (original.type) link.type = original.type;
    };
  }, [favicon]);

  return null;
}
