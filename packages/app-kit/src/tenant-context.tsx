import type { ApiClient } from '@pos/api-client';
import { resolveFeatures } from '@pos/domain';
import type { Feature, ResolvedFeatures } from '@pos/shared-types';
import type { TenantContextDto } from '@pos/validation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext } from 'react';
import { QueryState } from './components/query-state';

const TenantContext = createContext<TenantContextDto | null>(null);

/** How often an open app picks up module changes made in the admin (and synced to its hub). */
const REFRESH_MS = 60_000;

export const tenantContextKey = (tenantId: string, locationId: string | null) =>
  ['tenant-context', tenantId, locationId] as const;

/**
 * Provides a context the caller already has (tests, or an app that loaded it some other way).
 * Most apps use `TenantProvider`, which loads it.
 */
export function TenantContextProvider({
  value,
  children,
}: {
  value: TenantContextDto;
  children: ReactNode;
}) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

/**
 * Loads the tenant's context (branding, currency, locales and the modules resolved for
 * `locationId`, ADR 0018) and provides it to everything below. Children render once it has
 * loaded, so no screen flashes a module that turns out to be off; a failure offers a retry. It is
 * refreshed every minute and when the window regains focus. Switching location keeps showing the
 * previous location's context until the new one arrives.
 */
export function TenantProvider({
  api,
  tenantId,
  locationId = null,
  children,
}: {
  api: ApiClient;
  tenantId: string;
  locationId?: string | null;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: tenantContextKey(tenantId, locationId),
    queryFn: () => api.tenants.context(tenantId, locationId),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  return (
    <QueryState query={query}>
      {(context) => <TenantContextProvider value={context}>{children}</TenantContextProvider>}
    </QueryState>
  );
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
 * A context for tests and previews: a restaurant (every module the business type gives it), with
 * `features` overriding modules the way a tenant administrator would.
 */
export function tenantContextFixture(
  features: Partial<Record<Feature, boolean>> = {},
  locationId: string | null = null,
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
    branding: { nameEn: 'Demo', nameAr: 'تجريبي' },
    currency: { code: 'ILS', exponent: 2 },
    locales: { default: 'en', supported: ['en', 'ar'] },
    locationId,
    features: resolveFeatures({ businessType: 'RESTAURANT', tenant: features }),
  };
}
