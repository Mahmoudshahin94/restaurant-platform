import { Injectable } from '@nestjs/common';
import { BRAND_ROLE_SPECS, type Prisma, ensureRole, hashSecret } from '@pos/database';
import {
  DomainError,
  assertOrganizationCurrency,
  assertOwnersRemain,
  brandRoleFor,
} from '@pos/domain';
import {
  type ActorType,
  AuditService,
  PrismaService,
  type PrismaTx,
  TenantContext,
  isUniqueViolation,
} from '@pos/server';
import type { OrganizationRole } from '@pos/shared-types';
import type { LinkedMemberDto, MemberDto, addMemberSchema } from '@pos/validation';
import type { z } from 'zod';

/** Who changes an organization: one of its members (a staff user), MADAR's operator, or a repair. */
export type OrganizationActor =
  | { kind: 'user'; userId: string }
  | { kind: 'platform'; platformUserId: string }
  | { kind: 'system' };

type AddMemberInput = z.output<typeof addMemberSchema>;

/** A member's brand where linking was skipped: the brand had deactivated the person's own user. */
export interface SkippedLink {
  memberId: string;
  tenantId: string;
}

interface MemberRow {
  id: string;
  accountId: string;
  role: OrganizationRole;
  displayName: string;
  createdAt: Date;
  account: { email: string };
}

interface UserRow {
  id: string;
  tenantId: string;
  roles: {
    id: string;
    roleId: string;
    locationId: string | null;
    grantedByOrganization: boolean;
  }[];
}

const memberSelect = {
  id: true,
  accountId: true,
  role: true,
  displayName: true,
  createdAt: true,
  account: { select: { email: true } },
} as const;

const userSelect = {
  id: true,
  tenantId: true,
  isActive: true,
  organizationMemberId: true,
  roles: { select: { id: true, roleId: true, locationId: true, grantedByOrganization: true } },
} as const;

/**
 * Users an unlink still has something to do for: active, or holding a role the organization gave
 * (a user the organization deactivated keeps its `organizationMemberId` and has neither).
 */
const STILL_LINKED: Prisma.UserWhereInput = {
  OR: [{ isActive: true }, { roles: { some: { grantedByOrganization: true } } }],
};

const toMemberDto = (row: MemberRow): MemberDto => ({
  id: row.id,
  accountId: row.accountId,
  email: row.account.email,
  displayName: row.displayName,
  role: row.role,
  createdAt: row.createdAt.toISOString(),
});

/** Work across many brands grows with the organization: a longer limit than Prisma's 5 s. */
const TRANSACTION = { timeout: 30_000 } as const;

const memberNotFound = () => new DomainError('NOT_FOUND', 'Member not found');

const passwordRequired = () =>
  new DomainError('VALIDATION_FAILED', 'A new account needs a starting password', {
    fields: { password: 'required' },
  });

