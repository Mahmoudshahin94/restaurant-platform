import { DomainError, locationsWithPermissions, resolvePermissions } from '@pos/domain';
import type { Principal, PrismaService } from '@pos/server';
import type { Permission } from '@pos/shared-types';

/**
 * Locations of the caller's restaurant where they hold every `required` permission, for lists
 * that span locations. With `only`, that one location (404 when it is not among them, so other
 * tenants' or unreachable locations are not disclosed).
 */
export async function permittedLocationIds(
  prisma: PrismaService,
  principal: Principal,
  required: readonly Permission[],
  only?: string,
): Promise<string[]> {
  const all = await prisma.location.findMany({
    where: { restaurantId: principal.restaurantId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const permitted = locationsWithPermissions(
    principal.assignments,
    all.map((l) => l.id),
    required,
  );
  if (only === undefined) return permitted;
  if (!permitted.includes(only)) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
  return [only];
}

/** Whether the caller holds `permission` restaurant-wide (not only at some locations). */
export function holdsRestaurantWide(principal: Principal, permission: Permission): boolean {
  return resolvePermissions(principal.assignments, null).has(permission);
}

/** Requires at least one of the permissions restaurant-wide. */
export function assertAnyRestaurantWide(
  principal: Principal,
  options: readonly Permission[],
): void {
  if (!options.some((p) => holdsRestaurantWide(principal, p))) {
    throw new DomainError('INSUFFICIENT_PERMISSION', 'Missing required permissions', {
      missing: options,
    });
  }
}

/** `page`/`pageSize` → Prisma `skip`/`take`. */
export const paging = (q: { page: number; pageSize: number }) => ({
  skip: (q.page - 1) * q.pageSize,
  take: q.pageSize,
});

/** Inclusive business-date range filter on a `@db.Date` column. */
export function dateRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
    ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
  };
}

/** Inclusive UTC day range on a timestamp column. */
export function instantRange(from?: string, to?: string) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
  };
}
