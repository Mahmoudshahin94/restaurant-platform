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

/** Query keys are namespaced by tenant so data never leaks between sessions. */
export const keys = {
  tenant: (tid: string) => ['tenant', tid] as const,
  features: (tid: string, locationId: string | null) => ['features', tid, locationId] as const,
  locations: (tid: string) => ['locations', tid] as const,
  categories: (tid: string, archived: boolean) => ['categories', tid, archived] as const,
  stations: (tid: string, archived: boolean) => ['kitchen-stations', tid, archived] as const,
  modifierGroups: (tid: string, archived: boolean) => ['modifier-groups', tid, archived] as const,
  products: (tid: string, query: ListProductsQuery) => ['products', tid, query] as const,
  productSettings: (locationId: string) => ['product-settings', locationId] as const,
  taxes: (tid: string, archived: boolean) => ['taxes', tid, archived] as const,
  discounts: (tid: string, archived: boolean) => ['discounts', tid, archived] as const,
  floor: (locationId: string) => ['floor', locationId] as const,
  locationMenu: (locationId: string) => ['location-menu', locationId] as const,
  dashboard: (tid: string) => ['dashboard', tid] as const,
  users: (tid: string) => ['users', tid] as const,
  roles: (tid: string) => ['roles', tid] as const,
  employees: (tid: string) => ['employees', tid] as const,
  paymentMethods: (tid: string) => ['payment-methods', tid] as const,
  cashRegisters: (locationId: string) => ['cash-registers', locationId] as const,
  onlineOrdering: (locationId: string) => ['online-ordering', locationId] as const,
  orders: (tid: string, query: object) => ['orders', tid, query] as const,
  order: (locationId: string, orderId: string) => ['order', locationId, orderId] as const,
  customers: (tid: string, query: CustomerQuery) => ['customers', tid, query] as const,
  customer: (tid: string, key: string) => ['customer', tid, key] as const,
  payments: (tid: string, query: PaymentSearchQuery) => ['payments', tid, query] as const,
  shifts: (locationId: string, status: string) => ['shifts', locationId, status] as const,
  shift: (locationId: string, shiftId: string) => ['shift', locationId, shiftId] as const,
  devices: (locationId: string) => ['devices', locationId] as const,
  syncStatus: (locationId: string) => ['sync-status', locationId] as const,
  syncIssues: (locationId: string, query: SyncIssuesQuery) =>
    ['sync-issues', locationId, query] as const,
  syncIssue: (locationId: string, operationId: string) =>
    ['sync-issue', locationId, operationId] as const,
  auditLogs: (tid: string, query: AuditLogQuery) => ['audit-logs', tid, query] as const,
  report: (tid: string, kind: string, query: object) => ['report', tid, kind, query] as const,
};

export function useTenantId(): string {
  const user = useSession((s) => s.user);
  if (!user) throw new Error('useTenantId used outside an authenticated route');
  return user.tenantId;
}

export function useTenant() {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.tenant(tid),
    queryFn: () => api.tenants.get(tid),
    staleTime: 5 * 60_000,
  });
}

export function useLocations() {
  const tid = useTenantId();
  return useQuery({ queryKey: keys.locations(tid), queryFn: () => api.locations.list(tid) });
}

export function useCategories(includeArchived = false) {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.categories(tid, includeArchived),
    queryFn: () => api.menu.categories.list(tid, { includeArchived }),
  });
}

export function useKitchenStations(includeArchived = false) {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.stations(tid, includeArchived),
    queryFn: () => api.menu.kitchenStations.list(tid, { includeArchived }),
  });
}

export function useModifierGroups(includeArchived = false) {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.modifierGroups(tid, includeArchived),
    queryFn: () => api.menu.modifierGroups.list(tid, { includeArchived }),
  });
}

export function useProducts(query: ListProductsQuery) {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.products(tid, query),
    queryFn: () => api.menu.products.list(tid, query),
  });
}

export function useTaxes(includeArchived = false) {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.taxes(tid, includeArchived),
    queryFn: () => api.menu.taxes.list(tid, { includeArchived }),
  });
}

export function useDiscounts(includeArchived = false) {
  const tid = useTenantId();
  return useQuery({
    queryKey: keys.discounts(tid, includeArchived),
    queryFn: () => api.menu.discounts.list(tid, { includeArchived }),
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
