import type { OrderListFilter } from '@pos/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePreferences } from '../stores/preferences';
import { api, useSession } from './session';

export function useRestaurantId(): string {
  const user = useSession((s) => s.user);
  if (!user) throw new Error('Not signed in');
  return user.restaurantId;
}

/** The location this terminal operates at (chosen once per terminal). */
export function useLocationId(): string {
  const locationId = usePreferences((s) => s.locationId);
  if (!locationId) throw new Error('No location selected');
  return locationId;
}

export function useLocations() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ['locations', rid],
    queryFn: () => api.locations.list(rid),
    staleTime: 5 * 60_000,
  });
}

/** The published menu, revalidated with ETag (cheap 304s) every minute. */
export function useLocationMenu(locationId: string) {
  return useQuery({
    queryKey: ['menu', locationId],
    queryFn: () => api.locations.menu(locationId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useDiscounts() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ['discounts', rid],
    queryFn: () => api.menu.discounts.list(rid),
    staleTime: 5 * 60_000,
  });
}

export function useFloor(locationId: string) {
  return useQuery({
    queryKey: ['floor', locationId],
    queryFn: () => api.floor.get(locationId),
    // Realtime events refresh this immediately; polling only covers a dropped connection.
    refetchInterval: 60_000,
  });
}

export function useOrders(locationId: string, filter: OrderListFilter) {
  return useQuery({
    queryKey: ['orders', locationId, filter],
    queryFn: () => api.orders.list(locationId, filter),
    refetchInterval: 60_000,
  });
}

export function useRestaurant() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ['restaurant', rid],
    queryFn: () => api.restaurants.get(rid),
    staleTime: 10 * 60_000,
  });
}

export function usePaymentMethods() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: ['payment-methods', rid],
    queryFn: () => api.payments.methods(rid),
    staleTime: 5 * 60_000,
  });
}

export function useCashRegisters(locationId: string) {
  return useQuery({
    queryKey: ['cash-registers', locationId],
    queryFn: () => api.shifts.registers(locationId),
  });
}

export function useShift(locationId: string, shiftId: string | null) {
  return useQuery({
    queryKey: ['shift', locationId, shiftId],
    queryFn: () => api.shifts.get(locationId, shiftId ?? ''),
    enabled: shiftId !== null,
    refetchInterval: 30_000,
  });
}

/** The open shift this terminal works in, if any. */
export function useCurrentShift(locationId: string) {
  const shiftId = usePreferences((s) => s.shiftId);
  const shift = useShift(locationId, shiftId);
  const open = shift.data?.status === 'OPEN' ? shift.data : null;
  return { shiftId: open ? shiftId : null, shift: open, query: shift };
}

export function useDailySummary(locationId: string) {
  return useQuery({
    queryKey: ['daily-summary', locationId],
    queryFn: () => api.reports.dailySummary(locationId),
    refetchInterval: 60_000,
  });
}

/** Query families that show order state; refreshed after writes and on realtime events. */
export const ORDER_QUERY_ROOTS = ['orders', 'floor', 'shift', 'cash-registers', 'daily-summary'];

/** Order writes refresh order lists, table occupancy, shift totals and the daily summary. */
export function useOrderMutation<TVariables, TResult>(
  fn: (variables: TVariables) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (q) => ORDER_QUERY_ROOTS.includes(String(q.queryKey[0])),
      }),
  });
}

/**
 * The location hub's status (cloud link, outbox). On the cloud the endpoint does not exist, so
 * `data` stays undefined: the POS then simply is not behind a hub.
 */
export function useHubStatus() {
  return useQuery({
    queryKey: ['hub-status'],
    queryFn: () => api.hub.status(),
    retry: false,
    // Realtime `sync.*` events refresh it at once; polling is the fallback.
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Query roots refreshed when the hub reports sync progress. */
export const SYNC_QUERY_ROOTS = ['hub-status', 'hub-operations'];

export function useHubOperations(status: 'PENDING' | 'FAILED' | 'COMPLETED') {
  return useQuery({
    queryKey: ['hub-operations', status],
    queryFn: () => api.hub.operations({ status, limit: 100 }),
    refetchInterval: 15_000,
  });
}

function useSyncMutation<A, T>(fn: (arg: A) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      client.invalidateQueries({
        predicate: (q) => SYNC_QUERY_ROOTS.includes(String(q.queryKey[0])),
      }),
  });
}

export function useSyncNow() {
  return useSyncMutation(() => api.hub.sync());
}

export function useRetryOperation() {
  return useSyncMutation((id: string) => api.hub.retry(id));
}
