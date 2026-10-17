import { Injectable } from '@nestjs/common';
import { DomainError, assertCanGrant } from '@pos/domain';
import {
  AuditService,
  type Principal,
  PrismaService,
  type PrismaTx,
  isUniqueViolation,
} from '@pos/server';
import { PERMISSIONS, type Permission, isPermission } from '@pos/shared-types';
import type { Role, createRoleSchema, updateRoleSchema } from '@pos/validation';
import type { z } from 'zod';

const roleInclude = {
  permissions: { select: { permissionKey: true } },
  _count: { select: { users: true } },
} as const;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: { permissionKey: string }[];
  _count: { users: number };
};

/** Catalog order, so the matrix and audit diffs are stable. */
const ordered = (keys: Iterable<string>): Permission[] => {
  const set = new Set(keys);
  return PERMISSIONS.filter((p) => set.has(p));
};

export const toRoleDto = (row: RoleRow): Role => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isSystem: row.isSystem,
  permissions: ordered(row.permissions.map((p) => p.permissionKey).filter(isPermission)),
  userCount: row._count.users,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Roles and their permission matrix (`roles.manage`). Permission changes are audited as
 * `role.permissions_changed` with what was added and removed. Nobody can create or widen a role
 * beyond the permissions they hold themselves, and system roles (Owner) are fixed.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(restaurantId: string): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({
      where: { restaurantId },
      include: roleInclude,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toRoleDto);
  }

  async create(principal: Principal, input: z.output<typeof createRoleSchema>): Promise<Role> {
    assertCanGrant(principal.assignments, null, input.permissions);
    return this.uniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.role.create({
          data: {
            restaurantId: principal.restaurantId,
            name: input.name,
            description: input.description,
            permissions: { create: input.permissions.map((permissionKey) => ({ permissionKey })) },
          },
          include: roleInclude,
        });
        await this.audit.record(
          {
            action: 'role.created',
            entityType: 'Role',
            entityId: row.id,
            locationId: null,
            metadata: { name: row.name, permissions: ordered(input.permissions) },
          },
          tx,
        );
        return toRoleDto(row);
      }),
    );
  }

  async update(
    principal: Principal,
    roleId: string,
    input: z.output<typeof updateRoleSchema>,
  ): Promise<Role> {
    return this.uniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.load(tx, principal.restaurantId, roleId);
        if (before.isSystem) {
          throw new DomainError('CONFLICT', 'System roles cannot be changed', {
            reason: 'SYSTEM_ROLE',
          });
        }
        const held = before.permissions.map((p) => p.permissionKey).filter(isPermission);
        let added: Permission[] = [];
        let removed: Permission[] = [];
        if (input.permissions) {
          const next = new Set(input.permissions);
          added = input.permissions.filter((p) => !held.includes(p));
          removed = held.filter((p) => !next.has(p));
          // Both widening and narrowing a role change what its holders can do.
          assertCanGrant(principal.assignments, null, [...added, ...removed]);
          await tx.rolePermission.deleteMany({
            where: { roleId, permissionKey: { in: removed } },
          });
          if (added.length > 0) {
            await tx.rolePermission.createMany({
              data: added.map((permissionKey) => ({ roleId, permissionKey })),
            });
          }
        }
        const row = await tx.role.update({
          where: { id: roleId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
          include: roleInclude,
        });
        if (added.length > 0 || removed.length > 0) {
          await this.audit.record(
            {
              action: 'role.permissions_changed',
              entityType: 'Role',
              entityId: roleId,
              locationId: null,
              metadata: {
                name: row.name,
                added: ordered(added),
                removed: ordered(removed),
                holders: row._count.users,
              },
            },
            tx,
          );
        }
        if (input.name !== undefined || input.description !== undefined) {
          await this.audit.record(
            {
              action: 'role.updated',
              entityType: 'Role',
              entityId: roleId,
              locationId: null,
              metadata: {
                before: { name: before.name, description: before.description },
                after: { name: row.name, description: row.description },
              },
            },
            tx,
          );
        }
        return toRoleDto(row);
      }),
    );
  }

  /** Roles are deleted only while nobody holds them; system roles never. */
  async remove(principal: Principal, roleId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const role = await this.load(tx, principal.restaurantId, roleId);
      if (role.isSystem) {
        throw new DomainError('CONFLICT', 'System roles cannot be deleted', {
          reason: 'SYSTEM_ROLE',
        });
      }
      if (role._count.users > 0) {
        throw new DomainError('CONFLICT', 'Remove the role from its users first', {
          reason: 'IN_USE',
          users: role._count.users,
        });
      }
      const permissions = role.permissions.map((p) => p.permissionKey).filter(isPermission);
      assertCanGrant(principal.assignments, null, permissions);
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(
        {
          action: 'role.deleted',
          entityType: 'Role',
          entityId: roleId,
          locationId: null,
          metadata: { name: role.name, permissions: ordered(permissions) },
        },
        tx,
      );
    });
  }

  private async load(tx: PrismaTx, restaurantId: string, roleId: string): Promise<RoleRow> {
    const row = await tx.role.findFirst({
      where: { id: roleId, restaurantId },
      include: roleInclude,
    });
    if (!row) throw new DomainError('ROLE_NOT_FOUND', 'Role not found', { roleId });
    return row;
  }

  private async uniqueName<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('CONFLICT', 'A role with this name exists', {
          reason: 'NAME_TAKEN',
        });
      }
      throw error;
    }
  }
}
