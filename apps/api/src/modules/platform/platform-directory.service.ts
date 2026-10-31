import { Injectable } from '@nestjs/common';
import {
  type EntitlementSpec,
  OwnerEmailTakenError,
  type Prisma,
  type ProvisionedTenant,
  provisionTenant,
} from '@pos/database';
import {
  DEFAULT_ROLLOUT,
  DomainError,
  type ReleaseFacts,
  type RolloutSetting,
  type SupportedMinimums,
  assertOrganizationCurrency,
  deviceVersionStatus,
  targetVersion,
} from '@pos/domain';
import { PrismaService, TenantContext, isUniqueViolation } from '@pos/server';
import { DomainStatus } from '@pos/shared-types';
import {
  type DeviceVersion,
  type HealthBoardRow,
  type Paginated,
  type PlatformTenantSummary,
  type platformTenantsQuerySchema,
  type provisionTenantSchema,
  reportedOutboxSchema,
  type TenantDeviceVersions,
} from '@pos/validation';
import type { z } from 'zod';

type ProvisionInput = z.output<typeof provisionTenantSchema>;

/** Refused changes nobody settled yet (ADR 0014). */
const OPEN_ISSUES: Prisma.ProcessedOperationWhereInput = {
  status: { in: ['CONFLICT', 'REJECTED'] },
  resolution: null,
};

const max = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : a > b ? a : b);

/** What the version columns need to know of the releases (ADR 0026). */
export interface VersionLimits {
  releases: readonly ReleaseFacts[];
  minimums: SupportedMinimums;
}

/** A tenant's rollout setting, with the version its devices should run. */
export interface TenantRolloutRow extends RolloutSetting {
  targetVersion: string | null;
}

/**
 * The platform's view across tenants (ADR 0025): listing and searching tenants, provisioning a
 * new one and the health board. Cross-tenant by nature, so its queries run unscoped; this file is
 * on the `pos-local/no-unscoped-prisma` allowlist. Everything about one tenant is read elsewhere,
 * inside that tenant's scope.
 */
