import type { PublicOrder } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { storefront } from './api';

/** Statuses after which an order no longer changes for the customer. */
const FINAL: ReadonlySet<PublicOrder['status']> = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED']);

/** The tenant this host serves: its names, branding, locations and website (ADR 0023). */
export function useSite() {
  return useQuery({
    queryKey: ['site'],
    queryFn: () => storefront.site(),
    refetchInterval: 60_000,
    retry: (failures, error) =>
      failures < 2 && !(error instanceof Error && 'status' in error && error.status === 404),
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

export function useMenu(locationId: string, enabled = true) {
  return useQuery({
    queryKey: ['menu', locationId],
    enabled,
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
