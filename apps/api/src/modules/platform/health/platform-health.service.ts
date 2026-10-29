import { Injectable } from '@nestjs/common';
import { PrismaService } from '@pos/server';
import { MADAR_VERSION } from '@pos/shared-types';
import type { HealthBoard, LocationHealth, TenantHealth } from '@pos/validation';
import { ReleasePolicyService } from '../../releases/release-policy.service';
import { SyncAdminService } from '../../sync/sync-admin.service';
import { PlatformDirectoryService } from '../platform-directory.service';
import { PlatformTenantsService } from '../tenants/platform-tenants.service';
import { PlatformErrorEventsService } from './platform-error-events.service';

const later = (a: string | null, b: string | null): string | null =>
  !a ? b : !b ? a : a > b ? a : b;

/**
 * Health for the platform (ADR 0025): per tenant and location, the hubs and terminals heard from
 * within the heartbeat window and the versions they run, what the hubs report waiting and failed
 * in their outboxes, refused changes nobody settled (ADR 0014), the last sync, the newest order,
 * recent server errors, and how many devices run a version older than their tenant's rollout or
 * the cloud's minimum (ADR 0026).
 */
@Injectable()
export class PlatformHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncAdminService,
    private readonly tenants: PlatformTenantsService,
    private readonly directory: PlatformDirectoryService,
    private readonly errors: PlatformErrorEventsService,
    private readonly releases: ReleasePolicyService,
  ) {}

  async board(): Promise<HealthBoard> {
    const now = new Date();
    const [releases, minimums] = await Promise.all([
      this.releases.releases(),
      this.releases.minimums(),
    ]);
    const [tenants, recentErrors] = await Promise.all([
      this.directory.healthBoard(this.tenants.staleAfterMs, { releases, minimums }, now),
      this.errors.recent({ limit: 20 }),
    ]);
    return {
      generatedAt: now.toISOString(),
      cloudVersion: MADAR_VERSION,
      minimums,
      tenants,
      recentErrors,
    };
  }

  async tenant(tenantId: string): Promise<TenantHealth> {
    const now = new Date();
    const [tenant, locations, devices, lastOrders, recentErrors] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true } }),
      this.prisma.location.findMany({ where: { tenantId }, orderBy: { code: 'asc' } }),
      this.tenants.devices(tenantId),
      this.prisma.order.groupBy({
        by: ['locationId'],
        where: { tenantId },
        _max: { createdAt: true },
      }),
      this.errors.recent({ tenantId, limit: 20 }),
    ]);
    const lastOrderAt = new Map(lastOrders.map((o) => [o.locationId, o._max.createdAt]));
    const result: LocationHealth[] = [];
    for (const location of locations) {
      const status = await this.sync.status(location.id);
      const terminals = devices.filter(
        (d) => d.locationId === location.id && d.type !== 'GATEWAY' && d.status === 'ACTIVE',
      );
      const hubSeen = status.hubs.reduce<string | null>((at, h) => later(at, h.lastSeenAt), null);
      result.push({
        locationId: location.id,
        code: location.code,
        nameEn: location.nameEn,
        nameAr: location.nameAr,
        hubs: status.hubs,
        terminals: { online: terminals.filter((t) => t.online).length, total: terminals.length },
        pendingOperations: status.hubs.reduce((sum, h) => sum + (h.outbox?.pending ?? 0), 0),
        failedOperations: status.hubs.reduce((sum, h) => sum + (h.outbox?.failed ?? 0), 0),
        openIssues: status.openIssues,
        lastSyncAt: later(status.lastReceivedAt, hubSeen),
        lastActivityAt: lastOrderAt.get(location.id)?.toISOString() ?? null,
      });
    }
    return {
      tenantId,
      status: tenant.status,
      generatedAt: now.toISOString(),
      locations: result,
      recentErrors,
    };
  }
}
