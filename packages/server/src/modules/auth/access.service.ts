import { Injectable } from '@nestjs/common';
import { DomainError, type RoleAssignment, assertTenantAccess } from '@pos/domain';
import { isPermission } from '@pos/shared-types';
import type { AuthUser } from '@pos/validation';
import type { Principal } from '../../common/auth/principal';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
    if (!user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    assertTenantAccess(user.tenant.status, 'read');
    return {
      tenantStatus: user.tenant.status,
      userId: user.id,
      tenantId: user.tenantId,
      assignments: user.roles.map((ur): RoleAssignment => ({
        locationId: ur.locationId,
        permissions: ur.role.permissions.map((p) => p.permissionKey).filter(isPermission),
      })),
    };
  }

  async loadAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: userWithRolesInclude,
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      preferredLocale: user.preferredLocale,
      tenantId: user.tenantId,
      roles: user.roles.map((ur) => ({
        roleId: ur.roleId,
        roleName: ur.role.name,
        locationId: ur.locationId,
        permissions: ur.role.permissions.map((p) => p.permissionKey).filter(isPermission),
      })),
    };
  }
}
