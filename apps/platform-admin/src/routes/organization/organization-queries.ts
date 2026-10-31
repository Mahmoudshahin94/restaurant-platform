import type { QueryClient } from '@tanstack/react-query';

/** What an organization change touches: the organization, the list and the tenants' columns. */
export function invalidateOrganization(queryClient: QueryClient, organizationId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['organization', organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['organizations'] }),
    queryClient.invalidateQueries({ queryKey: ['tenants'] }),
  ]);
}
