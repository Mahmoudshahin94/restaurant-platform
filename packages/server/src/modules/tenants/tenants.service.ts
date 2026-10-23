import { Injectable } from '@nestjs/common';
import type { Tenant as TenantRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import type { Tenant, UpdateTenantRequest } from '@pos/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export function toTenantDto(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    currencyCode: row.currencyCode,
    defaultLocale: row.defaultLocale,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string): Promise<Tenant> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!row) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    return toTenantDto(row);
  }

  async update(tenantId: string, changes: UpdateTenantRequest): Promise<Tenant> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!before) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
      const after = await tx.tenant.update({ where: { id: tenantId }, data: changes });
      await this.audit.record(
        {
          action: 'tenant.updated',
          entityType: 'Tenant',
          entityId: tenantId,
          tenantId,
          metadata: { changes, before: pick(before, Object.keys(changes)) },
        },
        tx,
      );
      return toTenantDto(after);
    });
  }
}

function pick(row: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)));
}
