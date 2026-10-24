import { Injectable } from '@nestjs/common';
import type { Tenant as TenantRow } from '@pos/database';
import { DomainError, resolveCurrency, resolveLocales } from '@pos/domain';
import type {
  BrandSurface,
  BusinessType,
  CurrencyDisplay,
  DigitStyle,
  FormatLocale,
  Locale,
  ResolvedCurrency,
  ResolvedLocales,
} from '@pos/shared-types';
import {
  type Tenant,
  type TenantContextDto,
  type TenantLocalizationDto,
  type UpdateTenantRequest,
  currencyDisplaySchema,
  digitStyleSchema,
  formatLocaleSchema,
  supportedLocalesSchema,
  type updateLocalizationSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from '../branding/branding.service';
import { FeatureService } from '../features/feature.service';

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
    private readonly features: FeatureService,
    private readonly branding: BrandingService,
  ) {}

  /**
   * What an app needs to render for the tenant (ADR 0018): identity, money, languages, the
   * modules resolved for `locationId` (or the tenant as a whole) and the branding of `surface`
   * (ADR 0019). Served by the cloud and, from its snapshot, by the location hub.
   */
  async context(
    tenantId: string,
    locationId: string | null,
    surface: BrandSurface | null = null,
  ): Promise<TenantContextDto> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!row) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    if (locationId) {
      const found = await this.prisma.location.count({ where: { id: locationId, tenantId } });
      if (found !== 1) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    return {
      tenant: {
        id: row.id,
        slug: row.slug,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        businessType: row.businessType as BusinessType,
        status: row.status,
        timezone: row.timezone,
      },
      branding: await this.branding.resolve(tenantId, surface),
      currency: currencyOf(row),
      locales: localesOf(row),
      locationId,
      features: await this.features.resolve({ tenantId, locationId }),
    };
  }

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

  /** The admin's Language and currency page (ADR 0020). */
  async localization(tenantId: string): Promise<TenantLocalizationDto> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!row) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    return toLocalizationDto(row);
  }

  /**
   * Replaces the tenant's languages and currency display. The currency itself never changes
   * here (ADR 0002). Audited with the values before and after; reaches every hub through the
   * tenant row's change feed.
   */
  async updateLocalization(
    tenantId: string,
    changes: z.output<typeof updateLocalizationSchema>,
  ): Promise<TenantLocalizationDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!before) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
      const after = await tx.tenant.update({ where: { id: tenantId }, data: changes });
      await this.audit.record(
        {
          action: 'localization.updated',
          entityType: 'Tenant',
          entityId: tenantId,
          tenantId,
          metadata: { changes, before: toLocalizationDto(before).settings },
        },
        tx,
      );
      return toLocalizationDto(after);
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

/** A stored text column checked against its list: anything else inherits (null). */
function stored<T>(schema: z.ZodType<T>, value: string | null): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** How the tenant shows amounts (ADR 0020): MADAR's defaults, then the tenant's columns. */
export function currencyOf(
  row: Pick<
    TenantRow,
    'currencyCode' | 'currencySymbol' | 'currencyDisplay' | 'currencyFormatLocale'
  >,
): ResolvedCurrency {
  return resolveCurrency(row.currencyCode, {
    symbol: row.currencySymbol,
    display: stored<CurrencyDisplay>(currencyDisplaySchema, row.currencyDisplay),
    formatLocale: stored<FormatLocale>(formatLocaleSchema, row.currencyFormatLocale),
  });
}

/** The languages the tenant offers and its digit style (ADR 0020). */
export function localesOf(
  row: Pick<TenantRow, 'defaultLocale' | 'supportedLocales' | 'digits'>,
): ResolvedLocales {
  return resolveLocales({
    defaultLocale: row.defaultLocale,
    supportedLocales: supportedLocalesOf(row),
    digits: stored<DigitStyle>(digitStyleSchema, row.digits),
  });
}

function toLocalizationDto(row: TenantRow): TenantLocalizationDto {
  return {
    settings: {
      defaultLocale: row.defaultLocale,
      supportedLocales: supportedLocalesOf(row),
      digits: stored<DigitStyle>(digitStyleSchema, row.digits),
      currencySymbol: row.currencySymbol,
      currencyDisplay: stored<CurrencyDisplay>(currencyDisplaySchema, row.currencyDisplay),
      currencyFormatLocale: stored<FormatLocale>(formatLocaleSchema, row.currencyFormatLocale),
    },
    currency: currencyOf(row),
    locales: localesOf(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pick(row: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)));
}
