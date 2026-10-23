import { Injectable } from '@nestjs/common';
import type { Tenant as TenantRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import type { BusinessType, Locale } from '@pos/shared-types';
import { type Tenant, type UpdateTenantRequest, supportedLocalesSchema } from '@pos/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export function toTenantDto(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    legalName: row.legalName,
    businessType: row.businessType as BusinessType,
    status: row.status,
    currencyCode: row.currencyCode,
    defaultLocale: row.defaultLocale,
    supportedLocales: supportedLocalesOf(row),
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
      const defaultLocale = changes.defaultLocale ?? before.defaultLocale;
      if (!(changes.supportedLocales ?? supportedLocalesOf(before)).includes(defaultLocale)) {
        throw new DomainError('VALIDATION_FAILED', 'The default locale must be supported', {
          issues: [{ path: ['supportedLocales'], message: 'The default locale must be supported' }],
        });
      }
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

/** The stored JSON, falling back to the default locale alone if it was ever written badly. */
export function supportedLocalesOf(
  row: Pick<TenantRow, 'supportedLocales' | 'defaultLocale'>,
): Locale[] {
  const parsed = supportedLocalesSchema.safeParse(row.supportedLocales);
  return parsed.success ? parsed.data : [row.defaultLocale];
}

function pick(row: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)));
}
