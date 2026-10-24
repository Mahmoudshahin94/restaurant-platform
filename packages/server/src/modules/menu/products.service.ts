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
import { FeatureService } from '../features/feature.service';
import { TenantFilesService } from '../files/tenant-files.service';
import {
  assertCategory,
  assertKitchenStations,
  assertModifierGroups,
  assertTaxes,
} from './catalog-refs';
import { type ProductWithRelations, productInclude, toProductDto } from './menu.mappers';
import { type PriceChange, writeProductCatalog } from './product-catalog';

type CreateInput = z.output<typeof createProductSchema>;
type UpdateInput = z.output<typeof updateProductSchema>;
type ListQuery = z.output<typeof listProductsQuerySchema>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly features: FeatureService,
    private readonly files: TenantFilesService,
  ) {}

  async list(tenantId: string, query: ListQuery): Promise<Product[]> {
    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.search
        ? {
            OR: [
              { nameEn: { contains: query.search, mode: 'insensitive' } },
              { nameAr: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: query.search, mode: 'insensitive' } } } },
              // A scanned code finds its product (ADR 0021).
              { barcodes: { some: { code: query.search } } },
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

  async get(tenantId: string, productId: string): Promise<Product> {
    return toProductDto(await this.load(this.prisma, tenantId, productId));
  }

  async create(tenantId: string, input: CreateInput): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      await assertCategory(tx, tenantId, input.categoryId);
      await assertModifierGroups(
        tx,
        tenantId,
        input.modifierGroups.map((l) => l.modifierGroupId),
      );
      await assertKitchenStations(tx, tenantId, input.stationIds);
      await assertTaxes(tx, tenantId, input.taxIds);

      const {
        options,
        variants,
        barcodes,
        imageFileIds,
        modifierGroups,
        stationIds,
        taxIds,
        ...fields
      } = input;
      const { id } = await tx.product.create({
        data: {
          ...fields,
          tenantId,
          modifierGroups: { create: modifierGroups },
          stations: { create: stationIds.map((kitchenStationId) => ({ kitchenStationId })) },
          taxes: { create: taxIds.map((taxId) => ({ taxId })) },
        },
      });
      await writeProductCatalog(
        tx,
        this.catalogServices,
        tenantId,
        await this.load(tx, tenantId, id),
        { sku: fields.sku, options, variants, barcodes, imageFileIds },
      );
      const row = await this.load(tx, tenantId, id);
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

  async update(tenantId: string, productId: string, input: UpdateInput): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, tenantId, productId);
      const {
        options,
        variants,
        barcodes,
        imageFileIds,
        modifierGroups,
        stationIds,
        taxIds,
        ...fields
      } = input;
      const priceChanges: PriceChange[] = [];

      if (fields.categoryId) await assertCategory(tx, tenantId, fields.categoryId);
      if (modifierGroups) {
        await assertModifierGroups(
          tx,
          tenantId,
          modifierGroups.map((l) => l.modifierGroupId),
        );
      }
      if (stationIds) await assertKitchenStations(tx, tenantId, stationIds);
      if (taxIds) await assertTaxes(tx, tenantId, taxIds);

      if (Object.keys(fields).length > 0) {
        await tx.product.update({ where: { id: productId }, data: fields });
        if (fields.price !== undefined && fields.price !== current.price) {
          priceChanges.push({ productId, from: current.price, to: fields.price });
        }
      }

      priceChanges.push(
        ...(await writeProductCatalog(tx, this.catalogServices, tenantId, current, {
          options,
          variants,
          barcodes,
          imageFileIds,
        })),
      );

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
      if (taxIds) {
        await tx.productTax.deleteMany({ where: { productId } });
        await tx.productTax.createMany({ data: taxIds.map((taxId) => ({ productId, taxId })) });
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
      return toProductDto(await this.load(tx, tenantId, productId));
    });
  }

  async setArchived(tenantId: string, productId: string, archived: boolean): Promise<Product> {
    return this.prisma.$transaction(async (tx) => {
      await this.load(tx, tenantId, productId);
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
      return toProductDto(await this.load(tx, tenantId, productId));
    });
  }

  private get catalogServices() {
    return { features: this.features, files: this.files };
  }

  private async load(
    tx: PrismaTx,
    tenantId: string,
    productId: string,
  ): Promise<ProductWithRelations> {
    const row = await tx.product.findFirst({
      where: { id: productId, tenantId },
      include: productInclude,
    });
    if (!row) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found', { productId });
    return row;
  }
}
