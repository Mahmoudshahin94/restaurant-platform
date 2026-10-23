import { Injectable } from '@nestjs/common';
import type { TenantBranding as BrandingRow } from '@pos/database';
import { DomainError, brandingContrastIssues, brandingFileIds, resolveBranding } from '@pos/domain';
import {
  BRANDING_KEYS,
  BRAND_SURFACES,
  type BrandSurface,
  type BrandingLayer,
  type ResolvedBranding,
  type SurfaceOverrides,
  type TenantFileKind,
} from '@pos/shared-types';
import {
  type BrandingLayerDto,
  type SurfaceOverridesDto,
  type TenantBrandingDto,
  surfaceOverridesSchema,
  type updateBrandingSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { type PrismaTx, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantFilesService, toTenantFileDto } from '../files/tenant-files.service';

type BrandingUpdate = z.output<typeof updateBrandingSchema>;

/** The tenant's own values as stored: null inherits. */
export function brandingLayerOf(row: BrandingRow | null): BrandingLayerDto {
  return {
    displayNameEn: row?.displayNameEn ?? null,
    displayNameAr: row?.displayNameAr ?? null,
    logoFileId: row?.logoFileId ?? null,
    faviconFileId: row?.faviconFileId ?? null,
    primaryColor: row?.primaryColor ?? null,
    secondaryColor: row?.secondaryColor ?? null,
    accentColor: row?.accentColor ?? null,
    fontFamily: (row?.fontFamily ?? null) as BrandingLayerDto['fontFamily'],
    logoSize: (row?.logoSize ?? null) as BrandingLayerDto['logoSize'],
    themeMode: (row?.themeMode ?? null) as BrandingLayerDto['themeMode'],
    surfaceStyle: (row?.surfaceStyle ?? null) as BrandingLayerDto['surfaceStyle'],
    borderRadius: row?.borderRadius ?? null,
  };
}

/** The stored per-surface overrides; ignored as a whole if ever written badly. */
export function surfacesOf(row: Pick<BrandingRow, 'surfaces'> | null): SurfaceOverridesDto {
  const parsed = surfaceOverridesSchema.safeParse(row?.surfaces ?? {});
  return parsed.success ? parsed.data : {};
}

/** Only what each surface sets: no null values, no empty surfaces. */
function compactSurfaces(surfaces: SurfaceOverridesDto): SurfaceOverrides {
  const out: SurfaceOverrides = {};
  for (const surface of BRAND_SURFACES) {
    const layer = surfaces[surface];
    if (!layer) continue;
    const set = Object.fromEntries(
      Object.entries(layer).filter(([, value]) => (value as unknown) != null),
    ) as BrandingLayer;
    if (Object.keys(set).length > 0) out[surface] = set;
  }
  return out;
}

/**
 * A tenant's branding (ADR 0019): what the admin's Branding page reads and writes, and what every
 * screen gets, resolved for its surface. Served by the cloud and, from its snapshot, the hub.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: TenantFilesService,
  ) {}

  /** The tenant's branding for one surface (null: its defaults). */
  async resolve(
    tenantId: string,
    surface: BrandSurface | null,
    db: PrismaTx = this.prisma,
  ): Promise<ResolvedBranding> {
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { nameEn: true, nameAr: true, branding: true },
    });
    if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    return resolveBranding({
      tenantNames: tenant,
      tenant: brandingLayerOf(tenant.branding),
      surfaces: surfacesOf(tenant.branding),
      surface,
    });
  }

  async get(tenantId: string, db: PrismaTx = this.prisma): Promise<TenantBrandingDto> {
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { nameEn: true, nameAr: true, branding: true },
    });
    if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    const layer = brandingLayerOf(tenant.branding);
    const surfaces = surfacesOf(tenant.branding);
    const ids = brandingFileIds(layer, surfaces);
    const files = ids.length
      ? await db.tenantFile.findMany({ where: { tenantId, id: { in: ids } } })
      : [];
    return {
      tenant: layer,
      surfaces,
      resolved: resolveBranding({ tenantNames: tenant, tenant: layer, surfaces, surface: null }),
      files: files.map(toTenantFileDto),
      updatedAt: tenant.branding?.updatedAt.toISOString() ?? null,
    };
  }

  /** The ids of the files the tenant's branding refers to (anything else stays private). */
  async fileIds(tenantId: string, db: PrismaTx = this.prisma): Promise<string[]> {
    const row = await db.tenantBranding.findUnique({ where: { tenantId } });
    return brandingFileIds(brandingLayerOf(row), surfacesOf(row));
  }

  /**
   * Replaces the tenant's branding. Files must be the tenant's own, of the right kind, and every
   * colour must stay readable on both themes (`BRANDING_UNREADABLE` otherwise).
   */
  async update(tenantId: string, input: BrandingUpdate): Promise<TenantBrandingDto> {
    const { surfaces: rawSurfaces, ...values } = input;
    const surfaces = compactSurfaces(rawSurfaces);
    const issues = brandingContrastIssues(values, surfaces);
    if (issues.length > 0) {
      throw new DomainError('BRANDING_UNREADABLE', 'Some brand colours are not readable', {
        issues,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const wanted: { id: string; kind: TenantFileKind }[] = [];
      for (const layer of [values, ...Object.values(surfaces)]) {
        if (layer.logoFileId) wanted.push({ id: layer.logoFileId, kind: 'LOGO' });
        if (layer.faviconFileId) wanted.push({ id: layer.faviconFileId, kind: 'FAVICON' });
      }
      await this.files.assertOwned(tx, tenantId, wanted);

      const before = await tx.tenantBranding.findUnique({ where: { tenantId } });
      const data = { ...values, surfaces };
      await tx.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
      });
      const previous = { ...brandingLayerOf(before), surfaces: surfacesOf(before) };
      const changed = [...BRANDING_KEYS, 'surfaces' as const].filter(
        (key) => JSON.stringify(previous[key]) !== JSON.stringify(data[key]),
      );
      if (changed.length > 0) {
        await this.audit.record(
          {
            action: 'branding.updated',
            entityType: 'Tenant',
            entityId: tenantId,
            tenantId,
            metadata: {
              changed,
              before: Object.fromEntries(changed.map((k) => [k, previous[k]])),
              after: Object.fromEntries(changed.map((k) => [k, data[k]])),
            },
          },
          tx,
        );
      }
      return this.get(tenantId, tx);
    });
  }
}
