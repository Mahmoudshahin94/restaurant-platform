import { type PermissionChecks, usePermissionChecks } from '@pos/app-kit';
import { useSession } from '../stores/session';

export function usePermissions(): PermissionChecks {
  return usePermissionChecks(useSession((s) => s.user));
}
