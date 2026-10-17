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
    refetchInterval: 15_000,
  });
}

export function useOrders(locationId: string, filter: OrderListFilter) {
  return useQuery({
    queryKey: ['orders', locationId, filter],
    queryFn: () => api.orders.list(locationId, filter),
    refetchInterval: 15_000,
  });
}

/** Order writes refresh order lists and table occupancy. */
export function useOrderMutation<TVariables, TResult>(
  fn: (variables: TVariables) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (q) => ['orders', 'floor'].includes(String(q.queryKey[0])),
      }),
  });
}
