import { Injectable } from '@nestjs/common';
import { OWNER_ROLE, type Prisma } from '@pos/database';
import { DomainError } from '@pos/domain';
import { PrismaService, TenantContext, isUniqueViolation } from '@pos/server';
import type { OrganizationRole } from '@pos/shared-types';
import {
  type LinkedMemberDto,
  type MemberDto,
  type Paginated,
  type PlatformOrganizationAttached,
  type PlatformOrganizationDetail,
  type PlatformOrganizationSummary,
  type addMemberSchema,
  type createOrganizationSchema,
  type platformOrganizationsQuerySchema,
  type updateOrganizationSchema,
} from '@pos/validation';
import type { z } from 'zod';
import {
  type OrganizationActor,
  OrganizationService,
} from '../../organizations/organization.service';
import { recordConfigChange } from '../../sync/config-change';
import { PlatformAuditService } from '../platform-audit.service';

type CreateInput = z.output<typeof createOrganizationSchema>;
type UpdateInput = z.output<typeof updateOrganizationSchema>;
type AddMemberInput = z.output<typeof addMemberSchema>;

/** The platform operator making a change: each brand's audit log names them. */
export type PlatformOrganizationActor = Extract<OrganizationActor, { kind: 'platform' }>;

const slugTaken = () =>
  new DomainError('ORGANIZATION_SLUG_TAKEN', 'This organization address is already in use');

const notFound = () => new DomainError('ORGANIZATION_NOT_FOUND', 'Organization not found');

const summarySelect = {
  id: true,
  slug: true,
  nameEn: true,
  nameAr: true,
  currencyCode: true,
  status: true,
  createdAt: true,
  _count: { select: { tenants: true, members: true } },
} satisfies Prisma.OrganizationSelect;

type SummaryRow = Prisma.OrganizationGetPayload<{ select: typeof summarySelect }>;

const toSummary = (row: SummaryRow): PlatformOrganizationSummary => ({
  id: row.id,
  slug: row.slug,
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  currencyCode: row.currencyCode,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  brandCount: row._count.tenants,
  memberCount: row._count.members,
});

/**
 * What the platform admin does with organizations (E1, spec §6): creates them with their first
 * owner, changes their names and status, brings brands in and out and manages their members. The
 * members' linked users in the brands are `OrganizationService`'s (acting as the platform
 * operator, so each brand's audit log names who did it); this service adds the platform's own
 * audit entries (`organization.*`) and the rule that a brand never leaves without an owner of its
 * own. Organizations belong to no tenant, so its queries run unscoped (this file is on the
 * `pos-local/no-unscoped-prisma` allowlist).
 */
