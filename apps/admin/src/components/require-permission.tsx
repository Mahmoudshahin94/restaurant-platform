import type { Permission } from '@pos/shared-types';
import { Outlet } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { ForbiddenPage } from '../routes/not-found-page';

/**
 * Hides routes the user cannot use (restaurant-wide pages need the permission restaurant-wide).
 * The API still enforces every permission.
 */
export function RequirePermission({
  permission,
  restaurantWide = false,
}: {
  permission: Permission;
  restaurantWide?: boolean;
}) {
  const { can, canAnywhere } = usePermissions();
  const allowed = restaurantWide ? can(permission) : canAnywhere(permission);
  return allowed ? <Outlet /> : <ForbiddenPage />;
}
