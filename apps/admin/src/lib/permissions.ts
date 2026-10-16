import { type RoleAssignment, hasAllPermissions, resolvePermissions } from '@pos/domain';
import type { Permission } from '@pos/shared-types';
import { useMemo } from 'react';
import { useSession } from '../stores/session';

/**
 * UI-side permission hints, so users are not offered actions they cannot perform. The server
 * enforces every permission independently; this never grants anything.
 */
export function usePermissions() {
  const user = useSession((s) => s.user);
  return useMemo(() => {
    const assignments: RoleAssignment[] = user?.roles ?? [];
    const scopes = [null, ...new Set(assignments.map((a) => a.locationId))];
    return {
      /** Granted restaurant-wide (needed for restaurant-level catalog changes). */
      can: (...required: Permission[]) =>
        hasAllPermissions(resolvePermissions(assignments, null), required),
      /** Granted somewhere (restaurant-wide or at any location). */
      canAnywhere: (...required: Permission[]) =>
        scopes.some((s) => hasAllPermissions(resolvePermissions(assignments, s), required)),
      canAt: (locationId: string, ...required: Permission[]) =>
        hasAllPermissions(resolvePermissions(assignments, locationId), required),
    };
  }, [user]);
}
