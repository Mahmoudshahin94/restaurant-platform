import { Injectable } from '@nestjs/common';
import type { Restaurant as RestaurantRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import type { Restaurant, UpdateRestaurantRequest } from '@pos/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export function toRestaurantDto(row: RestaurantRow): Restaurant {
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
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(restaurantId: string): Promise<Restaurant> {
    const row = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (!row) throw new DomainError('RESTAURANT_NOT_FOUND', 'Restaurant not found');
    return toRestaurantDto(row);
  }

  async update(restaurantId: string, changes: UpdateRestaurantRequest): Promise<Restaurant> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.restaurant.findUnique({ where: { id: restaurantId } });
      if (!before) throw new DomainError('RESTAURANT_NOT_FOUND', 'Restaurant not found');
      const after = await tx.restaurant.update({ where: { id: restaurantId }, data: changes });
      await this.audit.record(
        {
          action: 'restaurant.updated',
          entityType: 'Restaurant',
          entityId: restaurantId,
          restaurantId,
          metadata: { changes, before: pick(before, Object.keys(changes)) },
        },
        tx,
      );
      return toRestaurantDto(after);
    });
  }
}

function pick(row: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => keys.includes(k)));
}
