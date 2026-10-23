import { Injectable } from '@nestjs/common';
import type { Location } from '@pos/database';
import {
  businessDateFor,
  onlineOrderingStatus,
  parseOpeningHours,
  resolvePermissions,
} from '@pos/domain';
import { type Principal, PrismaService } from '@pos/server';
import { OPEN_ORDER_STATUSES } from '@pos/shared-types';
import type { Dashboard, DashboardLocation } from '@pos/validation';
import { DevicesService, toAdminDevice } from '../../devices/devices.service';
import { permittedLocationIds } from '../scope';

/**
 * A small "today" view per location (full reports come in Phase 9): orders and sales of the
 * location's business day, open shifts, what online customers see, and the hub link. Only
 * locations where the caller may view orders are listed; the hub link only where they hold
 * `sync.view`.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  async build(principal: Principal): Promise<Dashboard> {
    const ids = await permittedLocationIds(this.prisma, principal, ['orders.view']);
    const [tenant, locations] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: principal.tenantId },
        select: { currencyCode: true },
      }),
      this.prisma.location.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const now = new Date();
    const rows = await Promise.all(
      locations.map((location) => this.forLocation(principal, location, now)),
    );
    return {
      currencyCode: tenant.currencyCode,
      generatedAt: now.toISOString(),
      locations: rows,
    };
  }

  private async forLocation(
    principal: Principal,
    location: Location,
    now: Date,
  ): Promise<DashboardLocation> {
    const today = businessDateFor(now, location.timezone);
    const day = { locationId: location.id, businessDate: new Date(`${today}T00:00:00Z`) };
    const counted = { ...day, status: { not: 'DRAFT' as const } };
    const [count, open, cancelled, sales, payments, openShifts, hubs] = await Promise.all([
      this.prisma.order.count({ where: counted }),
      this.prisma.order.count({
        where: { ...day, status: { in: OPEN_ORDER_STATUSES.filter((s) => s !== 'DRAFT') } },
      }),
      this.prisma.order.count({ where: { ...day, status: 'CANCELLED' } }),
      this.prisma.order.aggregate({
        where: { ...day, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        _sum: { total: true },
      }),
      this.prisma.payment.groupBy({
        by: ['type'],
        where: { status: 'CAPTURED', order: day },
        _sum: { amount: true },
      }),
      this.prisma.shift.count({ where: { locationId: location.id, status: 'OPEN' } }),
      this.prisma.device.findMany({
        where: { locationId: location.id, type: 'GATEWAY' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const amount = (type: 'CHARGE' | 'REFUND') =>
      payments.find((p) => p.type === type)?._sum.amount ?? 0;
    const devices = hubs.map((h) => toAdminDevice(h, this.devices.staleAfterMs, now));
    const active = devices.filter((d) => d.status === 'ACTIVE');
    const lastSeen = active
      .map((d) => d.lastSeenAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1);
    const canSeeSync = resolvePermissions(principal.assignments, location.id).has('sync.view');
    const reporting = active.find((d) => d.outbox !== null);

    return {
      locationId: location.id,
      code: location.code,
      nameEn: location.nameEn,
      nameAr: location.nameAr,
      timezone: location.timezone,
      isActive: location.isActive,
      businessDate: today,
      orders: { count, open, cancelled },
      sales: { total: sales._sum.total ?? 0, paid: amount('CHARGE') - amount('REFUND') },
      openShifts,
      onlineOrdering: onlineOrderingStatus({
        setting: location.onlineOrderingState,
        isActive: location.isActive,
        openingHours: parseOpeningHours(location.openingHours),
        timeZone: location.timezone,
        hubLastSeenAt: lastSeen ? new Date(lastSeen) : null,
        hubStaleAfterMs: this.devices.staleAfterMs,
        now,
      }),
      sync: canSeeSync
        ? {
            hub:
              devices.length === 0
                ? 'NOT_PAIRED'
                : active.length === 0
                  ? 'DISABLED'
                  : active.some((d) => d.online)
                    ? 'ONLINE'
                    : 'OFFLINE',
            lastSeenAt: lastSeen ?? null,
            pending: reporting?.outbox?.pending ?? null,
            failed: reporting?.outbox?.failed ?? null,
            openIssues: await this.prisma.processedOperation.count({
              where: {
                locationId: location.id,
                status: { in: ['CONFLICT', 'REJECTED'] },
                resolution: null,
              },
            }),
          }
        : null,
    };
  }
}
