/**
 * Organization members for the development seed (E1). The API's OrganizationService owns this in
 * the running system (it audits, locks and reports); the seed cannot import the API, so it
 * writes the same rows: one linked user per member per brand, holding the brand role of the
 * member's organization role tenant-wide, marked `grantedByOrganization`.
 */
import { brandRoleFor } from '@pos/domain';
import type { OrganizationRole } from '@pos/shared-types';
import type { PrismaClient } from '@prisma/client';
import { BRAND_ROLE_SPECS, ensureRole } from './provisioning';

export interface SeedMember {
  id: string;
  accountId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
}

/**
 * Gives the member their user in one brand: created when the account has none there, otherwise
 * linked and holding exactly the organization's assignment. A user the brand deactivated is left
 * alone. Returns false when linking was skipped.
 */
export async function linkMember(
  prisma: PrismaClient,
  tenantId: string,
  member: SeedMember,
): Promise<boolean> {
  const roleId = await ensureRole(prisma, tenantId, BRAND_ROLE_SPECS[brandRoleFor(member.role)]);
  const user = await prisma.user.findUnique({
    where: { tenantId_accountId: { tenantId, accountId: member.accountId } },
    select: {
      id: true,
      isActive: true,
      organizationMemberId: true,
      roles: { select: { roleId: true, locationId: true, grantedByOrganization: true } },
    },
  });
  if (!user) {
    await prisma.user.create({
      data: {
        tenantId,
        accountId: member.accountId,
        email: member.email,
        displayName: member.displayName,
        organizationMemberId: member.id,
        roles: { create: { roleId, locationId: null, grantedByOrganization: true } },
      },
    });
    return true;
  }
  if (!user.isActive && user.organizationMemberId === null) return false;
  const granted = user.roles.filter((r) => r.grantedByOrganization);
  const holdsItself = user.roles.some(
    (r) => !r.grantedByOrganization && r.roleId === roleId && r.locationId === null,
  );
  const grantsRight = holdsItself
    ? granted.length === 0
    : granted.length === 1 && granted[0]?.roleId === roleId && granted[0].locationId === null;
  if (!grantsRight) {
    await prisma.userRole.deleteMany({ where: { userId: user.id, grantedByOrganization: true } });
    if (!holdsItself) {
      await prisma.userRole.create({
        data: { userId: user.id, roleId, locationId: null, grantedByOrganization: true },
      });
    }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { organizationMemberId: member.id, isActive: true },
  });
  return true;
}
