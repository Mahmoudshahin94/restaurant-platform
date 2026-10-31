import { Injectable } from '@nestjs/common';
import { OWNER_ROLE, hashSecret } from '@pos/database';
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
import { OrganizationService } from '../../organizations/organization.service';

const userInclude = {
  roles: { include: { role: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
  employee: { select: { id: true, employeeCode: true } },
} as const;

type UserRow = Awaited<ReturnType<typeof loadUser>>;

function loadUser(tx: PrismaTx, tenantId: string, userId: string) {
  return tx.user.findFirst({ where: { id: userId, tenantId }, include: userInclude });
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
  managedByOrganization: row.organizationMemberId !== null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const key = (a: RoleAssignmentInput) => `${a.roleId}:${a.locationId ?? '*'}`;

const emailTaken = () =>
  new DomainError('CONFLICT', 'This email is already in use', { reason: 'EMAIL_TAKEN' });

/**
 * Back-office users (`users.manage`, tenant-wide). Every change of what someone may do is a
 * permission change and is audited (`user.roles_changed` with the assignments before and after).
 * Guards: nobody grants or revokes a role holding permissions they lack (at that scope); nobody
 * changes their own roles or deactivates themselves; the tenant always keeps an active
 * tenant-wide holder of a system role (Owner). Deactivation and password resets end the
 * user's sessions at once. Passwords are hashed with argon2id and never logged or returned.
 *
 * Accounts (E1): a user's login is an `Account`, possibly shared with the person's users in other
 * brands. A new e-mail gets a new account with the given password. An e-mail that already has an
 * account is linked only when the brand belongs to an organization in one of whose brands the
 * account already has a user (ADR 0029, R15; the given password is ignored: the person keeps
 * theirs, and the answer is the one a new e-mail gets). Any other existing account answers exactly
 * as an e-mail already taken in this brand (`CONFLICT`, `EMAIL_TAKEN`), so a brand can neither take
 * over nor detect an account that works elsewhere. A user its organization manages (`organizationMemberId`) is
 * changed only through the organization (`USER_MANAGED_BY_ORGANIZATION`), and a brand cannot reset
 * the password of an account that also signs into other brands (`CONFLICT`, `ACCOUNT_SHARED`).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationService,
  ) {}

  async list(tenantId: string): Promise<StaffUser[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
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
        // The login: a new account, or an existing one this brand may link (see the class). A
        // second user of the same account in this tenant is refused (EMAIL_TAKEN below).
        const existing = await tx.account.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existing && !(await this.mayLink(tx, principal.tenantId, existing.id))) {
          throw emailTaken();
        }
        const account =
          existing ??
          (await tx.account.create({
            data: { email: input.email, passwordHash, lastTenantId: principal.tenantId },
            select: { id: true },
          }));
        const row = await tx.user.create({
          data: {
            tenantId: principal.tenantId,
            accountId: account.id,
            email: input.email,
            displayName: input.displayName,
            preferredLocale: input.preferredLocale,
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
      if (isUniqueViolation(error)) throw emailTaken();
      throw error;
    }
  }

  /**
   * Whether the brand may link an existing account (R15): only when the brand belongs to an
   * organization and the account already has a user in one of its brands.
   */
  private async mayLink(tx: PrismaTx, tenantId: string, accountId: string): Promise<boolean> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { organizationId: true },
    });
    if (tenant.organizationId === null) return false;
    return this.organizations.worksInOrganization(accountId, tenant.organizationId);
  }

  async update(principal: Principal, userId: string, input: UpdateUserRequest): Promise<StaffUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.loadEditable(tx, principal.tenantId, userId);
      if (input.isActive === false && before.isActive) {
        if (userId === principal.userId) {
          throw new DomainError('CONFLICT', 'You cannot deactivate yourself', { reason: 'SELF' });
        }
        // Deactivating someone takes away everything they can do.
        await this.checkAssignments(tx, principal, before.roles);
        await this.assertOwnerRemains(tx, principal.tenantId, userId, []);
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

  /** Replaces the user's role assignments (tenant-wide or per location). */
  async setRoles(
    principal: Principal,
    userId: string,
    roles: RoleAssignmentInput[],
  ): Promise<StaffUser> {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.loadEditable(tx, principal.tenantId, userId);
      if (userId === principal.userId) {
        throw new DomainError('CONFLICT', 'You cannot change your own roles', { reason: 'SELF' });
      }
      const current = before.roles.map((r) => ({ roleId: r.roleId, locationId: r.locationId }));
      const wanted = new Set(roles.map(key));
      const had = new Set(current.map(key));
      const added = roles.filter((a) => !had.has(key(a)));
      const removed = current.filter((a) => !wanted.has(key(a)));
      await this.checkAssignments(tx, principal, [...added, ...removed]);
      await this.assertOwnerRemains(tx, principal.tenantId, userId, roles);
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
      return toDto(await this.load(tx, principal.tenantId, userId));
    });
  }

  async resetPassword(principal: Principal, userId: string, password: string): Promise<void> {
    const passwordHash = await hashSecret(password);
    await this.prisma.$transaction(async (tx) => {
      const user = await this.loadEditable(tx, principal.tenantId, userId);
      // The password is the account's: one brand cannot change how someone signs into others.
      const account = await tx.account.findUniqueOrThrow({
        where: { id: user.accountId },
        select: { _count: { select: { users: true } } },
      });
      if (account._count.users > 1) {
        throw new DomainError('CONFLICT', 'This person also signs into other brands', {
          reason: 'ACCOUNT_SHARED',
        });
      }
      // Taking over someone's account is as strong as holding their roles.
      if (userId !== principal.userId) await this.checkAssignments(tx, principal, user.roles);
      await tx.user.update({
        where: { id: userId },
        data: { account: { update: { passwordHash } } },
      });
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

  private async load(tx: PrismaTx, tenantId: string, userId: string) {
    const row = await loadUser(tx, tenantId, userId);
    if (!row) throw new DomainError('USER_NOT_FOUND', 'User not found', { userId });
    return row;
  }

  /** A user the brand may change: not one its organization manages (E1). */
  private async loadEditable(tx: PrismaTx, tenantId: string, userId: string) {
    const row = await this.load(tx, tenantId, userId);
    if (row.organizationMemberId !== null) {
      throw new DomainError(
        'USER_MANAGED_BY_ORGANIZATION',
        'This user is managed by the organization',
        { userId },
      );
    }
    return row;
  }

  /** Each role must be the tenant's, each location too, and grantable by the caller there. */
  private async checkAssignments(
    tx: PrismaTx,
    principal: Principal,
    assignments: readonly RoleAssignmentInput[],
  ): Promise<void> {
    if (assignments.length === 0) return;
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const roles = await tx.role.findMany({
      where: { id: { in: roleIds }, tenantId: principal.tenantId },
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
      where: { id: { in: locationIds }, tenantId: principal.tenantId },
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
   * The tenant must keep an active user holding the Owner role tenant-wide (Finance is a system
   * role too, but administers nothing), or nobody could administer it any more. `nextRoles` are the user's assignments after the change.
   */
  private async assertOwnerRemains(
    tx: PrismaTx,
    tenantId: string,
    userId: string,
    nextRoles: readonly RoleAssignmentInput[],
  ): Promise<void> {
    const ownerRoles = await tx.role.findMany({
      where: { tenantId, isSystem: true, name: OWNER_ROLE.name },
      select: { id: true },
    });
    const ownerIds = new Set(ownerRoles.map((r) => r.id));
    if (nextRoles.some((a) => a.locationId === null && ownerIds.has(a.roleId))) return;
    const others = await tx.userRole.count({
      where: {
        roleId: { in: [...ownerIds] },
        locationId: null,
        userId: { not: userId },
        user: { isActive: true, tenantId },
      },
    });
    if (others === 0) {
      throw new DomainError('CONFLICT', 'The tenant needs at least one active owner', {
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
