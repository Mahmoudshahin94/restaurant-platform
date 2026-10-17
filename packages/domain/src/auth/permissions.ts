import type { Permission } from '@pos/shared-types';
import { DomainError } from '../errors';

/**
 * One role granted to a user. `locationId: null` means the role applies to every location of
 * the user's restaurant; otherwise it applies to that location only.
 */
export interface RoleAssignment {
  locationId: string | null;
  permissions: readonly Permission[];
}

/**
 * Effective permissions in a scope. For a location-scoped action pass the location id:
 * restaurant-wide roles and roles for that location both count. For a restaurant-level action
 * pass `null`: only restaurant-wide roles count, so a branch manager cannot change
 * restaurant-wide settings.
 */
export function resolvePermissions(
  assignments: readonly RoleAssignment[],
  locationId: string | null,
): Set<Permission> {
  const result = new Set<Permission>();
  for (const assignment of assignments) {
    const applies =
      assignment.locationId === null ||
      (locationId !== null && assignment.locationId === locationId);
    if (!applies) continue;
    for (const permission of assignment.permissions) result.add(permission);
  }
  return result;
}

export function hasAllPermissions(
  granted: ReadonlySet<Permission>,
  required: readonly Permission[],
): boolean {
  return required.every((p) => granted.has(p));
}

export function canAccessLocation(
  assignments: readonly RoleAssignment[],
  locationId: string,
): boolean {
  return assignments.some((a) => a.locationId === null || a.locationId === locationId);
}

/** Locations a user may operate in; `'ALL'` when they hold a restaurant-wide role. */
export function accessibleLocations(assignments: readonly RoleAssignment[]): 'ALL' | string[] {
  if (assignments.some((a) => a.locationId === null)) return 'ALL';
  return [
    ...new Set(assignments.map((a) => a.locationId).filter((id): id is string => id !== null)),
  ];
}

export function assertPermissions(
  assignments: readonly RoleAssignment[],
  locationId: string | null,
  required: readonly Permission[],
): void {
  const granted = resolvePermissions(assignments, locationId);
  const missing = required.filter((p) => !granted.has(p));
  if (missing.length > 0) {
    throw new DomainError('INSUFFICIENT_PERMISSION', 'Missing required permissions', { missing });
  }
}

/**
 * Locations (of `allLocationIds`) where every `required` permission is granted: all of them for a
 * restaurant-wide grant, otherwise those of matching location roles. Used to filter lists that
 * span locations (orders, payments, audit) to what the caller may see.
 */
export function locationsWithPermissions(
  assignments: readonly RoleAssignment[],
  allLocationIds: readonly string[],
  required: readonly Permission[],
): string[] {
  return allLocationIds.filter((id) =>
    hasAllPermissions(resolvePermissions(assignments, id), required),
  );
}

/**
 * Nobody can hand out more than they hold (privilege escalation). Granting or revoking a role at
 * a scope (a location, or `null` for restaurant-wide) requires holding each of the role's
 * permissions at that scope; creating or editing a role requires holding them restaurant-wide.
 */
export function assertCanGrant(
  actor: readonly RoleAssignment[],
  scope: string | null,
  permissions: readonly Permission[],
): void {
  const granted = resolvePermissions(actor, scope);
  const missing = permissions.filter((p) => !granted.has(p));
  if (missing.length > 0) {
    throw new DomainError(
      'INSUFFICIENT_PERMISSION',
      'You cannot grant permissions you do not hold',
      {
        missing,
        reason: 'ESCALATION',
      },
    );
  }
}
