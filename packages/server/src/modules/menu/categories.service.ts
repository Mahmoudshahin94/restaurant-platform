import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { Category, UpdateCategoryRequest, createCategorySchema } from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toCategoryDto } from './menu.mappers';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeArchived: boolean): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({
      where: { tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(toCategoryDto);
  }

  async create(tenantId: string, input: z.output<typeof createCategorySchema>): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.category.create({ data: { ...input, tenantId } });
      await this.audit.record(
        {
          action: 'category.created',
          entityType: 'Category',
          entityId: row.id,
          metadata: { category: input },
        },
        tx,
      );
      return toCategoryDto(row);
    });
  }

  async update(
    tenantId: string,
    categoryId: string,
    changes: UpdateCategoryRequest,
  ): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      await this.require(tx, tenantId, categoryId);
      const row = await tx.category.update({ where: { id: categoryId }, data: changes });
      await this.audit.record(
        {
          action: 'category.updated',
          entityType: 'Category',
          entityId: categoryId,
          metadata: { changes },
        },
        tx,
      );
      return toCategoryDto(row);
    });
  }

  /** Archiving hides the category (and therefore its products) from published menus. */
  async setArchived(tenantId: string, categoryId: string, archived: boolean): Promise<Category> {
    return this.prisma.$transaction(async (tx) => {
      await this.require(tx, tenantId, categoryId);
      const row = await tx.category.update({
        where: { id: categoryId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'category.archived' : 'category.restored',
          entityType: 'Category',
          entityId: categoryId,
        },
        tx,
      );
      return toCategoryDto(row);
    });
  }

  private async require(
    tx: Pick<PrismaService, 'category'>,
    tenantId: string,
    categoryId: string,
  ): Promise<void> {
    const found = await tx.category.count({ where: { id: categoryId, tenantId } });
    if (found !== 1)
      throw new DomainError('CATEGORY_NOT_FOUND', 'Category not found', { categoryId });
  }
}
