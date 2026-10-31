import { Injectable } from '@nestjs/common';
import { type AccountDirectory, type LinkedUser, PrismaService, TenantContext } from '@pos/server';
import type { AuthBrand, AuthOrganization } from '@pos/validation';

/**
 * The cloud's account directory: an account's users across every tenant, and its organization
 * memberships. Cross-tenant by nature (one person, several brands), so the user lookup runs
 * unscoped; this file is on the `pos-local/no-unscoped-prisma` allowlist.
 */
@Injectable()
export class CloudAccountDirectory implements AccountDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async brandsFor(accountId: string): Promise<AuthBrand[]> {
    const users = await TenantContext.runUnscoped(
      "the account directory lists the account's users in every brand",
      () =>
        this.prisma.user.findMany({
          where: { accountId, isActive: true, tenant: { status: { not: 'SUSPENDED' } } },
          orderBy: { createdAt: 'asc' },
          select: {
            organizationMemberId: true,
            roles: { select: { grantedByOrganization: true } },
            tenant: {
              select: {
                id: true,
                nameEn: true,
                nameAr: true,
                organizationId: true,
                organization: { select: { status: true } },
                branding: { select: { logoFileId: true } },
              },
            },
          },
        }),
    );
    // A user the organization manages counts while its membership stands in the brand's
    // organization and that organization is active, or while it holds a role of its own.
    const memberIds = users.flatMap((u) =>
      u.organizationMemberId ? [u.organizationMemberId] : [],
    );
    const members =
      memberIds.length === 0
        ? []
        : await this.prisma.organizationMember.findMany({
            where: { id: { in: memberIds }, accountId },
            select: { id: true, organizationId: true },
          });
    const memberOrganization = new Map(members.map((m) => [m.id, m.organizationId]));
    return users
      .filter(
        ({ organizationMemberId, roles, tenant }) =>
          organizationMemberId === null ||
          roles.some((r) => !r.grantedByOrganization) ||
          (tenant.organization?.status === 'ACTIVE' &&
            memberOrganization.get(organizationMemberId) === tenant.organizationId),
      )
      .map(({ tenant }) => ({
        id: tenant.id,
        nameEn: tenant.nameEn,
        nameAr: tenant.nameAr,
        logoFileId: tenant.branding?.logoFileId ?? null,
        organizationId: tenant.organizationId,
      }));
  }

  async organizationsFor(accountId: string): Promise<AuthOrganization[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { accountId, organization: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { role: true, organization: { select: { id: true, nameEn: true, nameAr: true } } },
    });
    return memberships.map(({ role, organization }) => ({ ...organization, role }));
  }

  async organizationLinkActive(user: LinkedUser): Promise<boolean> {
    const member = await this.prisma.organizationMember.findFirst({
      where: {
        id: user.organizationMemberId,
        accountId: user.accountId,
        organization: { status: 'ACTIVE', tenants: { some: { id: user.tenantId } } },
      },
      select: { id: true },
    });
    return member !== null;
  }
}
