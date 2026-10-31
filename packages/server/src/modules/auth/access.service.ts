import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type RoleAssignment, assertTenantAccess } from '@pos/domain';
import { isPermission } from '@pos/shared-types';
import type { AuthUser } from '@pos/validation';
import type { Principal } from '../../common/auth/principal';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCOUNT_DIRECTORY, type AccountDirectory } from './account-directory';

/** What decides whether a user's roles count (E1): its organization link, if any. */
interface UserAccess<R> {
  accountId: string;
  tenantId: string;
  organizationMemberId: string | null;
  roles: readonly R[];
}

const userWithRolesInclude = {
  roles: { include: { role: { include: { permissions: true } } } },
} as const;

const principalInclude = {
  ...userWithRolesInclude,
  tenant: { select: { status: true } },
} as const;

/** Loads a user's effective role assignments. Always read from the database, never from the token. */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ACCOUNT_DIRECTORY) private readonly directory: AccountDirectory,
  ) {}

  /**
   * Loads the user inside the token's tenant, so a user of another tenant is simply unknown. A
   * suspended tenant's staff are refused here (ADR 0025), on every route and the realtime socket.
   */
  async loadPrincipal(userId: string, tenantId: string): Promise<Principal> {
    const user = await TenantContext.runInTenant(tenantId, () =>
      this.prisma.user.findUnique({ where: { id: userId }, include: principalInclude }),
    );
    if (!user || user.tenantId !== tenantId) {
      throw new DomainError('UNAUTHENTICATED', 'Unknown user');
    }
    const roles = user.isActive ? await this.activeRoles(user) : null;
    if (!roles) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    assertTenantAccess(user.tenant.status, 'read');
    return {
      tenantStatus: user.tenant.status,
      userId: user.id,
      tenantId: user.tenantId,
      assignments: roles.map((ur): RoleAssignment => ({
        locationId: ur.locationId,
        permissions: ur.role.permissions.map((p) => p.permissionKey).filter(isPermission),
      })),
    };
  }

  /**
   * Whether the user may start or keep a session: active, and not a user holding only roles an
   * organization added while that organization's link no longer stands (`activeRoles`). Read in
   * the scope of the user's tenant.
   */
  async isUsable(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isActive: true,
        accountId: true,
        tenantId: true,
        organizationMemberId: true,
        roles: { select: { grantedByOrganization: true } },
      },
    });
    return user?.isActive === true && (await this.activeRoles(user)) !== null;
  }

  /**
   * The role assignments that count for a user (E1). The roles an organization added count only
   * while its link stands (`AccountDirectory.organizationLinkActive`: the membership in the brand's
   * organization, the organization active); a user holding nothing else is then disabled (`null`),
   * like a deactivated one, while a user with roles of their own keeps those.
   */
  private async activeRoles<R extends { grantedByOrganization: boolean }>(
    user: UserAccess<R>,
  ): Promise<readonly R[] | null> {
    const { organizationMemberId } = user;
    if (organizationMemberId === null) return user.roles;
    const linked = await this.directory.organizationLinkActive({
      accountId: user.accountId,
      tenantId: user.tenantId,
      organizationMemberId,
    });
    if (linked) return user.roles;
    const own = user.roles.filter((r) => !r.grantedByOrganization);
    return own.length > 0 ? own : null;
  }

  /** The signed-in user, with the brands and organizations of their account (for the switcher). */
  async loadAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: userWithRolesInclude,
    });
    const roles = (await this.activeRoles(user)) ?? [];
    const [tenants, organizations] = await Promise.all([
      this.directory.brandsFor(user.accountId),
      this.directory.organizationsFor(user.accountId),
    ]);
    return {
      id: user.id,
      accountId: user.accountId,
      email: user.email,
      displayName: user.displayName,
      preferredLocale: user.preferredLocale,
      tenantId: user.tenantId,
      roles: roles.map((ur) => ({
        roleId: ur.roleId,
        roleName: ur.role.name,
        locationId: ur.locationId,
        permissions: ur.role.permissions.map((p) => p.permissionKey).filter(isPermission),
      })),
      tenants,
      organizations,
    };
  }
}
