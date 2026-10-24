import type { ApiClient } from '@pos/api-client';
import type { ResolvedLocales } from '@pos/shared-types';
import { useQuery } from '@tanstack/react-query';

/**
 * The languages of the business a hub serves, for its POS and KDS sign-in screens (ADR 0020):
 * public, like its sign-in branding. Null without a hub (or before its first snapshot): the
 * screen offers every platform locale.
 */
export function useHubSignInLocales(api: ApiClient, enabled: boolean): ResolvedLocales | null {
  const query = useQuery({
    queryKey: ['hub-locales'],
    queryFn: () => api.hub.locales(),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  return enabled ? (query.data ?? null) : null;
}
