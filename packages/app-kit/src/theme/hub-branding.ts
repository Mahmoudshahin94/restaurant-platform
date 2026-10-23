import type { ApiClient } from '@pos/api-client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type BrandingFileSource, useApplyBranding } from './theme-provider';

/**
 * Shows the location's business on a sign-in screen served by its hub (ADR 0019): the hub's
 * public `login` branding and its logo. Without a hub (or before its first snapshot) the screen
 * keeps MADAR's look.
 */
export function useHubSignInBranding(api: ApiClient, enabled: boolean): void {
  const query = useQuery({
    queryKey: ['hub-branding', 'login'],
    queryFn: () => api.hub.branding('login'),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const files = useMemo<BrandingFileSource>(() => (id) => api.hub.brandingFileUrl(id), [api]);
  useApplyBranding(enabled ? query.data : null, files);
}