@Injectable()
export class PlatformDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  listTenants(
    q: z.output<typeof platformTenantsQuerySchema>,
  ): Promise<Paginated<PlatformTenantSummary>> {
    return TenantContext.runUnscoped('platform: list tenants', async () => {
      const search = q.search?.trim();
      const where: Prisma.TenantWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.businessType ? { businessType: q.businessType } : {}),
        ...(q.organizationId ? { organizationId: q.organizationId } : {}),
        ...(search
          ? {
              OR: [
                { slug: { contains: search.toLowerCase() } },
                { nameEn: { contains: search, mode: 'insensitive' } },
                { nameAr: { contains: search } },
                { legalName: { contains: search, mode: 'insensitive' } },
                { domains: { some: { domain: { contains: search.toLowerCase() } } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        this.prisma.tenant.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: {
            organization: { select: { id: true, nameEn: true, nameAr: true } },
            _count: { select: { locations: true, users: true } },
            domains: {
              where: { isPrimary: true, status: DomainStatus.VERIFIED },
              select: { domain: true },
            },
          },
        }),
        this.prisma.tenant.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
          businessType: row.businessType as PlatformTenantSummary['businessType'],
          status: row.status,
          currencyCode: row.currencyCode,
          createdAt: row.createdAt.toISOString(),
          locationCount: row._count.locations,
          userCount: row._count.users,
          primaryDomain: row.domains[0]?.domain ?? null,
          organization: row.organization,
        })),
        page: q.page,
        pageSize: q.pageSize,
        total,
      };
    });
  }

  /**
   * Creates the tenant, its first location, its Owner, its entitlements and its MADAR subdomain
   * in one transaction, through `provisionTenant` (ADR 0017). A slug or owner e-mail in use is
   * refused rather than merged into the existing tenant. A brand created into an organization
   * (`input.organizationId`, whose currency must be the brand's) has no owner of its own: the
   * caller links the organization's members afterwards.
   */
  provision(
    input: ProvisionInput,
    options: {
      /** Not needed (and unused) for a brand in an organization. */
      ownerPasswordHash?: string;
      entitlements: Record<string, EntitlementSpec>;
      webDomain: string;
    },
  ): Promise<ProvisionedTenant> {
    return TenantContext.runUnscoped('platform: provision a tenant', async () => {
      if (input.organizationId) {
        const organization = await this.prisma.organization.findUnique({
          where: { id: input.organizationId },
          select: { currencyCode: true },
        });
        if (!organization) {
          throw new DomainError('ORGANIZATION_NOT_FOUND', 'Organization not found');
        }
        assertOrganizationCurrency(organization.currencyCode, input.tenant.currencyCode);
      }
      const taken = await this.prisma.tenant.count({ where: { slug: input.tenant.slug } });
      if (taken > 0) {
        throw new DomainError('CONFLICT', 'This address is already in use', {
          reason: 'SLUG_TAKEN',
        });
      }
      try {
        return await this.prisma.$transaction(
          (tx) =>
            provisionTenant(tx, {
              tenant: {
                ...input.tenant,
                supportedLocales: input.tenant.supportedLocales,
              },
              locations: [
                {
                  code: input.location.code,
                  nameEn: input.location.nameEn,
                  nameAr: input.location.nameAr,
                  timezone: input.location.timezone ?? input.tenant.timezone,
                  taxInclusive: input.location.taxInclusive,
                },
              ],
              webDomain: options.webDomain,
              entitlements: options.entitlements,
              ...(input.owner && options.ownerPasswordHash
                ? {
                    owner: {
                      email: input.owner.email,
                      displayName: input.owner.displayName,
                      passwordHash: options.ownerPasswordHash,
                      preferredLocale: input.owner.preferredLocale ?? input.tenant.defaultLocale,
                    },
                  }
                : {}),
              ...(input.organizationId ? { organizationId: input.organizationId } : {}),
            }),
          { timeout: 30_000, maxWait: 10_000 },
        );
      } catch (error) {
        if (error instanceof OwnerEmailTakenError) {
          throw new DomainError('CONFLICT', 'This email is already in use', {
            reason: 'EMAIL_TAKEN',
          });
        }
        if (isUniqueViolation(error)) {
          throw new DomainError('CONFLICT', 'This address or email is already in use', {
            reason: 'SLUG_TAKEN',
          });
        }
        throw error;
      }
    });
  }

  /**
   * One row per tenant: hubs and terminals heard from within the heartbeat window, what the hubs
   * last reported waiting and failed in their outboxes, refused changes nobody settled, the last
   * change received, the newest order and the server errors of the last day.
   */
  healthBoard(
    staleAfterMs: number,
    limits: VersionLimits,
    now = new Date(),
  ): Promise<HealthBoardRow[]> {
    return TenantContext.runUnscoped('platform: the health board', async () => {
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
      const [tenants, locations, devices, issues, received, orders, errors, rollouts] =
        await Promise.all([
          this.prisma.tenant.findMany({
            orderBy: { nameEn: 'asc' },
            select: { id: true, slug: true, nameEn: true, nameAr: true, status: true },
          }),
          this.prisma.location.groupBy({ by: ['tenantId'], _count: { _all: true } }),
          this.prisma.device.findMany({
            where: { status: 'ACTIVE' },
            select: {
              tenantId: true,
              type: true,
              lastSeenAt: true,
              metadata: true,
              appVersion: true,
            },
          }),
          this.prisma.processedOperation.groupBy({
            by: ['tenantId'],
            where: OPEN_ISSUES,
            _count: { _all: true },
          }),
          this.prisma.processedOperation.groupBy({ by: ['tenantId'], _max: { updatedAt: true } }),
          this.prisma.order.groupBy({ by: ['tenantId'], _max: { createdAt: true } }),
          this.prisma.platformErrorEvent.groupBy({
            by: ['subjectTenantId'],
            where: { createdAt: { gte: dayAgo } },
            _count: { _all: true },
          }),
          this.rolloutsUnscoped(limits.releases),
        ]);
      const byTenant = <T extends { tenantId: string }>(rows: T[]) =>
        new Map(rows.map((r) => [r.tenantId, r]));
      const locationCounts = byTenant(locations);
      const issueCounts = byTenant(issues);
      const lastReceived = byTenant(received);
      const lastOrders = byTenant(orders);
      const errorCounts = new Map(errors.map((e) => [e.subjectTenantId, e._count._all]));
      const online = (seen: Date | null) =>
        seen !== null && now.getTime() - seen.getTime() <= staleAfterMs;

      return tenants.map((tenant) => {
        const own = devices.filter((d) => d.tenantId === tenant.id);
        const hubs = own.filter((d) => d.type === 'GATEWAY');
        const terminals = own.filter((d) => d.type !== 'GATEWAY');
        let pending = 0;
        let failed = 0;
        let hubSeen: Date | null = null;
        for (const hub of hubs) {
          const metadata = (hub.metadata ?? {}) as { outbox?: unknown };
          const outbox = reportedOutboxSchema.safeParse(metadata.outbox);
          if (outbox.success) {
            pending += outbox.data.pending;
            failed += outbox.data.failed;
          }
          hubSeen = max(hubSeen, hub.lastSeenAt);
        }
        const lastSync = max(lastReceived.get(tenant.id)?._max.updatedAt ?? null, hubSeen);
        const target = (rollouts.get(tenant.id) ?? this.rolloutOf(null, limits.releases))
          .targetVersion;
        const statuses = own.map((d) =>
          deviceVersionStatus(d.appVersion, { target, minimum: this.minimumFor(d.type, limits) }),
        );
        return {
          tenantId: tenant.id,
          slug: tenant.slug,
          nameEn: tenant.nameEn,
          nameAr: tenant.nameAr,
          status: tenant.status,
          locations: locationCounts.get(tenant.id)?._count._all ?? 0,
          hubsOnline: hubs.filter((h) => online(h.lastSeenAt)).length,
          hubsTotal: hubs.length,
          terminalsOnline: terminals.filter((t) => online(t.lastSeenAt)).length,
          terminalsTotal: terminals.length,
          pendingOperations: pending,
          failedOperations: failed,
          openIssues: issueCounts.get(tenant.id)?._count._all ?? 0,
          lastSyncAt: lastSync?.toISOString() ?? null,
          lastActivityAt: lastOrders.get(tenant.id)?._max.createdAt?.toISOString() ?? null,
          errors24h: errorCounts.get(tenant.id) ?? 0,
          targetVersion: target,
          outdatedDevices: statuses.filter((v) => v === 'OUTDATED').length,
          unsupportedDevices: statuses.filter((v) => v === 'UNSUPPORTED').length,
        };
      });
    });
  }

  /**
   * The versions every active device reports (ADR 0026), per tenant with its rollout: each device
   * against its tenant's target version and the cloud's minimum for its kind (hubs and apps).
   */
  deviceVersions(
    staleAfterMs: number,
    limits: VersionLimits,
    filter: { tenantId?: string } = {},
    now = new Date(),
  ): Promise<TenantDeviceVersions[]> {
    return TenantContext.runUnscoped('platform: device versions', async () => {
      const [tenants, devices, rollouts] = await Promise.all([
        this.prisma.tenant.findMany({
          where: filter.tenantId ? { id: filter.tenantId } : {},
          orderBy: { nameEn: 'asc' },
          select: { id: true, slug: true, nameEn: true, nameAr: true },
        }),
        this.prisma.device.findMany({
          where: { status: 'ACTIVE', ...(filter.tenantId ? { tenantId: filter.tenantId } : {}) },
          orderBy: [{ locationId: 'asc' }, { type: 'asc' }, { name: 'asc' }],
          include: { location: { select: { code: true } } },
        }),
        this.rolloutsUnscoped(limits.releases),
      ]);
      return tenants.map((tenant) => {
        const rollout = rollouts.get(tenant.id) ?? this.rolloutOf(null, limits.releases);
        const own: DeviceVersion[] = devices
          .filter((d) => d.tenantId === tenant.id)
          .map((d) => ({
            id: d.id,
            tenantId: d.tenantId,
            locationId: d.locationId,
            locationCode: d.location.code,
            name: d.name,
            type: d.type,
            status: d.status,
            appVersion: d.appVersion,
            lastVersionAt: d.lastVersionAt?.toISOString() ?? null,
            lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
            online: d.lastSeenAt !== null && now.getTime() - d.lastSeenAt.getTime() <= staleAfterMs,
            versionStatus: deviceVersionStatus(d.appVersion, {
              target: rollout.targetVersion,
              minimum: this.minimumFor(d.type, limits),
            }),
          }));
        return {
          tenantId: tenant.id,
          slug: tenant.slug,
          nameEn: tenant.nameEn,
          nameAr: tenant.nameAr,
          channel: rollout.channel,
          pinnedVersion: rollout.pinnedVersion,
          targetVersion: rollout.targetVersion,
          outdated: own.filter((d) => d.versionStatus === 'OUTDATED').length,
          unsupported: own.filter((d) => d.versionStatus === 'UNSUPPORTED').length,
          devices: own,
        };
      });
    });
  }

  /** A hub is held to the hub minimum, every other device (an app) to the client minimum. */
  private minimumFor(type: string, limits: VersionLimits): string | null {
    return type === 'GATEWAY' ? limits.minimums.hub : limits.minimums.client;
  }

  private rolloutOf(
    row: RolloutSetting | null,
    releases: readonly ReleaseFacts[],
  ): TenantRolloutRow {
    const setting = row ?? DEFAULT_ROLLOUT;
    return {
      channel: setting.channel,
      pinnedVersion: setting.pinnedVersion,
      targetVersion: targetVersion(setting, releases),
    };
  }

  /** Every tenant's rollout setting; a tenant without one follows STABLE. Call inside runUnscoped. */
  private async rolloutsUnscoped(
    releases: readonly ReleaseFacts[],
  ): Promise<Map<string, TenantRolloutRow>> {
    const rows = await this.prisma.tenantReleaseChannel.findMany({
      select: { tenantId: true, channel: true, pinnedVersion: true },
    });
    return new Map(rows.map((row) => [row.tenantId, this.rolloutOf(row, releases)]));
  }
}
