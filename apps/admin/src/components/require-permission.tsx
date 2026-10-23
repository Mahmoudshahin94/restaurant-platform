import type { Permission } from '@pos/shared-types';
import { Outlet } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { ForbiddenPage } from '../routes/not-found-page';

/**
 * Hides routes the user cannot use (tenant-wide pages need the permission tenant-wide).
 * The API still enforces every permission.
 */
export function RequirePermission({
  permission,
  tenantWide = false,
}: {
  permission: Permission;
  tenantWide?: boolean;
}) {
  const { can, canAnywhere } = usePermissions();
  const allowed = tenantWide ? can(permission) : canAnywhere(permission);
  return allowed ? <Outlet /> : <ForbiddenPage />;
}
