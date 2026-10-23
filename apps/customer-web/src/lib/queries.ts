import type { PublicOrder } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { TENANT_SLUG, storefront } from './api';

/** Statuses after which an order no longer changes for the customer. */
const FINAL: ReadonlySet<PublicOrder['status']> = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED']);

export function useTenant() {
  return useQuery({
    queryKey: ['tenant', TENANT_SLUG],
    queryFn: () => storefront.tenant(TENANT_SLUG),
    refetchInterval: 60_000,
  });
}

/** The branch and whether it takes orders now (refreshed so a pause shows up quickly). */
export function useLocation(locationId: string) {
  return useQuery({
    queryKey: ['location', locationId],
    queryFn: () => storefront.location(locationId),
    refetchInterval: 30_000,
  });
}

export function useMenu(locationId: string) {
  return useQuery({
    queryKey: ['menu', locationId],
    queryFn: () => storefront.menu(locationId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Polls the order every few seconds while it can still change (the tenant decides on it). */
export function useTrackedOrder(token: string) {
  return useQuery({
    queryKey: ['track', token],
    queryFn: () => storefront.track(token),
    refetchInterval: (query) =>
      query.state.data && FINAL.has(query.state.data.status) ? false : 5_000,
    refetchIntervalInBackground: false,
    retry: (failures, error) =>
      failures < 2 && !(error instanceof Error && 'status' in error && error.status === 404),
  });
}
