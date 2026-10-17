import { Injectable } from '@nestjs/common';
import { hashSecret } from '@pos/database';
import { DomainError, assertCanGrant } from '@pos/domain';
import {
  AuditService,
  type Principal,
  PrismaService,
  type PrismaTx,
  isUniqueViolation,
} from '@pos/server';
import { isPermission } from '@pos/shared-types';
import type {
  RoleAssignmentInput,
  StaffUser,
  UpdateUserRequest,
  createUserSchema,
} from '@pos/validation';
import type { z } from 'zod';

const userInclude = {
  roles: { include: { role: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
  employee: { select: { id: true, employeeCode: true } },
} as const;

type UserRow = Awaited<ReturnType<typeof loadUser>>;

function loadUser(tx: PrismaTx, restaurantId: string, userId: string) {
  return tx.user.findFirst({ where: { id: userId, restaurantId }, include: userInclude });
}

const toDto = (row: NonNullable<UserRow>): StaffUser => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  preferredLocale: row.preferredLocale,
  isActive: row.isActive,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  roles: row.roles.map((r) => ({
    roleId: r.roleId,
    roleName: r.role.name,
    locationId: r.locationId,
  })),
  employee: row.employee,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const key = (a: RoleAssignmentInput) => `${a.roleId}:${a.locationId ?? '*'}`;

/**
 * Back-office users (`users.manage`, restaurant-wide). Every change of what someone may do is a
 * permission change and is audited (`user.roles_changed` with the assignments before and after).
 * Guards: nobody grants or revokes a role holding permissions they lack (at that scope); nobody
 * changes their own roles or deactivates themselves; the restaurant always keeps an active
 * restaurant-wide holder of a system role (Owner). Deactivation and password resets end the
 * user's sessions at once. Passwords are hashed with argon2id and never logged or returned.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(restaurantId: string): Promise<StaffUser[]> {
    const rows = await this.prisma.user.findMany({
      where: { restaurantId },
      include: userInclude,
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(principal: Principal, input: z.output<typeof createUserSchema>): Promise<StaffUser> {
    const passwordHash = await hashSecret(input.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.checkAssignments(tx, principal, input.roles);
        const row = await tx.user.create({
          data: {
            restaurantId: principal.restaurantId,
            email: input.email,
            displayName: input.displayName,
            preferredLocale: input.preferredLocale,
            passwordHash,
            roles: { create: input.roles },
          },
          include: userInclude,
        });
        await this.audit.record(
          {
            action: 'user.created',
            entityType: 'User',
            entityId: row.id,
            locationId: null,
            metadata: { email: row.email, displayName: row.displayName },
          },
          tx,
        );
        if (input.roles.length > 0) {
          await this.recordRoleChange(tx, row.id, [], input.roles);
        }
        return toDto(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('CONFLICT', 'This email is already in use', {
          reason: 'EMAIL_TAKEN',
        });
      }
      throw error;
    }
  }

  async update(principal: Principal, userId: string, input: UpdateUserRequest): Promise<StaffUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.load(tx, principal.restaurantId, userId);
      if (input.isActive === false && before.isActive) {
        if (userId === principal.userId) {
          throw new DomainError('CONFLICT', 'You cannot deactivate yourself', { reason: 'SELF' });
        }
        // Deactivating someone takes away everything they can do.
        await this.checkAssignments(tx, principal, before.roles);
        await this.assertOwnerRemains(tx, principal.restaurantId, userId, []);
        await this.endSessions(tx, userId);
      }
      if (input.isActive === true && !before.isActive) {
        await this.checkAssignments(tx, principal, before.roles);
      }
      const row = await tx.user.update({
        where: { id: userId },
        data: input,
        include: userInclude,
      });
      const changes = Object.fromEntries(
        Object.entries(input).filter(([k, v]) => before[k as keyof typeof before] !== v),
      );
      if (Object.keys(changes).length > 0) {
        const action =
          input.isActive === false && before.isActive
            ? 'user.deactivated'
            : input.isActive === true && !before.isActive
              ? 'user.reactivated'
              : 'user.updated';
        await this.audit.record(
          { action, entityType: 'User', entityId: userId, locationId: null, metadata: { changes } },
          tx,
        );
      }
      return toDto(row);
    });
  }

  /** Replaces the user's role assignments (restaurant-wide or per location). */
  async setRoles(
    principal: Principal,
    userId: string,
    roles: RoleAssignmentInput[],
  ): Promise<StaffUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.load(tx, principal.restaurantId, userId);
      if (userId === principal.userId) {
        throw new DomainError('CONFLICT', 'You cannot change your own roles', { reason: 'SELF' });
      }
      const current = before.roles.map((r) => ({ roleId: r.roleId, locationId: r.locationId }));
      const wanted = new Set(roles.map(key));
      const had = new Set(current.map(key));
      const added = roles.filter((a) => !had.has(key(a)));
      const removed = current.filter((a) => !wanted.has(key(a)));
      await this.checkAssignments(tx, principal, [...added, ...removed]);
      await this.assertOwnerRemains(tx, principal.restaurantId, userId, roles);
      for (const a of removed) {
        await tx.userRole.deleteMany({
          where: { userId, roleId: a.roleId, locationId: a.locationId },
        });
      }
      if (added.length > 0) {
        await tx.userRole.createMany({ data: added.map((a) => ({ ...a, userId })) });
      }
      if (added.length > 0 || removed.length > 0) {
        await this.recordRoleChange(tx, userId, current, roles);
      }
      return toDto(await this.load(tx, principal.restaurantId, userId));
    });
  }

  async resetPassword(principal: Principal, userId: string, password: string): Promise<void> {
    const passwordHash = await hashSecret(password);
    await this.prisma.$transaction(async (tx) => {
      const user = await this.load(tx, principal.restaurantId, userId);
      // Taking over someone's account is as strong as holding their roles.
      if (userId !== principal.userId) await this.checkAssignments(tx, principal, user.roles);
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.endSessions(tx, userId);
      await this.audit.record(
        {
          action: 'user.password_reset',
          entityType: 'User',
          entityId: userId,
          locationId: null,
          metadata: { email: user.email },
        },
        tx,
      );
    });
  }

  private async load(tx: PrismaTx, restaurantId: string, userId: string) {
    const row = await loadUser(tx, restaurantId, userId);
    if (!row) throw new DomainError('USER_NOT_FOUND', 'User not found', { userId });
    return row;
  }

  /** Each role must be the restaurant's, each location too, and grantable by the caller there. */
  private async checkAssignments(
    tx: PrismaTx,
    principal: Principal,
    assignments: readonly RoleAssignmentInput[],
  ): Promise<void> {
    if (assignments.length === 0) return;
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const roles = await tx.role.findMany({
      where: { id: { in: roleIds }, restaurantId: principal.restaurantId },
      include: { permissions: { select: { permissionKey: true } } },
    });
    const missingRoles = roleIds.filter((id) => !roles.some((r) => r.id === id));
    if (missingRoles.length > 0) {
      throw new DomainError('ROLE_NOT_FOUND', 'Role not found', { roleIds: missingRoles });
    }
    const locationIds = [
      ...new Set(assignments.flatMap((a) => (a.locationId ? [a.locationId] : []))),
    ];
    const found = await tx.location.count({
      where: { id: { in: locationIds }, restaurantId: principal.restaurantId },
    });
    if (found !== locationIds.length) {
      throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    for (const a of assignments) {
      const role = roles.find((r) => r.id === a.roleId);
      const permissions = (role?.permissions ?? [])
        .map((p) => p.permissionKey)
        .filter(isPermission);
      assertCanGrant(principal.assignments, a.locationId, permissions);
    }
  }

  /**
   * The restaurant must keep an active user holding a system role restaurant-wide, or nobody
   * could administer it any more. `nextRoles` are the user's assignments after the change.
   */
  private async assertOwnerRemains(
    tx: PrismaTx,
    restaurantId: string,
    userId: string,
    nextRoles: readonly RoleAssignmentInput[],
  ): Promise<void> {
    const systemRoles = await tx.role.findMany({
      where: { restaurantId, isSystem: true },
      select: { id: true },
    });
    const systemIds = new Set(systemRoles.map((r) => r.id));
    if (nextRoles.some((a) => a.locationId === null && systemIds.has(a.roleId))) return;
    const others = await tx.userRole.count({
      where: {
        roleId: { in: [...systemIds] },
        locationId: null,
        userId: { not: userId },
        user: { isActive: true, restaurantId },
      },
    });
    if (others === 0) {
      throw new DomainError('CONFLICT', 'The restaurant needs at least one active owner', {
        reason: 'LAST_OWNER',
      });
    }
  }

  private async endSessions(tx: PrismaTx, userId: string): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async recordRoleChange(
    tx: PrismaTx,
    userId: string,
    before: readonly RoleAssignmentInput[],
    after: readonly RoleAssignmentInput[],
  ): Promise<void> {
    const roleIds = [...new Set([...before, ...after].map((a) => a.roleId))];
    const names = new Map(
      (
        await tx.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
      ).map((r) => [r.id, r.name]),
    );
    const describe = (list: readonly RoleAssignmentInput[]) =>
      list.map((a) => ({
        roleId: a.roleId,
        role: names.get(a.roleId) ?? null,
        locationId: a.locationId,
      }));
    await this.audit.record(
      {
        action: 'user.roles_changed',
        entityType: 'User',
        entityId: userId,
        locationId: null,
        metadata: { before: describe(before), after: describe(after) },
      },
      tx,
    );
  }
}
