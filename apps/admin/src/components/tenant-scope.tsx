import { TenantProvider, tenantContextKey } from '@pos/app-kit';
import { isApiError } from '@pos/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { api } from '../lib/api';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';

/**
 * The tenant's modules at the location chosen in the sidebar (ADR 0018), in the language this
 * browser chose, else the user's, else the tenant's default (ADR 0020).
 *
 * The chosen location is remembered per browser, not per brand, so it can belong to another
 * brand (after a switch, or on a device that already holds one). The API then refuses the
 * context as LOCATION_NOT_FOUND and, with nothing above the location picker to reset it, the
 * page would stay on that error: the choice is dropped and the brand's default location used.
 */
export function TenantScope({ children }: { children: ReactNode }) {
  const tenantId = useSession((s) => s.user?.tenantId);
  const preferred = useSession((s) => s.user?.preferredLocale ?? null);
  const locationId = usePreferences((s) => s.locationId);
  const setLocationId = usePreferences((s) => s.setLocationId);
  const stored = usePreferences((s) => s.locale);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenantId || !locationId) return undefined;
    return queryClient.getQueryCache().subscribe((event) => {
      const queryKey = event.query.queryKey as readonly unknown[];
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        queryKey[0] === tenantContextKey(tenantId, locationId)[0] &&
        queryKey[1] === tenantId &&
        queryKey[2] === locationId &&
        isApiError(event.action.error) &&
        event.action.error.code === 'LOCATION_NOT_FOUND'
      ) {
        setLocationId(null);
      }
    });
  }, [queryClient, tenantId, locationId, setLocationId]);

  if (!tenantId) return null;
  return (
    // Keyed by brand: switching brands starts afresh, so the new brand's branding replaces the old.
    <TenantProvider
      key={tenantId}
      api={api}
      tenantId={tenantId}
      locationId={locationId}
      locale={{ stored, preferred }}
    >
      {children}
    </TenantProvider>
  );
}
