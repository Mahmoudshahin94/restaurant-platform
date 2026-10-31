import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { PrismaService } from '@pos/server';
import type { orgReportQuerySchema } from '@pos/validation';
import type { z } from 'zod';
import { ALL_CHANNELS, type ReportContext } from '../reports/report-context';
import type { RequestOrganization } from './organization.guard';

export type OrgReportQueryInput = z.output<typeof orgReportQuerySchema>;

/**
 * What an organization's report covers: its brands (those requested, each of which must be one
 * of the organization's, else 404 `TENANT_NOT_FOUND`, as for another organization's brand) and
 * those brands' branches (those requested, each of which must belong to the brands covered, else
 * 404 `LOCATION_NOT_FOUND`). Organization members see every branch of every brand, so there is
 * no per-location permission to apply; amounts are in the organization's currency.
 */
@Injectable()
export class OrgReportContextResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(org: RequestOrganization, q: OrgReportQueryInput): Promise<ReportContext> {
    if (q.tenantIds) {
      const foreign = q.tenantIds.find((id) => !org.tenantIds.includes(id));
      if (foreign)
        throw new DomainError('TENANT_NOT_FOUND', 'Brand not found', { tenantId: foreign });
    }
    const tenantIds = q.tenantIds
      ? org.tenantIds.filter((id) => q.tenantIds?.includes(id))
      : org.tenantIds;
    // Every branch of those brands (also closed ones: their history still counts). The scope adds
    // the organization's brands; the filter says which of them.
    const branches = await this.prisma.location.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { id: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    const available = branches.map((l) => l.id);
    if (q.locationIds) {
      const foreign = q.locationIds.find((id) => !available.includes(id));
      if (foreign) {
        throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', { locationId: foreign });
      }
    }
    const locationIds = q.locationIds
      ? available.filter((id) => q.locationIds?.includes(id))
      : available;
    const channels = q.channels ? ALL_CHANNELS.filter((c) => q.channels?.includes(c)) : null;
    return {
      tenantIds,
      locationIds,
      from: q.from,
      to: q.to,
      channels,
      header: {
        from: q.from,
        to: q.to,
        currencyCode: org.currencyCode,
        locationIds,
        channels,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
