import type { ListProductsQuery } from '@pos/validation';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../stores/session';
import { api } from './api';

/** Query keys are namespaced by restaurant so data never leaks between sessions. */
export const keys = {
  restaurant: (rid: string) => ['restaurant', rid] as const,
  locations: (rid: string) => ['locations', rid] as const,
  categories: (rid: string, archived: boolean) => ['categories', rid, archived] as const,
  stations: (rid: string, archived: boolean) => ['kitchen-stations', rid, archived] as const,
  modifierGroups: (rid: string, archived: boolean) => ['modifier-groups', rid, archived] as const,
  products: (rid: string, query: ListProductsQuery) => ['products', rid, query] as const,
  productSettings: (locationId: string) => ['product-settings', locationId] as const,
  locationMenu: (locationId: string) => ['location-menu', locationId] as const,
};

export function useRestaurantId(): string {
  const user = useSession((s) => s.user);
  if (!user) throw new Error('useRestaurantId used outside an authenticated route');
  return user.restaurantId;
}

export function useRestaurant() {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.restaurant(rid),
    queryFn: () => api.restaurants.get(rid),
    staleTime: 5 * 60_000,
  });
}

export function useLocations() {
  const rid = useRestaurantId();
  return useQuery({ queryKey: keys.locations(rid), queryFn: () => api.locations.list(rid) });
}

export function useCategories(includeArchived = false) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.categories(rid, includeArchived),
    queryFn: () => api.menu.categories.list(rid, { includeArchived }),
  });
}

export function useKitchenStations(includeArchived = false) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.stations(rid, includeArchived),
    queryFn: () => api.menu.kitchenStations.list(rid, { includeArchived }),
  });
}

export function useModifierGroups(includeArchived = false) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.modifierGroups(rid, includeArchived),
    queryFn: () => api.menu.modifierGroups.list(rid, { includeArchived }),
  });
}

export function useProducts(query: ListProductsQuery) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.products(rid, query),
    queryFn: () => api.menu.products.list(rid, query),
  });
}

export function useProductSettings(locationId: string | null) {
  return useQuery({
    queryKey: keys.productSettings(locationId ?? 'none'),
    queryFn: () => api.locations.productSettings(locationId ?? ''),
    enabled: locationId !== null,
  });
}

/** Any catalog change can alter every derived list and published menu. */
function invalidateCatalog(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (q) =>
      [
        'categories',
        'kitchen-stations',
        'modifier-groups',
        'products',
        'product-settings',
        'location-menu',
      ].includes(String(q.queryKey[0])),
  });
}

/** Wraps a catalog mutation so successful writes refresh all affected queries. */
export function useCatalogMutation<TVariables, TResult>(
  fn: (variables: TVariables) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidateCatalog(client),
  });
}
