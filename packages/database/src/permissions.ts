import { PERMISSIONS } from '@pos/shared-types';
import type { PrismaClient } from '@prisma/client';

/**
 * Upserts the code-defined permission catalog into the `permissions` table. Idempotent; run by
 * the seed and at API start-up so new permission keys exist before roles reference them.
 */
export async function syncPermissionCatalog(prisma: PrismaClient): Promise<number> {
  // Insert only the missing keys (portable: `skipDuplicates` does not exist on SQLite, where the
  // location hub runs this too).
  const existing = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key),
  );
  const missing = PERMISSIONS.filter((key) => !existing.has(key));
  if (missing.length === 0) return 0;
  const result = await prisma.permission.createMany({ data: missing.map((key) => ({ key })) });
  return result.count;
}