@Injectable()
export class PlatformOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly audit: PlatformAuditService,
  ) {}

  list(
    q: z.output<typeof platformOrganizationsQuerySchema>,
  ): Promise<Paginated<PlatformOrganizationSummary>> {
    return TenantContext.runUnscoped('platform: list organizations', async () => {
      const search = q.search?.trim();
      const where: Prisma.OrganizationWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(search
          ? {
              OR: [
                { slug: { contains: search.toLowerCase() } },
                { nameEn: { contains: search, mode: 'insensitive' } },
                { nameAr: { contains: search } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        this.prisma.organization.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: summarySelect,
        }),
        this.prisma.organization.count({ where }),
      ]);
      return { items: rows.map(toSummary), page: q.page, pageSize: q.pageSize, total };
    });
  }

  detail(organizationId: string): Promise<PlatformOrganizationDetail> {
    return TenantContext.runUnscoped('platform: read an organization', async () => {
      const row = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          ...summarySelect,
          tenants: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, slug: true, nameEn: true, nameAr: true, status: true },
          },
        },
      });
      if (!row) throw notFound();
      return {
        ...toSummary(row),
        brands: row.tenants,
        members: await this.organizations.listMembers(organizationId),
      };
    });
  }

  /**
   * Creates the organization and its first owner through `OrganizationService.addMember`, so the
   * same rules apply: an existing account becomes the OWNER, a new e-mail needs a password (400).
   * If the owner cannot be added the organization is removed again.
   */
  async create(
    input: CreateInput,
    actor: PlatformOrganizationActor,
  ): Promise<PlatformOrganizationDetail> {
    const created = await TenantContext.runUnscoped(
      'platform: create an organization',
      async () => {
        const account = await this.prisma.account.findUnique({
          where: { email: input.owner.email },
          select: { id: true },
        });
        if (!account && !input.owner.password) {
          throw new DomainError('VALIDATION_FAILED', 'A new account needs a starting password', {
            fields: { 'owner.password': 'required' },
          });
        }
        if ((await this.prisma.organization.count({ where: { slug: input.slug } })) > 0) {
          throw slugTaken();
        }
        try {
          return await this.prisma.organization.create({
            data: {
              slug: input.slug,
              nameEn: input.nameEn,
              nameAr: input.nameAr,
              currencyCode: input.currencyCode,
            },
            select: { id: true },
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw slugTaken();
          throw error;
        }
      },
    );
    let owner: LinkedMemberDto;
    try {
      owner = await this.organizations.addMember(
        created.id,
        {
          email: input.owner.email,
          displayName: input.owner.displayName,
          role: 'OWNER',
          ...(input.owner.password ? { password: input.owner.password } : {}),
        },
        actor,
      );
    } catch (error) {
      await TenantContext.runUnscoped('platform: undo an organization without owner', () =>
        this.prisma.organization.delete({ where: { id: created.id } }),
      );
      throw error;
    }
    await this.audit.record({
      action: 'organization.create',
      entityType: 'Organization',
      entityId: created.id,
      metadata: {
        slug: input.slug,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        currencyCode: input.currencyCode,
        ownerMemberId: owner.id,
      },
    });
    await this.recordMember('organization.member_add', created.id, owner.id, {
      role: 'OWNER',
      skippedTenantIds: owner.skippedTenantIds,
    });
    return this.detail(created.id);
  }

  /**
   * Changes names and status. A status change is a configuration change of every brand (R16): the
   * brands' snapshots leave out the organization's roles while it is not active, so their hubs
   * refuse its members as the cloud does (R6).
   */
  async update(organizationId: string, input: UpdateInput): Promise<PlatformOrganizationDetail> {
    await TenantContext.runUnscoped('platform: change an organization', async () => {
      const changes = {
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
        ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      };
      const before = await this.prisma.$transaction(async (tx) => {
        const row = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { nameEn: true, nameAr: true, status: true },
        });
        if (!row) throw notFound();
        // The update locks the row, so the brands read next are final: attaching or detaching
        // one locks it too.
        await tx.organization.update({ where: { id: organizationId }, data: changes });
        if (changes.status !== undefined && changes.status !== row.status) {
          const tenants = await tx.tenant.findMany({
            where: { organizationId },
            select: { id: true },
            orderBy: { id: 'asc' },
          });
          for (const tenant of tenants) await recordConfigChange(tx, tenant.id);
        }
        return row;
      });
      const keys = Object.keys(changes) as (keyof typeof changes)[];
      await this.audit.record({
        action: 'organization.update',
        entityType: 'Organization',
        entityId: organizationId,
        metadata: {
          before: Object.fromEntries(keys.map((k) => [k, before[k]])),
          after: changes,
        },
      });
    });
    return this.detail(organizationId);
  }

  /** Brings a brand in (or repairs its members' users when it is already in). */
  async attach(
    organizationId: string,
    tenantId: string,
    actor: PlatformOrganizationActor,
  ): Promise<PlatformOrganizationAttached> {
    const { skippedMemberIds } = await this.organizations.attachTenant(
      organizationId,
      tenantId,
      actor,
    );
    await this.audit.record({
      action: 'organization.attach',
      entityType: 'Organization',
      entityId: organizationId,
      tenantId,
      metadata: { tenantId, skippedMemberIds },
    });
    return { ...(await this.detail(organizationId)), skippedMemberIds };
  }

  /**
   * Takes a brand out. Refused (409 `LAST_OWNER`) when the brand has no active Owner of its own:
   * the owners it would keep must hold the role through the brand's own assignment, not the
   * organization's — otherwise nobody could sign in as its owner afterwards.
   */
  async detach(
    organizationId: string,
    tenantId: string,
    actor: PlatformOrganizationActor,
  ): Promise<void> {
    await TenantContext.runUnscoped("platform: check a brand's own owners", async () => {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { tenants: { where: { id: tenantId }, select: { id: true } } },
      });
      if (!organization) throw notFound();
      if (organization.tenants.length === 0) {
        throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
      }
      const own = await this.prisma.userRole.count({
        where: {
          locationId: null,
          grantedByOrganization: false,
          role: { tenantId, isSystem: true, name: OWNER_ROLE.name },
          user: { tenantId, isActive: true },
        },
      });
      if (own === 0) {
        throw new DomainError(
          'CONFLICT',
          'The brand needs an active owner of its own before it leaves the organization',
          { reason: 'LAST_OWNER' },
        );
      }
    });
    await this.organizations.detachTenant(organizationId, tenantId, actor);
    await this.audit.record({
      action: 'organization.detach',
      entityType: 'Organization',
      entityId: organizationId,
      tenantId,
      metadata: { tenantId },
    });
  }

  async members(organizationId: string): Promise<MemberDto[]> {
    await this.assertExists(organizationId);
    return this.organizations.listMembers(organizationId);
  }

  async addMember(
    organizationId: string,
    input: AddMemberInput,
    actor: PlatformOrganizationActor,
  ): Promise<LinkedMemberDto> {
    const member = await this.organizations.addMember(organizationId, input, actor);
    await this.recordMember('organization.member_add', organizationId, member.id, {
      role: member.role,
      skippedTenantIds: member.skippedTenantIds,
    });
    return member;
  }

  async changeRole(
    organizationId: string,
    memberId: string,
    role: OrganizationRole,
    actor: PlatformOrganizationActor,
  ): Promise<LinkedMemberDto> {
    const before = (await this.organizations.listMembers(organizationId)).find(
      (m) => m.id === memberId,
    );
    const member = await this.organizations.changeRole(organizationId, memberId, role, actor);
    await this.recordMember('organization.member_role', organizationId, member.id, {
      from: before?.role ?? null,
      to: member.role,
      skippedTenantIds: member.skippedTenantIds,
    });
    return member;
  }

  async removeMember(
    organizationId: string,
    memberId: string,
    actor: PlatformOrganizationActor,
  ): Promise<void> {
    const before = (await this.organizations.listMembers(organizationId)).find(
      (m) => m.id === memberId,
    );
    await this.organizations.removeMember(organizationId, memberId, actor);
    await this.recordMember('organization.member_remove', organizationId, memberId, {
      role: before?.role ?? null,
    });
  }

  private async assertExists(organizationId: string): Promise<void> {
    const found = await TenantContext.runUnscoped('platform: find an organization', () =>
      this.prisma.organization.count({ where: { id: organizationId } }),
    );
    if (found === 0) throw notFound();
  }

  private recordMember(
    action: string,
    organizationId: string,
    memberId: string,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    return this.audit.record({
      action,
      entityType: 'OrganizationMember',
      entityId: memberId,
      metadata: { organizationId, ...metadata },
    });
  }
}
