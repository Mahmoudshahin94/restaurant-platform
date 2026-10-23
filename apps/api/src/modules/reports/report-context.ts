import { Injectable } from '@nestjs/common';
import { Prisma } from '@pos/database';
import { DomainError } from '@pos/domain';
import { type Principal, PrismaService } from '@pos/server';
import { OrderChannel, enumValues } from '@pos/shared-types';
import type { reportQuerySchema } from '@pos/validation';
import type { z } from 'zod';
import { permittedLocationIds } from '../admin/scope';

export type ReportQueryInput = z.output<typeof reportQuerySchema>;
export type Channel = OrderChannel;

/** What a report covers, resolved against the caller's reach. */
export interface ReportContext {
  tenantId: string;
  locationIds: string[];
  from: string;
  to: string;
  /** Null = every channel. */
  channels: Channel[] | null;
  header: {
    from: string;
    to: string;
    currencyCode: string;
    locationIds: string[];
    channels: Channel[] | null;
    generatedAt: string;
  };
}

/** Every channel, in catalog order. */
export const ALL_CHANNELS: readonly Channel[] = enumValues(OrderChannel);

/**
 * Resolves the locations a report covers: those requested, each of which must be one where the
 * caller holds `reports.view` (404 otherwise, as for other tenants' locations), or all of those.
 */
@Injectable()
export class ReportContextResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(principal: Principal, q: ReportQueryInput): Promise<ReportContext> {
    const permitted = await permittedLocationIds(this.prisma, principal, ['reports.view']);
    let locationIds = permitted;
    if (q.locationIds) {
      const missing = q.locationIds.filter((id) => !permitted.includes(id));
      if (missing.length > 0) {
        throw new DomainError('LOCATION_NOT_FOUND', 'Location not found', {
          locationId: missing[0],
        });
      }
      locationIds = permitted.filter((id) => q.locationIds?.includes(id));
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: principal.tenantId },
      select: { currencyCode: true },
    });
    const channels = q.channels ? ALL_CHANNELS.filter((c) => q.channels?.includes(c)) : null;
    return {
      tenantId: principal.tenantId,
      locationIds,
      from: q.from,
      to: q.to,
      channels,
      header: {
        from: q.from,
        to: q.to,
        currencyCode: tenant.currencyCode,
        locationIds,
        channels,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * The common filter of report views: the tenant, the locations, the business dates and (when
 * `withChannels`) the channels, on the view aliased `alias`.
 */
export function reportFilter(ctx: ReportContext, alias: string, withChannels = true): Prisma.Sql {
  const a = Prisma.raw(alias);
  const channels =
    withChannels && ctx.channels
      ? Prisma.sql`AND ${a}.channel::text = ANY(${ctx.channels}::text[])`
      : Prisma.empty;
  return Prisma.sql`${a}.tenant_id = ${ctx.tenantId}::uuid
    AND ${a}.location_id = ANY(${ctx.locationIds}::uuid[])
    AND ${a}.business_date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
    ${channels}`;
}

/** A SQL sum or count (bigint, numeric or null) as a safe integer. */
export function int(value: bigint | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new DomainError('INTERNAL_ERROR', 'Report value out of range', { value: String(value) });
  }
  return n;
}
