import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { DomainError, parseOpeningHours } from '@pos/domain';
import type {
  OnlineOrderingOverview,
  PublicLocation,
  PublicTenant,
  PublishedMenu,
  updateOnlineOrderingSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from '../branding/branding.service';
import { TenantFilesService } from '../files/tenant-files.service';
import { PublishedMenuService } from '../menu/published-menu.service';
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
  ) {}

  async tenant(slug: string): Promise<PublicTenant> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      include: { locations: { where: { isActive: true }, orderBy: { code: 'asc' } } },
    });
    if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    const card = (await this.payments.methodFor(this.prisma, tenant.id)) !== null;
    const locations: PublicLocation[] = [];
    for (const location of tenant.locations) {
      const status = await this.status.statusOf(location);
      locations.push(toPublicLocation(location, tenant.currencyCode, status, card));
    }
    return {
      id: tenant.id,
      slug: tenant.slug,
      nameEn: tenant.nameEn,
      nameAr: tenant.nameAr,
      currencyCode: tenant.currencyCode,
      defaultLocale: tenant.defaultLocale,
      timezone: tenant.timezone,
      locations,
      branding: await this.branding.resolve(tenant.id, 'website'),
    };
  }

  /**
   * A file the tenant's branding shows (its logo, its favicon), to anyone: the website and the
   * login screens show them before anybody signs in. Its other files stay private.
   */
  async brandingFile(tenantId: string, fileId: string) {
    if (!(await this.branding.fileIds(tenantId)).includes(fileId)) {
      throw new DomainError('FILE_NOT_FOUND', 'File not found', { fileId });
    }
    return this.files.content(tenantId, fileId);
  }

  async location(locationId: string): Promise<PublicLocation> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { tenant: { select: { currencyCode: true } } },
    });
    if (!location?.isActive) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    const card = (await this.payments.methodFor(this.prisma, location.tenantId)) !== null;
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
