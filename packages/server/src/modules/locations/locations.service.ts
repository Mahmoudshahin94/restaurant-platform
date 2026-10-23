import { Injectable } from '@nestjs/common';
import type { Location as LocationRow } from '@pos/database';
import { DomainError, accessibleLocations } from '@pos/domain';
import type { Location, UpdateLocationRequest, createLocationSchema } from '@pos/validation';
import type { z } from 'zod';
import type { Principal } from '../../common/auth/principal';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export function toLocationDto(row: LocationRow): Location {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    timezone: row.timezone,
    taxInclusive: row.taxInclusive,
    onlineOrderingState: row.onlineOrderingState,
    cashRoundingIncrement: row.cashRoundingIncrement,
    kdsWarnMinutes: row.kdsWarnMinutes,
    kdsLateMinutes: row.kdsLateMinutes,
    addressLine: row.addressLine,
    phone: row.phone,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lists the locations the caller can access (all of them for tenant-wide roles). */
  async list(principal: Principal): Promise<Location[]> {
    const reach = accessibleLocations(principal.assignments);
    const rows = await this.prisma.location.findMany({
      where: {
        tenantId: principal.tenantId,
        ...(reach === 'ALL' ? {} : { id: { in: reach } }),
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map(toLocationDto);
  }

  async get(locationId: string): Promise<Location> {
    const row = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!row) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    return toLocationDto(row);
  }

  async create(tenantId: string, input: z.output<typeof createLocationSchema>): Promise<Location> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.location.create({ data: { ...input, tenantId } });
      await this.audit.record(
        {
          action: 'location.created',
          entityType: 'Location',
          entityId: row.id,
          tenantId,
          locationId: row.id,
          metadata: { location: input },
        },
        tx,
      );
      return toLocationDto(row);
    });
  }

  async update(locationId: string, changes: UpdateLocationRequest): Promise<Location> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.location.findUnique({ where: { id: locationId } });
      if (!before) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
      const warn = changes.kdsWarnMinutes ?? before.kdsWarnMinutes;
      const late = changes.kdsLateMinutes ?? before.kdsLateMinutes;
      if (late <= warn) {
        throw new DomainError('VALIDATION_FAILED', 'The late threshold must be above the warning', {
          issues: [
            { path: ['kdsLateMinutes'], code: 'custom', message: 'Must be above the warning' },
          ],
        });
      }
      const after = await tx.location.update({ where: { id: locationId }, data: changes });
      await this.audit.record(
        {
          action: 'location.updated',
          entityType: 'Location',
          entityId: locationId,
          tenantId: before.tenantId,
          locationId,
          metadata: { changes },
        },
        tx,
      );
      return toLocationDto(after);
    });
  }
}
