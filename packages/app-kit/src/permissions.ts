import { type RoleAssignment, hasAllPermissions, resolvePermissions } from '@pos/domain';
import type { Permission } from '@pos/shared-types';
import type { AuthUser } from '@pos/validation';
import { useMemo } from 'react';

export interface PermissionChecks {
  /** Granted tenant-wide. */
  can: (...required: Permission[]) => boolean;
  /** Granted tenant-wide or at any location. */
  canAnywhere: (...required: Permission[]) => boolean;
  canAt: (locationId: string, ...required: Permission[]) => boolean;
}

/**
 * UI-side permission hints, so people are not offered actions they cannot perform. The server
 * enforces every permission independently; this never grants anything.
 */
export function usePermissionChecks(user: AuthUser | null): PermissionChecks {
  return useMemo(() => {
    const assignments: RoleAssignment[] = user?.roles ?? [];
    const scopes = [null, ...new Set(assignments.map((a) => a.locationId))];
    return {
      can: (...required) => hasAllPermissions(resolvePermissions(assignments, null), required),
      canAnywhere: (...required) =>
        scopes.some((s) => hasAllPermissions(resolvePermissions(assignments, s), required)),
      canAt: (locationId, ...required) =>
        hasAllPermissions(resolvePermissions(assignments, locationId), required),
    };
  }, [user]);
}
