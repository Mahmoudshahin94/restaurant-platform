import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';

/** The organization's brands with their branches and the caller's role. */
export function useOrganizationOverview(organizationId: string) {
  return useQuery({
    queryKey: keys.organization(organizationId),
    queryFn: () => api.organizations.get(organizationId),
    staleTime: 5 * 60_000,
  });
}
