import type { ApiClient } from '@pos/api-client';
import {
  type CurrencyDisplayLayer,
  type LocalesInput,
  resolveBranding,
  resolveCurrency,
  resolveFeatures,
  resolveLocales,
} from '@pos/domain';
import type {
  BrandSurface,
  BrandingLayer,
  Feature,
  Locale,
  ResolvedFeatures,
} from '@pos/shared-types';
import type { TenantContextDto } from '@pos/validation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { QueryState } from './components/query-state';
import { LocalizationProvider, useLocaleSelection } from './localization';
import { type BrandingFileSource, useApplyBranding, useThemeSurface } from './theme/theme-provider';

const TenantContext = createContext<TenantContextDto | null>(null);

/** How often an open app picks up module changes made in the admin (and synced to its hub). */
const REFRESH_MS = 60_000;

export const tenantContextKey = (
  tenantId: string,
  locationId: string | null,
  surface: BrandSurface | null = null,
) => ['tenant-context', tenantId, locationId, surface] as const;

/**
 * Provides a context the caller already has (tests, or an app that loaded it some other way),
 * applying its branding to the `ThemeProvider` above, if any, and its currency display and
 * languages to everything below (ADR 0020). Most apps use `TenantProvider`, which loads it.
 */
export function TenantContextProvider({
  value,
  files = null,
  children,
}: {
  value: TenantContextDto;
  files?: BrandingFileSource | null;
  children: ReactNode;
}) {
  useApplyBranding(value.branding, files);
  return (
    <TenantContext.Provider value={value}>
      <LocalizationProvider currency={value.currency} locales={value.locales}>
        {children}
      </LocalizationProvider>
    </TenantContext.Provider>
  );
}

/**
 * Loads the tenant's context (currency, locales, the modules resolved for `locationId`, ADR 0018,
 * and the branding of the surface of the `ThemeProvider` above, ADR 0019) and provides it to
 * everything below; the branding is applied to the theme. Children render once it has loaded,
 * so no screen flashes a module that turns out to be off; a failure offers a retry. It is
 * refreshed every minute and when the window regains focus. Switching location keeps showing the
 * previous location's context until the new one arrives.
 *
 * The screen's language follows the tenant's (ADR 0020): `locale.stored` (the device's choice),
 * if the tenant offers it, else `locale.preferred` (the signed-in user's), else the tenant's
 * default.
 */
export function TenantProvider({
  api,
  tenantId,
  locationId = null,
  locale = { stored: null, preferred: null },
  children,
}: {
  api: ApiClient;
  tenantId: string;
  locationId?: string | null;
  locale?: { stored: Locale | null; preferred: Locale | null };
  children: ReactNode;
}) {
  const surface = useThemeSurface();
  const query = useQuery({
    queryKey: tenantContextKey(tenantId, locationId, surface),
    queryFn: () => api.tenants.context(tenantId, locationId, surface),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  const files = useMemo(() => tenantFileSource(api, tenantId), [api, tenantId]);
  useLocaleSelection(query.data?.locales, locale);
  return (
    <QueryState query={query}>
      {(context) => (
        <TenantContextProvider value={context} files={files}>
          {children}
        </TenantContextProvider>
      )}
    </QueryState>
  );
}

/** Branding files through the signed-in API client, each downloaded once per session. */
function tenantFileSource(api: ApiClient, tenantId: string): BrandingFileSource {
  const cache = new Map<string, Promise<Blob>>();
  return (fileId) => {
    let blob = cache.get(fileId);
    if (!blob) {
      blob = api.files.content(tenantId, fileId);
      blob.catch(() => cache.delete(fileId));
      cache.set(fileId, blob);
    }
    return blob;
  };
}

/** The tenant's context. Only below a `TenantProvider` (or `TenantContextProvider`). */
export function useTenantContext(): TenantContextDto {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenantContext needs a TenantProvider above it');
  return context;
}

/** Every module, resolved for the provider's location. */
export function useFeatures(): ResolvedFeatures {
  return useTenantContext().features;
}

/**
 * Whether a module is on. Screens ask for capabilities, never for the business type
 * (`pos-local/no-business-type-branching`). A UI hint only: the server enforces every module.
 */
export function useFeature(feature: Feature): boolean {
  return useFeatures()[feature].enabled;
}

/** Renders `children` only while every listed module is on, `fallback` otherwise. */
export function FeatureGate({
  feature,
  fallback = null,
  children,
}: {
  feature: Feature | readonly Feature[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const features = useFeatures();
  const required = typeof feature === 'string' ? [feature] : feature;
  return <>{required.every((f) => features[f].enabled) ? children : fallback}</>;
}

/**
 * A context for tests and previews: a restaurant in shekels offering English and Arabic (every
 * module the business type gives it), with `features` overriding modules the way a tenant
 * administrator would, `branding` its own, and `localization` its currency and languages.
 */
export function tenantContextFixture(
  features: Partial<Record<Feature, boolean>> = {},
  locationId: string | null = null,
  branding: BrandingLayer = {},
  surface: BrandSurface | null = null,
  localization: {
    currencyCode?: string;
    currency?: CurrencyDisplayLayer;
    locales?: Partial<LocalesInput>;
  } = {},
): TenantContextDto {
  return {
    tenant: {
      id: '01890a5d-ac96-774b-bcce-b302099a8000',
      slug: 'demo',
      nameEn: 'Demo',
      nameAr: 'تجريبي',
      businessType: 'RESTAURANT',
      status: 'ACTIVE',
      timezone: 'Asia/Hebron',
    },
    branding: resolveBranding({
      tenantNames: { nameEn: 'Demo', nameAr: 'تجريبي' },
      tenant: branding,
      surface,
    }),
    currency: resolveCurrency(localization.currencyCode ?? 'ILS', localization.currency ?? null),
    locales: resolveLocales({
      defaultLocale: 'en',
      supportedLocales: ['en', 'ar'],
      ...localization.locales,
    }),
    locationId,
    features: resolveFeatures({ businessType: 'RESTAURANT', tenant: features }),
  };
}
