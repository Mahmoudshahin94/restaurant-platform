import { Injectable } from '@nestjs/common';
import { DomainError, type RoleAssignment } from '@pos/domain';
import { isPermission } from '@pos/shared-types';
import type { AuthUser } from '@pos/validation';
import type { Principal } from '../../common/auth/principal';
import { PrismaService } from '../../prisma/prisma.service';

const userWithRolesInclude = {
  roles: { include: { role: { include: { permissions: true } } } },
} as const;

/** Loads a user's effective role assignments. Always read from the database, never from the token. */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async loadPrincipal(userId: string, restaurantId: string): Promise<Principal> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRolesInclude,
    });
    if (!user || user.restaurantId !== restaurantId) {
      throw new DomainError('UNAUTHENTICATED', 'Unknown user');
    }
    if (!user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    return {
      userId: user.id,
      restaurantId: user.restaurantId,
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
      restaurantId: user.restaurantId,
      roles: user.roles.map((ur) => ({
        roleId: ur.roleId,
        roleName: ur.role.name,
        locationId: ur.locationId,
        permissions: ur.role.permissions.map((p) => p.permissionKey).filter(isPermission),
      })),
    };
  }
}
