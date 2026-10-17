import { Injectable } from '@nestjs/common';
import type { Discount as DiscountRow, Tax as TaxRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import type {
  Discount,
  Tax,
  createDiscountSchema,
  createTaxSchema,
  updateDiscountSchema,
  updateTaxSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const iso = (d: Date) => d.toISOString();

export function toTaxDto(row: TaxRow): Tax {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    rateBps: row.rateBps,
    isDefault: row.isDefault,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toDiscountDto(row: DiscountRow): Discount {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    type: row.type,
    value: row.value,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Taxes and predefined discounts. Changing a rate or value affects only orders priced after
 * the change: existing orders keep their snapshots. Every change is audited.
 */
@Injectable()
export class PricingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listTaxes(restaurantId: string, includeArchived: boolean): Promise<Tax[]> {
    const rows = await this.prisma.tax.findMany({
      where: { restaurantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map(toTaxDto);
  }

  async createTax(restaurantId: string, input: z.output<typeof createTaxSchema>): Promise<Tax> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.tax.create({ data: { ...input, restaurantId } });
      await this.audit.record(
        { action: 'tax.created', entityType: 'Tax', entityId: row.id, metadata: { tax: input } },
        tx,
      );
      return toTaxDto(row);
    });
  }

  async updateTax(
    restaurantId: string,
    taxId: string,
    changes: z.output<typeof updateTaxSchema>,
  ): Promise<Tax> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.tax.findFirst({ where: { id: taxId, restaurantId } });
      if (!before) throw new DomainError('TAX_NOT_FOUND', 'Tax not found', { taxId });
      const row = await tx.tax.update({ where: { id: taxId }, data: changes });
      await this.audit.record(
        {
          action:
            changes.rateBps !== undefined && changes.rateBps !== before.rateBps
              ? 'tax.rate_changed'
              : 'tax.updated',
          entityType: 'Tax',
          entityId: taxId,
          metadata: { changes, before: { rateBps: before.rateBps } },
        },
        tx,
      );
      return toTaxDto(row);
    });
  }

  async setTaxArchived(restaurantId: string, taxId: string, archived: boolean): Promise<Tax> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.tax.count({ where: { id: taxId, restaurantId } });
      if (found !== 1) throw new DomainError('TAX_NOT_FOUND', 'Tax not found', { taxId });
      const row = await tx.tax.update({
        where: { id: taxId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        { action: archived ? 'tax.archived' : 'tax.restored', entityType: 'Tax', entityId: taxId },
        tx,
      );
      return toTaxDto(row);
    });
  }

  async listDiscounts(restaurantId: string, includeArchived: boolean): Promise<Discount[]> {
    const rows = await this.prisma.discount.findMany({
      where: { restaurantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map(toDiscountDto);
  }

  async createDiscount(
    restaurantId: string,
    input: z.output<typeof createDiscountSchema>,
  ): Promise<Discount> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.discount.create({ data: { ...input, restaurantId } });
      await this.audit.record(
        {
          action: 'discount.created',
          entityType: 'Discount',
          entityId: row.id,
          metadata: { discount: input },
        },
        tx,
      );
      return toDiscountDto(row);
    });
  }

  async updateDiscount(
    restaurantId: string,
    discountId: string,
    changes: z.output<typeof updateDiscountSchema>,
  ): Promise<Discount> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.discount.findFirst({ where: { id: discountId, restaurantId } });
      if (!before)
        throw new DomainError('DISCOUNT_NOT_FOUND', 'Discount not found', { discountId });
      const row = await tx.discount.update({ where: { id: discountId }, data: changes });
      await this.audit.record(
        {
          action: 'discount.updated',
          entityType: 'Discount',
          entityId: discountId,
          metadata: { changes, before: { type: before.type, value: before.value } },
        },
        tx,
      );
      return toDiscountDto(row);
    });
  }

  async setDiscountArchived(
    restaurantId: string,
    discountId: string,
    archived: boolean,
  ): Promise<Discount> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.discount.count({ where: { id: discountId, restaurantId } });
      if (found !== 1)
        throw new DomainError('DISCOUNT_NOT_FOUND', 'Discount not found', { discountId });
      const row = await tx.discount.update({
        where: { id: discountId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'discount.archived' : 'discount.restored',
          entityType: 'Discount',
          entityId: discountId,
        },
        tx,
      );
      return toDiscountDto(row);
    });
  }
}