/**
 * Organizations' members and their linked users (E1, spec §3.3): the only writer of users the
 * organization manages. A member has a user in every brand of the organization holding the brand
 * role of their organization role (`brandRoleFor`), tenant-wide, with `organizationMemberId` set.
 *
 * A person who already has their own user in a brand keeps it: the organization's role is added
 * to it as an assignment marked `grantedByOrganization` (none is added when they already hold that
 * role tenant-wide). When the membership ends, or the brand leaves the organization, only the
 * marked assignments are removed and `organizationMemberId` is cleared; a user left with no role
 * of their own — one the organization created — is deactivated and its sessions revoked; it keeps
 * its `organizationMemberId`, which marks it as deactivated by the organization (so a later link may
 * reactivate it) — until the brand leaves the organization, which clears every mark so the
 * brand owns its users again.
 *
 * Linking never reactivates a user the brand deactivated (an inactive user with no
 * `organizationMemberId`): that brand is skipped, audited as `user.organization_link_skipped`, and
 * reported to the caller; once the brand reactivates the user, a sync links them.
 *
 * One request changes users of many brands, so the writes run unscoped (this file is on the
 * `pos-local/no-unscoped-prisma` allowlist), always limited to the organization's brands. Member
 * changes of one organization are serialized by a row lock, so two owners cannot demote each other
 * at once. Each change is audited in the brand it touches.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMembers(organizationId: string): Promise<MemberDto[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      select: memberSelect,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMemberDto);
  }

  /**
   * Whether the account already has a user in one of the organization's brands. Only then may the
   * organization's owner, or a brand of the organization, link the account without a platform
   * operator (ADR 0029, R15): without proof that the e-mail is theirs, linking any other account
   * would let them take over a person who works elsewhere.
   */
  async worksInOrganization(accountId: string, organizationId: string): Promise<boolean> {
    const users = await TenantContext.runUnscoped(
      "linking an account: its users in the organization's brands",
      () => this.prisma.user.count({ where: { accountId, tenant: { organizationId } } }),
    );
    return users > 0;
  }

  /**
   * Adds a person by e-mail. A new e-mail gets a new account, which needs a starting password. An
   * e-mail that already has an account is that person, who keeps their own password, when a
   * platform operator adds them or they already have a user in one of the organization's brands
   * (R15). For an owner, any other existing account answers as a new e-mail without a password
   * does (`VALIDATION_FAILED`), and with a password as an e-mail already taken (`CONFLICT`,
   * `EMAIL_TAKEN`): the answer never tells that the e-mail has an account elsewhere.
   */
  async addMember(
    organizationId: string,
    input: AddMemberInput,
    actor: OrganizationActor,
  ): Promise<LinkedMemberDto> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = input.password ? await hashSecret(input.password) : null;
    try {
      return await TenantContext.runUnscoped(
        "an organization adds a member: the member's users in every brand",
        () =>
          this.prisma.$transaction(async (tx) => {
            const organization = await this.lock(tx, organizationId);
            const found = await tx.account.findUnique({ where: { email }, select: { id: true } });
            if (found) {
              const existing = await tx.organizationMember.findUnique({
                where: { organizationId_accountId: { organizationId, accountId: found.id } },
                select: { id: true },
              });
              if (existing) {
                throw new DomainError('CONFLICT', 'This person is already a member', {
                  reason: 'ALREADY_MEMBER',
                });
              }
              const linkable =
                actor.kind === 'platform' ||
                (await tx.user.count({
                  where: { accountId: found.id, tenantId: { in: organization.tenantIds } },
                })) > 0;
              if (!linkable) {
                // As for an e-mail with no account: a password is needed first; with one, the
                // e-mail is taken.
                if (!passwordHash) throw passwordRequired();
                throw new DomainError('CONFLICT', 'This email is already in use', {
                  reason: 'EMAIL_TAKEN',
                });
              }
            }
            const account = found ?? (await this.newAccount(tx, email, passwordHash));
            const member = await tx.organizationMember.create({
              data: {
                organizationId,
                accountId: account.id,
                role: input.role,
                displayName: input.displayName,
              },
              select: memberSelect,
            });
            const skippedTenantIds: string[] = [];
            for (const tenantId of organization.tenantIds) {
              if (await this.link(tx, tenantId, organizationId, member, actor)) {
                skippedTenantIds.push(tenantId);
              }
            }
            return { ...toMemberDto(member), skippedTenantIds };
          }, TRANSACTION),
      );
    } catch (error) {
      // Two requests adding the same new e-mail at once.
      if (isUniqueViolation(error)) {
        throw new DomainError('CONFLICT', 'This person is already a member', {
          reason: 'ALREADY_MEMBER',
        });
      }
      throw error;
    }
  }

  /** Replaces a member's role, and so their brand role in every brand. */
  async changeRole(
    organizationId: string,
    memberId: string,
    role: OrganizationRole,
    actor: OrganizationActor,
  ): Promise<LinkedMemberDto> {
    return TenantContext.runUnscoped("an organization changes a member's role in every brand", () =>
      this.prisma.$transaction(async (tx) => {
        const organization = await this.lock(tx, organizationId);
        const members = await this.members(tx, organizationId);
        if (!members.some((m) => m.id === memberId)) throw memberNotFound();
        assertOwnersRemain(members, { memberId, role });
        const member = await tx.organizationMember.update({
          where: { id: memberId },
          data: { role },
          select: memberSelect,
        });
        const skippedTenantIds: string[] = [];
        for (const tenantId of organization.tenantIds) {
          if (await this.link(tx, tenantId, organizationId, member, actor)) {
            skippedTenantIds.push(tenantId);
          }
        }
        return { ...toMemberDto(member), skippedTenantIds };
      }, TRANSACTION),
    );
  }

  /** Ends a membership: the member's linked users are unlinked in every brand (see the class). */
  async removeMember(
    organizationId: string,
    memberId: string,
    actor: OrganizationActor,
  ): Promise<void> {
    await TenantContext.runUnscoped(
      "an organization removes a member: the member's users in every brand",
      () =>
        this.prisma.$transaction(async (tx) => {
          const organization = await this.lock(tx, organizationId);
          const members = await this.members(tx, organizationId);
          if (!members.some((m) => m.id === memberId)) throw memberNotFound();
          assertOwnersRemain(members, { memberId, role: null });
          await tx.organizationMember.delete({ where: { id: memberId } });
          const users = await tx.user.findMany({
            where: {
              tenantId: { in: organization.tenantIds },
              organizationMemberId: memberId,
              ...STILL_LINKED,
            },
            select: userSelect,
          });
          for (const user of users) await this.unlink(tx, user, organizationId, memberId, actor);
        }, TRANSACTION),
    );
  }

  /**
   * Brings a brand into the organization, in the organization's currency only: every member gets
   * their linked user there. Attaching a brand the organization already holds repairs its users.
   */
  async attachTenant(
    organizationId: string,
    tenantId: string,
    actor: OrganizationActor,
  ): Promise<{ skippedMemberIds: string[] }> {
    return TenantContext.runUnscoped(
      "an organization takes in a brand: its members' users there",
      () =>
        this.prisma.$transaction(async (tx) => {
          const organization = await this.lock(tx, organizationId);
          const tenant = await tx.tenant.findUnique({
            where: { id: tenantId },
            select: { organizationId: true, currencyCode: true },
          });
          if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
          if (tenant.organizationId !== null && tenant.organizationId !== organizationId) {
            throw new DomainError('CONFLICT', 'The brand belongs to another organization', {
              reason: 'TENANT_IN_ORGANIZATION',
            });
          }
          assertOrganizationCurrency(organization.currencyCode, tenant.currencyCode);
          if (tenant.organizationId === null) {
            await tx.tenant.update({ where: { id: tenantId }, data: { organizationId } });
            await this.record(tx, actor, tenantId, {
              action: 'organization.brand_attached',
              entityType: 'Tenant',
              entityId: tenantId,
              metadata: { organizationId },
            });
          }
          const skippedMemberIds: string[] = [];
          for (const member of await this.members(tx, organizationId)) {
            if (await this.link(tx, tenantId, organizationId, member, actor)) {
              skippedMemberIds.push(member.id);
            }
          }
          return { skippedMemberIds };
        }, TRANSACTION),
    );
  }

  /**
   * Takes a brand out of the organization: its linked users are unlinked (see the class), then no
   * user of the brand stays marked as the organization's.
   */
  async detachTenant(
    organizationId: string,
    tenantId: string,
    actor: OrganizationActor,
  ): Promise<void> {
    await TenantContext.runUnscoped(
      "an organization lets a brand go: its members' users there",
      () =>
        this.prisma.$transaction(async (tx) => {
          const organization = await this.lock(tx, organizationId);
          if (!organization.tenantIds.includes(tenantId)) {
            throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
          }
          await tx.tenant.update({ where: { id: tenantId }, data: { organizationId: null } });
          const users = await tx.user.findMany({
            where: { tenantId, organizationMemberId: { not: null }, ...STILL_LINKED },
            select: userSelect,
          });
          for (const user of users) {
            await this.unlink(tx, user, organizationId, user.organizationMemberId, actor);
          }
          // The brand owns its users again, including those the organization deactivated: its
          // admin may reactivate or edit them (a re-attach then skips them until it does).
          await tx.user.updateMany({
            where: { tenantId, organizationMemberId: { not: null } },
            data: { organizationMemberId: null },
          });
          await this.record(tx, actor, tenantId, {
            action: 'organization.brand_detached',
            entityType: 'Tenant',
            entityId: tenantId,
            metadata: { organizationId },
          });
        }, TRANSACTION),
    );
  }

  /**
   * Brings every member × brand to the table above (idempotent): missing linked users are created,
   * ones the organization deactivated restored with their role, users linked to a membership that
   * no longer exists unlinked. Brands that deactivated the person's own user are skipped and
   * returned.
   */
  async syncLinkedUsers(organizationId: string): Promise<{ skipped: SkippedLink[] }> {
    const actor: OrganizationActor = { kind: 'system' };
    return TenantContext.runUnscoped("an organization repairs its members' users", () =>
      this.prisma.$transaction(async (tx) => {
        const organization = await this.lock(tx, organizationId);
        const members = await this.members(tx, organizationId);
        const skipped: SkippedLink[] = [];
        for (const tenantId of organization.tenantIds) {
          for (const member of members) {
            if (await this.link(tx, tenantId, organizationId, member, actor)) {
              skipped.push({ memberId: member.id, tenantId });
            }
          }
        }
        const stale = await tx.user.findMany({
          where: {
            tenantId: { in: organization.tenantIds },
            organizationMemberId: { not: null, notIn: members.map((m) => m.id) },
            ...STILL_LINKED,
          },
          select: userSelect,
        });
        for (const user of stale) {
          await this.unlink(tx, user, organizationId, user.organizationMemberId, actor);
        }
        return { skipped };
      }, TRANSACTION),
    );
  }

  /**
   * The organization, locked for the rest of the transaction so member changes run one at a time,
   * with its brands. A missing organization is not found.
   */
  private async lock(tx: PrismaTx, organizationId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new DomainError('ORGANIZATION_NOT_FOUND', 'Organization not found');
    }
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        currencyCode: true,
        tenants: { select: { id: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return {
      currencyCode: organization.currencyCode,
      tenantIds: organization.tenants.map((t) => t.id),
    };
  }

  private members(tx: PrismaTx, organizationId: string): Promise<MemberRow[]> {
    return tx.organizationMember.findMany({
      where: { organizationId },
      select: memberSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  private async newAccount(
    tx: PrismaTx,
    email: string,
    passwordHash: string | null,
  ): Promise<{ id: string }> {
    if (!passwordHash) throw passwordRequired();
    return tx.account.create({ data: { email, passwordHash }, select: { id: true } });
  }

  /**
   * Gives the member their linked user in one brand: created when the account has no user there,
   * otherwise linked, (re)activated, and holding exactly the organization's assignment (none when
   * the user's own roles already include that brand role tenant-wide). Unchanged users are left
   * alone. A user the brand deactivated is not touched: returns true (skipped).
   */
  private async link(
    tx: PrismaTx,
    tenantId: string,
    organizationId: string,
    member: MemberRow,
    actor: OrganizationActor,
  ): Promise<boolean> {
    const brandRole = brandRoleFor(member.role);
    const roleId = await ensureRole(tx, tenantId, BRAND_ROLE_SPECS[brandRole]);
    const metadata = { organizationId, memberId: member.id, role: member.role, brandRole };
    const user = await tx.user.findUnique({
      where: { tenantId_accountId: { tenantId, accountId: member.accountId } },
      select: userSelect,
    });
    if (!user) {
      const created = await tx.user.create({
        data: {
          tenantId,
          accountId: member.accountId,
          email: member.account.email,
          displayName: member.displayName,
          organizationMemberId: member.id,
          roles: { create: { roleId, locationId: null, grantedByOrganization: true } },
        },
        select: { id: true },
      });
      await this.record(tx, actor, tenantId, {
        action: 'user.organization_linked',
        entityType: 'User',
        entityId: created.id,
        metadata: { ...metadata, created: true },
      });
      return false;
    }
    if (!user.isActive && user.organizationMemberId === null) {
      await this.record(tx, actor, tenantId, {
        action: 'user.organization_link_skipped',
        entityType: 'User',
        entityId: user.id,
        metadata: { organizationId, memberId: member.id, reason: 'USER_DEACTIVATED' },
      });
      return true;
    }
    const granted = user.roles.filter((r) => r.grantedByOrganization);
    const holdsItself = user.roles.some(
      (r) => !r.grantedByOrganization && r.roleId === roleId && r.locationId === null,
    );
    const grantsRight = holdsItself
      ? granted.length === 0
      : granted.length === 1 && granted[0]?.roleId === roleId && granted[0].locationId === null;
    if (user.organizationMemberId === member.id && user.isActive && grantsRight) return false;
    if (!grantsRight) {
      await tx.userRole.deleteMany({ where: { userId: user.id, grantedByOrganization: true } });
      if (!holdsItself) {
        await tx.userRole.create({
          data: { userId: user.id, roleId, locationId: null, grantedByOrganization: true },
        });
      }
    }
    await tx.user.update({
      where: { id: user.id },
      data: { organizationMemberId: member.id, isActive: true },
    });
    await this.record(tx, actor, tenantId, {
      action: 'user.organization_linked',
      entityType: 'User',
      entityId: user.id,
      metadata: { ...metadata, created: false, roleAdded: !holdsItself },
    });
    return false;
  }

  /**
   * Ends a linked user's link: the organization's assignments go; a user with roles of its own
   * keeps them and is no longer linked (`organizationMemberId` cleared); a user left without a role
   * is deactivated with its sessions revoked, keeping `organizationMemberId` as the mark that the
   * organization, not the brand, deactivated it.
   */
  private async unlink(
    tx: PrismaTx,
    user: UserRow,
    organizationId: string,
    memberId: string | null,
    actor: OrganizationActor,
  ): Promise<void> {
    const deactivate = user.roles.every((r) => r.grantedByOrganization);
    await tx.userRole.deleteMany({ where: { userId: user.id, grantedByOrganization: true } });
    await tx.user.update({
      where: { id: user.id },
      data: deactivate ? { isActive: false } : { organizationMemberId: null },
    });
    if (deactivate) {
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.record(tx, actor, user.tenantId, {
      action: 'user.organization_unlinked',
      entityType: 'User',
      entityId: user.id,
      metadata: { organizationId, memberId, deactivated: deactivate },
    });
  }

  /** An audit entry in the brand a change touches, by whoever made it. */
  private async record(
    tx: PrismaTx,
    actor: OrganizationActor,
    tenantId: string,
    entry: { action: string; entityType: string; entityId: string; metadata: object },
  ): Promise<void> {
    const [actorType, actorId]: [ActorType, string | null] =
      actor.kind === 'user'
        ? ['USER', actor.userId]
        : actor.kind === 'platform'
          ? ['PLATFORM', actor.platformUserId]
          : ['SYSTEM', null];
    await this.audit.record(
      {
        ...entry,
        metadata: { ...entry.metadata },
        actorType,
        actorId,
        tenantId,
        locationId: null,
      },
      tx,
    );
  }
}
