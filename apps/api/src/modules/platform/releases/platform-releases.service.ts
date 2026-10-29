import { Injectable } from '@nestjs/common';
import type { Release } from '@pos/database';
import {
  DEFAULT_ROLLOUT,
  DomainError,
  compareVersions,
  isBelow,
  supportedMinimums,
  targetVersion,
} from '@pos/domain';
import { AuditService, PrismaService, RequestContext, isUniqueViolation } from '@pos/server';
import { MADAR_VERSION } from '@pos/shared-types';
import type {
  DeviceVersions,
  ReleaseDto,
  ReleasesOverview,
  TenantRollout,
  deviceVersionsQuerySchema,
  publishReleaseSchema,
  setTenantRolloutSchema,
  updateReleaseSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { ReleasePolicyService } from '../../releases/release-policy.service';
import { PlatformAuditService } from '../platform-audit.service';
import { PlatformDirectoryService } from '../platform-directory.service';
import { PlatformTenantsService } from '../tenants/platform-tenants.service';

const releaseFields = (r: Release) => ({
  version: r.version,
  channel: r.channel,
  notes: r.notes,
  minSupportedHubVersion: r.minSupportedHubVersion,
  minSupportedClientVersion: r.minSupportedClientVersion,
});

/**
 * A minimum above the release's own version would refuse the hubs and apps it ships with.
 * (`VALIDATION_FAILED`, with the field, like the request schemas' own refusals.)
 */
function assertMinimumsFit(release: {
  version: string;
  minSupportedHubVersion: string | null;
  minSupportedClientVersion: string | null;
}): void {
  for (const field of ['minSupportedHubVersion', 'minSupportedClientVersion'] as const) {
    const minimum = release[field];
    if (minimum !== null && isBelow(release.version, minimum)) {
      throw new DomainError('VALIDATION_FAILED', 'A minimum cannot be above its release', {
        issues: [{ path: [field], message: 'Above the release version' }],
      });
    }
  }
}

/**
 * Releases and rollout for the platform (ADR 0026): publishing a release's notes and minimum
 * versions, putting a tenant on a channel or pinning it to a version, and the versions every
 * tenant's devices report. Every change is in the platform's audit log; a tenant's rollout also in
 * the tenant's own.
 */
@Injectable()
export class PlatformReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ReleasePolicyService,
    private readonly directory: PlatformDirectoryService,
    private readonly tenants: PlatformTenantsService,
    private readonly platformAudit: PlatformAuditService,
    private readonly audit: AuditService,
  ) {}

  async overview(): Promise<ReleasesOverview> {
    const rows = await this.prisma.release.findMany({ orderBy: { publishedAt: 'desc' } });
    // Newest version first, so each channel's latest is its first.
    const releases = (await this.toDtos(rows)).sort((a, b) =>
      compareVersions(b.version, a.version),
    );
    const published = releases.filter((r) => new Date(r.publishedAt) <= new Date());
    return {
      cloudVersion: MADAR_VERSION,
      minimums: supportedMinimums(published, MADAR_VERSION),
      latest: {
        STABLE: published.find((r) => r.channel === 'STABLE')?.version ?? null,
        BETA: published.find((r) => r.channel === 'BETA')?.version ?? null,
      },
      releases,
    };
  }

  async publish(input: z.output<typeof publishReleaseSchema>): Promise<ReleaseDto> {
    const data = {
      version: input.version,
      channel: input.channel,
      notes: input.notes,
      minSupportedHubVersion: input.minSupportedHubVersion ?? null,
      minSupportedClientVersion: input.minSupportedClientVersion ?? null,
    };
    assertMinimumsFit(data);
    const release = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.release.create({
          data: { ...data, publishedById: this.operatorId() },
        });
        await this.platformAudit.record(
          {
            action: 'release.published',
            entityType: 'Release',
            entityId: created.id,
            metadata: releaseFields(created),
          },
          tx,
        );
        return created;
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new DomainError('CONFLICT', 'This version is already published', {
            reason: 'VERSION_TAKEN',
          });
        }
        throw error;
      });
    this.policy.invalidate();
    return this.toDto(release);
  }

  async update(id: string, input: z.output<typeof updateReleaseSchema>): Promise<ReleaseDto> {
    const before = await this.prisma.release.findUnique({ where: { id } });
    if (!before) throw new DomainError('RELEASE_NOT_FOUND', 'Release not found');
    const next = {
      ...releaseFields(before),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.minSupportedHubVersion !== undefined
        ? { minSupportedHubVersion: input.minSupportedHubVersion }
        : {}),
      ...(input.minSupportedClientVersion !== undefined
        ? { minSupportedClientVersion: input.minSupportedClientVersion }
        : {}),
    };
    assertMinimumsFit(next);
    const release = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.release.update({
        where: { id },
        data: {
          channel: next.channel,
          notes: next.notes,
          minSupportedHubVersion: next.minSupportedHubVersion,
          minSupportedClientVersion: next.minSupportedClientVersion,
        },
      });
      await this.platformAudit.record(
        {
          action: 'release.updated',
          entityType: 'Release',
          entityId: id,
          metadata: { before: releaseFields(before), after: releaseFields(updated) },
        },
        tx,
      );
      return updated;
    });
    this.policy.invalidate();
    return this.toDto(release);
  }

  /** Inside the tenant's scope (the platform guard scopes `:tenantId` routes). */
  async rollout(tenantId: string): Promise<TenantRollout> {
    const [row, releases] = await Promise.all([
      this.prisma.tenantReleaseChannel.findUnique({ where: { tenantId } }),
      this.policy.releases(),
    ]);
    const setting = row ?? DEFAULT_ROLLOUT;
    return {
      tenantId,
      channel: setting.channel,
      pinnedVersion: setting.pinnedVersion,
      targetVersion: targetVersion(setting, releases),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** A pinned version must be a published release; an archived tenant is not changed. */
  async setRollout(
    tenantId: string,
    input: z.output<typeof setTenantRolloutSchema>,
  ): Promise<TenantRollout> {
    await this.tenants.assertWritable(tenantId);
    if (input.pinnedVersion !== null) {
      const pinned = await this.prisma.release.count({ where: { version: input.pinnedVersion } });
      if (pinned === 0) {
        throw new DomainError('RELEASE_NOT_FOUND', 'No release of this version was published', {
          version: input.pinnedVersion,
        });
      }
    }
    const before = await this.rollout(tenantId);
    const after = { channel: input.channel, pinnedVersion: input.pinnedVersion };
    if (before.channel === after.channel && before.pinnedVersion === after.pinnedVersion) {
      return before;
    }
    const updatedById = this.operatorId();
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantReleaseChannel.upsert({
        where: { tenantId },
        create: { tenantId, ...after, updatedById },
        update: { ...after, updatedById },
      });
      const metadata = {
        reason: input.reason,
        before: { channel: before.channel, pinnedVersion: before.pinnedVersion },
        after,
      };
      await this.audit.record(
        { action: 'release_channel.changed', entityType: 'Tenant', entityId: tenantId, metadata },
        tx,
      );
      await this.platformAudit.record(
        {
          action: 'tenant.release_channel_changed',
          entityType: 'Tenant',
          entityId: tenantId,
          tenantId,
          metadata,
        },
        tx,
      );
    });
    return this.rollout(tenantId);
  }

  async deviceVersions(query: z.output<typeof deviceVersionsQuerySchema>): Promise<DeviceVersions> {
    const now = new Date();
    const [releases, minimums] = await Promise.all([
      this.policy.releases(),
      this.policy.minimums(),
    ]);
    const tenants = await this.directory.deviceVersions(
      this.tenants.staleAfterMs,
      { releases, minimums },
      query.tenantId ? { tenantId: query.tenantId } : {},
      now,
    );
    return {
      generatedAt: now.toISOString(),
      cloudVersion: MADAR_VERSION,
      minimums,
      tenants: query.outdatedOnly
        ? tenants
            .map((t) => ({
              ...t,
              devices: t.devices.filter(
                (d) => d.versionStatus === 'OUTDATED' || d.versionStatus === 'UNSUPPORTED',
              ),
            }))
            .filter((t) => t.devices.length > 0)
        : tenants,
    };
  }

  private operatorId(): string | null {
    return RequestContext.get()?.platformUserId ?? null;
  }

  private async toDto(row: Release): Promise<ReleaseDto> {
    const [dto] = await this.toDtos([row]);
    if (!dto) throw new Error('Release not mapped');
    return dto;
  }

  private async toDtos(rows: Release[]): Promise<ReleaseDto[]> {
    const ids = [...new Set(rows.flatMap((r) => (r.publishedById ? [r.publishedById] : [])))];
    const operators = await this.prisma.platformUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
    const names = new Map(operators.map((o) => [o.id, o.displayName]));
    return rows.map((r) => ({
      id: r.id,
      ...releaseFields(r),
      publishedAt: r.publishedAt.toISOString(),
      publishedById: r.publishedById,
      publishedByName: r.publishedById ? (names.get(r.publishedById) ?? null) : null,
    }));
  }
}
