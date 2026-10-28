import { hasPlatformPermissions } from '@pos/domain';
import type { PlatformPermission } from '@pos/shared-types';
import { useCallback } from 'react';
import { useSession } from './api';

/** What the signed-in operator's role allows (the API checks it again on every call). */
export function usePlatformCan(): (...permissions: PlatformPermission[]) => boolean {
  const role = useSession((s) => s.user?.role ?? null);
  return useCallback(
    (...permissions: PlatformPermission[]) =>
      role !== null && hasPlatformPermissions(role, permissions),
    [role],
  );
}
