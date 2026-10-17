import { PERMISSIONS } from '@pos/shared-types';
import type { PrismaClient } from '@prisma/client';

/**
 * Upserts the code-defined permission catalog into the `permissions` table. Idempotent; run by
 * the seed and at API start-up so new permission keys exist before roles reference them.
 */
export async function syncPermissionCatalog(prisma: PrismaClient): Promise<number> {
  const result = await prisma.permission.createMany({
    data: PERMISSIONS.map((key) => ({ key })),
    skipDuplicates: true,
  });
  return result.count;
}
