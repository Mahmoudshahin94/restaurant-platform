import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Location } from '@pos/database';
import { DomainError, type LocationMenu, resolveLocationMenu } from '@pos/domain';
import type {
  LocationProductSetting,
  PublishedMenu,
  setLocationProductSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  productInclude,
  toCatalogModifierGroup,
  toCatalogProduct,
  toLocationProductDto,
} from './menu.mappers';

/**
 * Builds the menu a location sells (via the domain's `resolveLocationMenu`) and manages the
 * per-location settings that feed it: availability ("86") and price overrides.
 */
@Injectable()
export class PublishedMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The location and the domain menu it sells right now. Used for the published menu and, by
   * the orders module, to validate and price orders on the server.
   */
  async resolve(
    locationId: string,
  ): Promise<{ location: Location; currencyCode: string; menu: LocationMenu }> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { restaurant: { select: { currencyCode: true } } },
    });
    if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    const live = { restaurantId: location.restaurantId, archivedAt: null };

    const [categories, products, modifierGroups, kitchenStations, taxes, settings] =
      await Promise.all([
        this.prisma.category.findMany({ where: live }),
        this.prisma.product.findMany({ where: live, include: productInclude }),
        this.prisma.modifierGroup.findMany({ where: live, include: { modifiers: true } }),
        this.prisma.kitchenStation.findMany({ where: live }),
        this.prisma.tax.findMany({ where: live }),
        this.prisma.locationProduct.findMany({ where: { locationId } }),
      ]);

    const menu = resolveLocationMenu(
      {
        categories,
        products: products.map(toCatalogProduct),
        modifierGroups: modifierGroups.map(toCatalogModifierGroup),
        kitchenStations,
        taxes,
      },
      settings,
    );
    return { location, currencyCode: location.restaurant.currencyCode, menu };
  }

  async getForLocation(locationId: string): Promise<PublishedMenu> {
    const { location, currencyCode, menu } = await this.resolve(locationId);
    const body = {
      restaurantId: location.restaurantId,
      locationId,
      currencyCode,
      taxInclusive: location.taxInclusive,
      taxes: menu.taxes,
      categories: menu.categories,
    };
    const version = createHash('sha256')
      .update(JSON.stringify(body))
      .digest('base64url')
      .slice(0, 32);
    return { ...body, version };
  }

  async listSettings(locationId: string): Promise<LocationProductSetting[]> {
    const rows = await this.prisma.locationProduct.findMany({ where: { locationId } });
    return rows.map(toLocationProductDto);
  }

  async setProductSetting(
    restaurantId: string,
    locationId: string,
    productId: string,
    input: z.output<typeof setLocationProductSchema>,
  ): Promise<LocationProductSetting> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, restaurantId },
        include: { variants: { where: { archivedAt: null }, select: { id: true } } },
      });
      if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found', { productId });
      if (input.priceOverride !== null && product.variants.length > 0) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'Price overrides apply only to products without variants',
          {
            reason: 'PRICE_OVERRIDE_WITH_VARIANTS',
            productId,
          },
        );
      }

      const before = await tx.locationProduct.findUnique({
        where: { locationId_productId: { locationId, productId } },
      });
      const row = await tx.locationProduct.upsert({
        where: { locationId_productId: { locationId, productId } },
        create: { locationId, productId, ...input },
        update: input,
      });

      await this.audit.record(
        {
          action: 'location_product.updated',
          entityType: 'Product',
          entityId: productId,
          locationId,
          metadata: {
            isAvailable: { from: before?.isAvailable ?? true, to: input.isAvailable },
            priceOverride: { from: before?.priceOverride ?? null, to: input.priceOverride },
          },
        },
        tx,
      );
      if ((before?.priceOverride ?? null) !== input.priceOverride) {
        await this.audit.record(
          {
            action: 'product.price_changed',
            entityType: 'Product',
            entityId: productId,
            locationId,
            metadata: {
              scope: 'location',
              from: before?.priceOverride ?? null,
              to: input.priceOverride,
            },
          },
          tx,
        );
      }
      return toLocationProductDto(row);
    });
  }
}
