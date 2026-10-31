import { Injectable } from '@nestjs/common';
import { PrismaService } from '@pos/server';
import type { BrandReport, LocationReport } from '@pos/validation';
import type { ReportContext } from '../reports/report-context';
import { SalesReportsService } from '../reports/sales-reports.service';

/**
 * The two reports only an organization has (E1): sales per brand and per branch. They split the
 * same figures as the daily report (`SalesReportsService.figuresBy`), so each adds up to the
 * organization's totals; the other organization reports are the brand reports run over several
 * brands. Every brand and branch of the request is listed, also those without sales.
 */
@Injectable()
export class OrgReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesReportsService,
  ) {}

  async brands(ctx: ReportContext): Promise<BrandReport> {
    const [{ groups, totals }, tenants] = await Promise.all([
      this.sales.figuresBy(ctx, 'tenantId'),
      this.prisma.tenant.findMany({
        where: { id: { in: ctx.tenantIds } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
    ]);
    const order = (id: string) => ctx.tenantIds.indexOf(id);
    return {
      ...ctx.header,
      rows: tenants
        .sort((a, b) => order(a.id) - order(b.id))
        .map((t) => ({
          tenantId: t.id,
          nameEn: t.nameEn,
          nameAr: t.nameAr,
          ...(groups.get(t.id) ?? SalesReportsService.noSales()),
        })),
      totals,
    };
  }

  async locations(ctx: ReportContext): Promise<LocationReport> {
    const [{ groups, totals }, locations] = await Promise.all([
      this.sales.figuresBy(ctx, 'locationId'),
      this.prisma.location.findMany({
        where: { id: { in: ctx.locationIds }, tenantId: { in: ctx.tenantIds } },
        select: { id: true, tenantId: true, code: true, nameEn: true, nameAr: true },
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const order = (id: string) => ctx.tenantIds.indexOf(id);
    return {
      ...ctx.header,
      // By brand (oldest first), then by branch code.
      rows: locations
        .map((l, i) => ({ l, i }))
        .sort((a, b) => order(a.l.tenantId) - order(b.l.tenantId) || a.i - b.i)
        .map(({ l }) => ({
          tenantId: l.tenantId,
          locationId: l.id,
          code: l.code,
          nameEn: l.nameEn,
          nameAr: l.nameAr,
          ...(groups.get(l.id) ?? SalesReportsService.noSales()),
        })),
      totals,
    };
  }
}
