import type {
  AuditLogQuery,
  CustomerQuery,
  ListProductsQuery,
  PaymentSearchQuery,
  SyncIssuesQuery,
} from '@pos/validation';
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
  taxes: (rid: string, archived: boolean) => ['taxes', rid, archived] as const,
  discounts: (rid: string, archived: boolean) => ['discounts', rid, archived] as const,
  floor: (locationId: string) => ['floor', locationId] as const,
  locationMenu: (locationId: string) => ['location-menu', locationId] as const,
  dashboard: (rid: string) => ['dashboard', rid] as const,
  users: (rid: string) => ['users', rid] as const,
  roles: (rid: string) => ['roles', rid] as const,
  employees: (rid: string) => ['employees', rid] as const,
  paymentMethods: (rid: string) => ['payment-methods', rid] as const,
  cashRegisters: (locationId: string) => ['cash-registers', locationId] as const,
  onlineOrdering: (locationId: string) => ['online-ordering', locationId] as const,
  orders: (rid: string, query: object) => ['orders', rid, query] as const,
  order: (locationId: string, orderId: string) => ['order', locationId, orderId] as const,
  customers: (rid: string, query: CustomerQuery) => ['customers', rid, query] as const,
  customer: (rid: string, key: string) => ['customer', rid, key] as const,
  payments: (rid: string, query: PaymentSearchQuery) => ['payments', rid, query] as const,
  shifts: (locationId: string, status: string) => ['shifts', locationId, status] as const,
  shift: (locationId: string, shiftId: string) => ['shift', locationId, shiftId] as const,
  devices: (locationId: string) => ['devices', locationId] as const,
  syncStatus: (locationId: string) => ['sync-status', locationId] as const,
  syncIssues: (locationId: string, query: SyncIssuesQuery) =>
    ['sync-issues', locationId, query] as const,
  syncIssue: (locationId: string, operationId: string) =>
    ['sync-issue', locationId, operationId] as const,
  auditLogs: (rid: string, query: AuditLogQuery) => ['audit-logs', rid, query] as const,
  report: (rid: string, kind: string, query: object) => ['report', rid, kind, query] as const,
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

export function useTaxes(includeArchived = false) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.taxes(rid, includeArchived),
    queryFn: () => api.menu.taxes.list(rid, { includeArchived }),
  });
}

export function useDiscounts(includeArchived = false) {
  const rid = useRestaurantId();
  return useQuery({
    queryKey: keys.discounts(rid, includeArchived),
    queryFn: () => api.menu.discounts.list(rid, { includeArchived }),
  });
}

export function useFloor(locationId: string | null) {
  return useQuery({
    queryKey: keys.floor(locationId ?? 'none'),
    queryFn: () => api.floor.get(locationId ?? ''),
    enabled: locationId !== null,
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
        'taxes',
        'discounts',
        'floor',
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

/**
 * A mutation that refreshes the queries whose first key is listed (admin screens other than the
 * catalog). Pass every list the change can affect.
 */
export function useAdminMutation<TVariables, TResult>(
  fn: (variables: TVariables) => Promise<TResult>,
  affects: readonly string[],
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (q) => affects.includes(String(q.queryKey[0])),
      }),
  });
}
