import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { DomainError } from '@pos/domain';
import type {
  Product,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertCategory, assertKitchenStations, assertModifierGroups } from './catalog-refs';
import { type ProductWithRelations, productInclude, toProductDto } from './menu.mappers';

type CreateInput = z.output<typeof createProductSchema>;
type UpdateInput = z.output<typeof updateProductSchema>;
type ListQuery = z.output<typeof listProductsQuerySchema>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(restaurantId: string, query: ListQuery): Promise<Product[]> {
    const where: Prisma.ProductWhereInput = {
      restaurantId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.search
        ? {
            OR: [
              { nameEn: { contains: query.search, mode: 'insensitive' } },
              { nameAr: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(toProductDto);
  }

  async get(restaurantId: string, productId: string): Promise<Product> {
    return toProductDto(await this.load(this.prisma, restaurantId, productId));
  }

  async create(restaurantId: string, input: CreateInput): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      await assertCategory(tx, restaurantId, input.categoryId);
      await assertModifierGroups(
        tx,
        restaurantId,
        input.modifierGroups.map((l) => l.modifierGroupId),
      );
      await assertKitchenStations(tx, restaurantId, input.stationIds);

      const { variants, modifierGroups, stationIds, ...fields } = input;
      const row = await tx.product.create({
        data: {
          ...fields,
          restaurantId,
          variants: { create: variants.map(({ id: _ignored, ...v }) => v) },
          modifierGroups: { create: modifierGroups },
          stations: { create: stationIds.map((kitchenStationId) => ({ kitchenStationId })) },
        },
        include: productInclude,
      });
      await this.audit.record(
        {
          action: 'product.created',
          entityType: 'Product',
          entityId: row.id,
          metadata: { product: input },
        },
        tx,
      );
      return toProductDto(row);
    });
  }

  async update(restaurantId: string, productId: string, input: UpdateInput): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, restaurantId, productId);
      const { variants, modifierGroups, stationIds, ...fields } = input;
      const priceChanges: Record<string, unknown>[] = [];

      if (fields.categoryId) await assertCategory(tx, restaurantId, fields.categoryId);
      if (modifierGroups) {
        await assertModifierGroups(
          tx,
          restaurantId,
          modifierGroups.map((l) => l.modifierGroupId),
        );
      }
      if (stationIds) await assertKitchenStations(tx, restaurantId, stationIds);

      if (Object.keys(fields).length > 0) {
        await tx.product.update({ where: { id: productId }, data: fields });
        if (fields.price !== undefined && fields.price !== current.price) {
          priceChanges.push({ productId, from: current.price, to: fields.price });
        }
      }

      if (variants) {
        const existing = new Map(current.variants.map((v) => [v.id, v]));
        const keep = new Set<string>();
        for (const { id, ...data } of variants) {
          if (id) {
            const before = existing.get(id);
            if (!before)
              throw new DomainError('VARIANT_NOT_FOUND', 'Variant not in product', {
                variantId: id,
              });
            keep.add(id);
            await tx.productVariant.update({ where: { id }, data: { ...data, archivedAt: null } });
            if (before.price !== data.price) {
              priceChanges.push({ productId, variantId: id, from: before.price, to: data.price });
            }
          } else {
            await tx.productVariant.create({ data: { ...data, productId } });
          }
        }
        const toArchive = current.variants.filter((v) => v.archivedAt === null && !keep.has(v.id));
        if (toArchive.length > 0) {
          await tx.productVariant.updateMany({
            where: { id: { in: toArchive.map((v) => v.id) } },
            data: { archivedAt: new Date() },
          });
        }
      }

      if (modifierGroups) {
        await tx.productModifierGroup.deleteMany({ where: { productId } });
        await tx.productModifierGroup.createMany({
          data: modifierGroups.map((l) => ({ ...l, productId })),
        });
      }
      if (stationIds) {
        await tx.productStation.deleteMany({ where: { productId } });
        await tx.productStation.createMany({
          data: stationIds.map((kitchenStationId) => ({ productId, kitchenStationId })),
        });
      }

      await this.audit.record(
        {
          action: 'product.updated',
          entityType: 'Product',
          entityId: productId,
          metadata: { changes: input },
        },
        tx,
      );
      for (const change of priceChanges) {
        await this.audit.record(
          {
            action: 'product.price_changed',
            entityType: 'Product',
            entityId: productId,
            metadata: change,
          },
          tx,
        );
      }
      return toProductDto(await this.load(tx, restaurantId, productId));
    });
  }

  async setArchived(restaurantId: string, productId: string, archived: boolean): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      await this.load(tx, restaurantId, productId);
      await tx.product.update({
        where: { id: productId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'product.archived' : 'product.restored',
          entityType: 'Product',
          entityId: productId,
        },
        tx,
      );
      return toProductDto(await this.load(tx, restaurantId, productId));
    });
  }

  private async load(
    tx: PrismaTx,
    restaurantId: string,
    productId: string,
  ): Promise<ProductWithRelations> {
    const row = await tx.product.findFirst({
      where: { id: productId, restaurantId },
      include: productInclude,
    });
    if (!row) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found', { productId });
    return row;
  }
}
