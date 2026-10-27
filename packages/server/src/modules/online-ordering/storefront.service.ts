import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { DomainError, parseOpeningHours } from '@pos/domain';
import { TenantFileKind } from '@pos/shared-types';
import type {
  OnlineOrderingOverview,
  PublicLocation,
  PublicSite,
  PublishedMenu,
  updateOnlineOrderingSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from '../branding/branding.service';
import { TenantFilesService } from '../files/tenant-files.service';
import { PublishedMenuService } from '../menu/published-menu.service';
import { currencyOf, localesOf } from '../tenants/tenants.service';
import { TenantDomainsService } from '../website/tenant-domains.service';
import { WebsiteService } from '../website/website.service';
import { OnlinePaymentsService } from './online-payments.service';
import { OnlineStatusService } from './online-status.service';
import { toPublicLocation } from './web-order.mappers';

/** The public storefront (tenant, locations, menus) and the tenant's ordering settings. */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menus: PublishedMenuService,
    private readonly status: OnlineStatusService,
    private readonly payments: OnlinePaymentsService,
    private readonly audit: AuditService,
    private readonly branding: BrandingService,
    private readonly files: TenantFilesService,
    private readonly website: WebsiteService,
    private readonly domains: TenantDomainsService,
  ) {}

  /**
   * The website of the tenant a host name resolved to (ADR 0023): its names, languages, currency,
   * branding, active locations and the published website, or the draft for a valid preview
   * token. Nothing of any other tenant, and no slug or internal settings.
   */
  async site(tenantId: string, host: string, previewToken?: string): Promise<PublicSite> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { locations: { where: { isActive: true }, orderBy: { code: 'asc' } } },
    });
    if (!tenant) throw new DomainError('SITE_NOT_FOUND', 'Website not found');
    const locations: PublicLocation[] = [];
    for (const location of tenant.locations) {
      // Each location may have its own online provider, or none (ADR 0024).
      const card = await this.payments.available(tenant.id, location.id);
      const status = await this.status.statusOf(location);
      locations.push(toPublicLocation(location, tenant.currencyCode, status, card));
    }
    const preview = this.website.previewAllowed(tenant.id, previewToken);
    return {
      id: tenant.id,
      nameEn: tenant.nameEn,
      nameAr: tenant.nameAr,
      currency: currencyOf(tenant),
      locales: localesOf(tenant),
      timezone: tenant.timezone,
      locations,
      branding: await this.branding.resolve(tenant.id, 'website'),
      website: preview
        ? await this.website.draft(tenant.id)
        : await this.website.published(tenant.id),
      preview,
      primaryDomain: (await this.domains.primary(tenant.id)) ?? host,
    };
  }

  /**
   * A file the website shows, to anyone: its branding's logo and favicon, and the pictures
   * uploaded for the website's sections (kind WEBSITE_IMAGE, public by purpose). Its other files
   * (product pictures, unused uploads of other kinds) stay private.
   */
  async siteFile(tenantId: string, fileId: string) {
    const file = await this.prisma.tenantFile.findFirst({
      where: { id: fileId, tenantId },
      select: { kind: true },
    });
    const shown =
      file !== null &&
      (file.kind === TenantFileKind.WEBSITE_IMAGE ||
        (await this.branding.fileIds(tenantId)).includes(fileId));
    if (!shown) throw new DomainError('FILE_NOT_FOUND', 'File not found', { fileId });
    return this.files.content(tenantId, fileId);
  }

  async location(locationId: string): Promise<PublicLocation> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { tenant: { select: { currencyCode: true } } },
    });
    if (!location?.isActive) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    const card = await this.payments.available(location.tenantId, location.id);
    const status = await this.status.statusOf(location);
    return toPublicLocation(location, location.tenant.currencyCode, status, card);
  }

  /** The location's published menu (same shape and ETag as the staff endpoint). */
  async menu(locationId: string): Promise<PublishedMenu> {
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location?.isActive) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    return this.menus.getForLocation(locationId);
  }

  // --- Settings (staff) --------------------------------------------------------------------------

  async settings(locationId: string): Promise<OnlineOrderingOverview> {
    const location = await this.prisma.location.findUniqueOrThrow({ where: { id: locationId } });
    const hubLastSeenAt = await this.status.hubLastSeenAt(locationId);
    return {
      state: location.onlineOrderingState === 'OFFLINE' ? 'CLOSED' : location.onlineOrderingState,
      openingHours: parseOpeningHours(location.openingHours),
      acceptMinutes: location.onlineAcceptMinutes,
      pickupEnabled: location.onlinePickupEnabled,
      deliveryEnabled: location.onlineDeliveryEnabled,
      deliveryFee: location.onlineDeliveryFee,
      status: await this.status.statusOf(location),
      hubLastSeenAt: hubLastSeenAt?.toISOString() ?? null,
    };
  }

  async updateSettings(
    locationId: string,
    input: z.output<typeof updateOnlineOrderingSchema>,
  ): Promise<OnlineOrderingOverview> {
    const before = await this.settings(locationId);
    const data: Prisma.LocationUpdateInput = {
      ...(input.state !== undefined ? { onlineOrderingState: input.state } : {}),
      ...(input.openingHours !== undefined ? { openingHours: input.openingHours } : {}),
      ...(input.acceptMinutes !== undefined ? { onlineAcceptMinutes: input.acceptMinutes } : {}),
      ...(input.pickupEnabled !== undefined ? { onlinePickupEnabled: input.pickupEnabled } : {}),
      ...(input.deliveryEnabled !== undefined
        ? { onlineDeliveryEnabled: input.deliveryEnabled }
        : {}),
      ...(input.deliveryFee !== undefined ? { onlineDeliveryFee: input.deliveryFee } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.location.update({ where: { id: locationId }, data });
      const { status: _status, hubLastSeenAt: _seen, ...previous } = before;
      await this.audit.record(
        {
          action: 'online_ordering.updated',
          entityType: 'Location',
          entityId: locationId,
          locationId,
          metadata: { before: previous, after: input },
        },
        tx,
      );
    });
    return this.settings(locationId);
  }
}
