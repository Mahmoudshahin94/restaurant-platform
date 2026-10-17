import { PERMISSIONS } from '@pos/shared-types';
import type { PrismaClient } from '@prisma/client';

/**
 * Upserts the code-defined permission catalog into the `permissions` table and grants every key
 * to system roles (the Owner role holds all permissions, including keys added after it was
 * created). Idempotent; run by the seed and at API start-up so new permission keys exist before
 * roles reference them.
 */
export async function syncPermissionCatalog(prisma: PrismaClient): Promise<number> {
  // Insert only the missing keys (portable: `skipDuplicates` does not exist on SQLite, where the
  // location hub runs this too).
  const existing = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key),
  );
  const missing = PERMISSIONS.filter((key) => !existing.has(key));
  const added =
    missing.length === 0
      ? 0
      : (await prisma.permission.createMany({ data: missing.map((key) => ({ key })) })).count;

  const systemRoles = await prisma.role.findMany({
    where: { isSystem: true },
    select: { id: true, permissions: { select: { permissionKey: true } } },
  });
  const grants = systemRoles.flatMap((role) => {
    const held = new Set(role.permissions.map((p) => p.permissionKey));
    return PERMISSIONS.filter((key) => !held.has(key)).map((permissionKey) => ({
      roleId: role.id,
      permissionKey,
    }));
  });
  if (grants.length > 0) await prisma.rolePermission.createMany({ data: grants });
  return added;
}
