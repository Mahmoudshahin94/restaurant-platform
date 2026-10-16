import type { Permission } from '@pos/shared-types';
import { Outlet } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { ForbiddenPage } from '../routes/not-found-page';

/** Hides routes the user cannot use. The API still enforces every permission. */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { canAnywhere } = usePermissions();
  return canAnywhere(permission) ? <Outlet /> : <ForbiddenPage />;
}
