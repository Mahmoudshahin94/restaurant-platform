import { Injectable } from '@nestjs/common';
import { averageMinor, businessDateFor } from '@pos/domain';
import { PrismaService } from '@pos/server';
import type { OrgDashboard, OrgDashboardPeriod, OrganizationOverview } from '@pos/validation';
import { DevicesService, toAdminDevice } from '../devices/devices.service';
import { int } from '../reports/report-context';
import type { RequestOrganization } from './organization.guard';

/** Days the dashboard looks back, counting today. */
const WINDOW_DAYS = 30;
const WEEK_DAYS = 7;

const DAY_MS = 86_400_000;
/** `date` (YYYY-MM-DD) moved by `days`. */
const shift = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const period = (salesTotal: number, orderCount: number): OrgDashboardPeriod => ({
  salesTotal,
  orderCount,
  averageTicket: averageMinor(salesTotal, orderCount),
});

/**
 * The organization's start page (E1 §4.2): its brands with their branches, and a dashboard of
 * sales over all of them. Sales are completed orders (the `report_sales_orders` view, so the
 * figures match the reports); each branch's days are its own business days (ADR 0015), so
 * "today" differs between branches in different time zones. The SQL binds the organization's
 * brands itself (the organization scope does not cover raw SQL).
 */
@Injectable()
export class OrgDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  async overview(org: RequestOrganization): Promise<OrganizationOverview> {
    const [organization, tenants] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: org.id } }),
      this.prisma.tenant.findMany({
        where: { id: { in: org.tenantIds } },
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          branding: { select: { logoFileId: true } },
          locations: {
            select: { id: true, code: true, nameEn: true, nameAr: true, timezone: true },
            orderBy: [{ code: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    ]);
    return {
      organization: {
        id: organization.id,
        slug: organization.slug,
        nameEn: organization.nameEn,
        nameAr: organization.nameAr,
        currencyCode: organization.currencyCode,
        role: org.role,
      },
      brands: tenants
        .sort((a, b) => org.tenantIds.indexOf(a.id) - org.tenantIds.indexOf(b.id))
        .map(({ branding, ...t }) => ({ ...t, logoFileId: branding?.logoFileId ?? null })),
    };
  }

  async build(org: RequestOrganization, now = new Date()): Promise<OrgDashboard> {
    const locations = await this.prisma.location.findMany({
      where: { tenantId: { in: org.tenantIds } },
      select: { id: true, tenantId: true, timezone: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    const rank = (tenantId: string) => org.tenantIds.indexOf(tenantId);
    locations.sort((a, b) => rank(a.tenantId) - rank(b.tenantId));
    const days = new Map(
      locations.map((l) => {
        const today = businessDateFor(now, l.timezone);
        return [
          l.id,
          { today, week: shift(today, 1 - WEEK_DAYS), start: shift(today, 1 - WINDOW_DAYS) },
        ];
      }),
    );
    const earliest = [...days.values()].map((d) => d.start).sort()[0];
    const [sales, hubs] = await Promise.all([
      earliest === undefined
        ? Promise.resolve([])
        : this.prisma.$queryRaw<
            {
              tenant_id: string;
              location_id: string;
              business_date: string;
              orders: bigint;
              total: bigint | null;
            }[]
          >`
            SELECT s.tenant_id, s.location_id, s.business_date::text AS business_date,
              COUNT(*)::bigint AS orders, SUM(s.total)::bigint AS total
            FROM report_sales_orders s
            WHERE s.tenant_id = ANY(${org.tenantIds}::uuid[])
              AND s.location_id = ANY(${locations.map((l) => l.id)}::uuid[])
              AND s.business_date >= ${earliest}::date
            GROUP BY 1, 2, 3`,
      this.hubsOnline(
        org,
        locations.map((l) => l.id),
        now,
      ),
    ]);

    const today = { total: 0, orders: 0 };
    const week = { total: 0, orders: 0 };
    const month = { total: 0, orders: 0 };
    const byBrand = new Map(org.tenantIds.map((id) => [id, { total: 0, orders: 0 }]));
    const byLocation = new Map(locations.map((l) => [l.id, { total: 0, orders: 0 }]));
    const daily = new Map<string, Map<string, number>>();
    for (const row of sales) {
      const window = days.get(row.location_id);
      // A day after the branch's today (clock skew, a test) or before its window is not counted.
      if (!window || row.business_date > window.today || row.business_date < window.start) continue;
      const total = int(row.total);
      const orders = int(row.orders);
      const add = (to: { total: number; orders: number }) => {
        to.total += total;
        to.orders += orders;
      };
      add(month);
      if (row.business_date >= window.week) add(week);
      if (row.business_date === window.today) add(today);
      const brand = byBrand.get(row.tenant_id);
      if (brand) add(brand);
      const location = byLocation.get(row.location_id);
      if (location) add(location);
      const day = daily.get(row.business_date) ?? new Map<string, number>();
      day.set(row.tenant_id, (day.get(row.tenant_id) ?? 0) + total);
      daily.set(row.business_date, day);
    }

    return {
      currencyCode: org.currencyCode,
      periods: {
        today: period(today.total, today.orders),
        last7: period(week.total, week.orders),
        last30: period(month.total, month.orders),
      },
      byBrand: org.tenantIds.map((tenantId) => ({
        tenantId,
        salesTotal: byBrand.get(tenantId)?.total ?? 0,
        orderCount: byBrand.get(tenantId)?.orders ?? 0,
      })),
      byLocation: locations.map((l) => ({
        tenantId: l.tenantId,
        locationId: l.id,
        salesTotal: byLocation.get(l.id)?.total ?? 0,
        orderCount: byLocation.get(l.id)?.orders ?? 0,
        hubOnline: hubs.has(l.id),
      })),
      daily: this.series(org.tenantIds, [...days.values()], daily),
    };
  }

  /** One entry per day from the earliest branch's window start to the latest branch's today. */
  private series(
    tenantIds: readonly string[],
    windows: readonly { today: string; start: string }[],
    daily: ReadonlyMap<string, ReadonlyMap<string, number>>,
  ): OrgDashboard['daily'] {
    const first = windows.map((w) => w.start).sort()[0];
    const last = windows
      .map((w) => w.today)
      .sort()
      .at(-1);
    if (first === undefined || last === undefined) return [];
    const out: OrgDashboard['daily'] = [];
    for (let date = first; date <= last; date = shift(date, 1)) {
      out.push({
        date,
        byTenant: Object.fromEntries(tenantIds.map((id) => [id, daily.get(date)?.get(id) ?? 0])),
      });
    }
    return out;
  }

  /** The branches with an active hub that reported within the heartbeat window. */
  private async hubsOnline(
    org: RequestOrganization,
    locationIds: string[],
    now: Date,
  ): Promise<Set<string>> {
    const hubs = await this.prisma.device.findMany({
      where: {
        tenantId: { in: org.tenantIds },
        locationId: { in: locationIds },
        type: 'GATEWAY',
        status: 'ACTIVE',
      },
    });
    return new Set(
      hubs
        .filter((h) => toAdminDevice(h, this.devices.staleAfterMs, now).online)
        .map((h) => h.locationId),
    );
  }
}
