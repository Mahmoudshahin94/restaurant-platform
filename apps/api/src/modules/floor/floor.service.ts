import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { OPEN_ORDER_STATUSES } from '@pos/shared-types';
import type {
  TableSection,
  createTableSchema,
  createTableSectionSchema,
  updateTableSchema,
  updateTableSectionSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Sections and tables of one location, with live occupancy from open orders. */
@Injectable()
export class FloorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getFloor(locationId: string, includeArchived = false): Promise<TableSection[]> {
    const live = includeArchived ? {} : { archivedAt: null };
    const sections = await this.prisma.tableSection.findMany({
      where: { locationId, ...live },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        tables: {
          where: live,
          orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
          include: {
            orders: {
              where: { status: { in: [...OPEN_ORDER_STATUSES] } },
              select: { id: true, orderNumber: true, status: true, total: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });
    return sections.map((s) => ({
      id: s.id,
      locationId: s.locationId,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      sortOrder: s.sortOrder,
      archivedAt: s.archivedAt?.toISOString() ?? null,
      tables: s.tables.map((t) => ({
        id: t.id,
        sectionId: t.sectionId,
        label: t.label,
        seats: t.seats,
        sortOrder: t.sortOrder,
        archivedAt: t.archivedAt?.toISOString() ?? null,
        openOrders: t.orders,
      })),
    }));
  }

  async createSection(
    locationId: string,
    input: z.output<typeof createTableSectionSchema>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.tableSection.create({ data: { ...input, locationId } });
      await this.audit.record(
        {
          action: 'table_section.created',
          entityType: 'TableSection',
          entityId: row.id,
          locationId,
          metadata: { section: input },
        },
        tx,
      );
    });
  }

  async updateSection(
    locationId: string,
    sectionId: string,
    changes: z.output<typeof updateTableSectionSchema>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireSection(tx, locationId, sectionId);
      await tx.tableSection.update({ where: { id: sectionId }, data: changes });
      await this.audit.record(
        {
          action: 'table_section.updated',
          entityType: 'TableSection',
          entityId: sectionId,
          locationId,
          metadata: { changes },
        },
        tx,
      );
    });
  }

  async setSectionArchived(
    locationId: string,
    sectionId: string,
    archived: boolean,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireSection(tx, locationId, sectionId);
      await tx.tableSection.update({
        where: { id: sectionId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'table_section.archived' : 'table_section.restored',
          entityType: 'TableSection',
          entityId: sectionId,
          locationId,
        },
        tx,
      );
    });
  }

  async createTable(locationId: string, input: z.output<typeof createTableSchema>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireSection(tx, locationId, input.sectionId);
      const row = await tx.diningTable.create({ data: { ...input, locationId } });
      await this.audit.record(
        {
          action: 'table.created',
          entityType: 'Table',
          entityId: row.id,
          locationId,
          metadata: { table: input },
        },
        tx,
      );
    });
  }

  async updateTable(
    locationId: string,
    tableId: string,
    changes: z.output<typeof updateTableSchema>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireTable(tx, locationId, tableId);
      if (changes.sectionId) await this.requireSection(tx, locationId, changes.sectionId);
      await tx.diningTable.update({ where: { id: tableId }, data: changes });
      await this.audit.record(
        {
          action: 'table.updated',
          entityType: 'Table',
          entityId: tableId,
          locationId,
          metadata: { changes },
        },
        tx,
      );
    });
  }

  async setTableArchived(locationId: string, tableId: string, archived: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireTable(tx, locationId, tableId);
      await tx.diningTable.update({
        where: { id: tableId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'table.archived' : 'table.restored',
          entityType: 'Table',
          entityId: tableId,
          locationId,
        },
        tx,
      );
    });
  }

  private async requireSection(tx: PrismaTx, locationId: string, sectionId: string): Promise<void> {
    const found = await tx.tableSection.count({
      where: { id: sectionId, locationId, archivedAt: null },
    });
    if (found !== 1) throw new DomainError('NOT_FOUND', 'Table section not found', { sectionId });
  }

  private async requireTable(tx: PrismaTx, locationId: string, tableId: string): Promise<void> {
    const found = await tx.diningTable.count({ where: { id: tableId, locationId } });
    if (found !== 1) throw new DomainError('TABLE_NOT_FOUND', 'Table not found', { tableId });
  }
}
