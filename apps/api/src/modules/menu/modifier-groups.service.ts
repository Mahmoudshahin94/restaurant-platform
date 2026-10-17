import { Injectable } from '@nestjs/common';
import { DomainError, isValidSelectionRange } from '@pos/domain';
import type {
  ModifierGroup,
  createModifierGroupSchema,
  updateModifierGroupSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type ModifierGroupWithModifiers, toModifierGroupDto } from './menu.mappers';

type CreateInput = z.output<typeof createModifierGroupSchema>;
type UpdateInput = z.output<typeof updateModifierGroupSchema>;

@Injectable()
export class ModifierGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(restaurantId: string, includeArchived: boolean): Promise<ModifierGroup[]> {
    const rows = await this.prisma.modifierGroup.findMany({
      where: { restaurantId, ...(includeArchived ? {} : { archivedAt: null }) },
      include: { modifiers: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(toModifierGroupDto);
  }

  async get(restaurantId: string, groupId: string): Promise<ModifierGroup> {
    return toModifierGroupDto(await this.load(this.prisma, restaurantId, groupId));
  }

  async create(restaurantId: string, input: CreateInput): Promise<ModifierGroup> {
    return this.prisma.$transaction(async (tx) => {
      const { modifiers, ...group } = input;
      const row = await tx.modifierGroup.create({
        data: { ...group, restaurantId, modifiers: { create: modifiers } },
        include: { modifiers: true },
      });
      await this.audit.record(
        {
          action: 'modifier_group.created',
          entityType: 'ModifierGroup',
          entityId: row.id,
          metadata: { group: input },
        },
        tx,
      );
      return toModifierGroupDto(row);
    });
  }

  async update(restaurantId: string, groupId: string, input: UpdateInput): Promise<ModifierGroup> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, restaurantId, groupId);
      const { modifiers, ...fields } = input;
      const priceChanges: Record<string, unknown>[] = [];

      if (modifiers) {
        const existing = new Map(current.modifiers.map((m) => [m.id, m]));
        const keep = new Set<string>();
        for (const m of modifiers) {
          const data = {
            nameEn: m.nameEn,
            nameAr: m.nameAr,
            priceDelta: m.priceDelta,
            isDefault: m.isDefault,
            sortOrder: m.sortOrder,
          };
          if (m.id) {
            const before = existing.get(m.id);
            if (!before)
              throw new DomainError('MODIFIER_NOT_FOUND', 'Modifier not in group', {
                modifierId: m.id,
              });
            keep.add(m.id);
            await tx.modifier.update({ where: { id: m.id }, data: { ...data, archivedAt: null } });
            if (before.priceDelta !== m.priceDelta) {
              priceChanges.push({ modifierId: m.id, from: before.priceDelta, to: m.priceDelta });
            }
          } else {
            await tx.modifier.create({ data: { ...data, modifierGroupId: groupId } });
          }
        }
        const toArchive = current.modifiers.filter((m) => m.archivedAt === null && !keep.has(m.id));
        if (toArchive.length > 0) {
          await tx.modifier.updateMany({
            where: { id: { in: toArchive.map((m) => m.id) } },
            data: { archivedAt: new Date() },
          });
        }
      }

      if (Object.keys(fields).length > 0) {
        await tx.modifierGroup.update({ where: { id: groupId }, data: fields });
      }

      const after = await this.load(tx, restaurantId, groupId);
      const liveCount = after.modifiers.filter((m) => m.archivedAt === null).length;
      if (!isValidSelectionRange(after.minSelect, after.maxSelect) || after.minSelect > liveCount) {
        throw new DomainError('VALIDATION_FAILED', 'Invalid selection range for modifier group', {
          minSelect: after.minSelect,
          maxSelect: after.maxSelect,
          modifiers: liveCount,
        });
      }

      await this.audit.record(
        {
          action: 'modifier_group.updated',
          entityType: 'ModifierGroup',
          entityId: groupId,
          metadata: { changes: input },
        },
        tx,
      );
      for (const change of priceChanges) {
        await this.audit.record(
          {
            action: 'modifier.price_changed',
            entityType: 'Modifier',
            entityId: String(change.modifierId),
            metadata: change,
          },
          tx,
        );
      }
      return toModifierGroupDto(after);
    });
  }

  async setArchived(
    restaurantId: string,
    groupId: string,
    archived: boolean,
  ): Promise<ModifierGroup> {
    return this.prisma.$transaction(async (tx) => {
      await this.load(tx, restaurantId, groupId);
      await tx.modifierGroup.update({
        where: { id: groupId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'modifier_group.archived' : 'modifier_group.restored',
          entityType: 'ModifierGroup',
          entityId: groupId,
        },
        tx,
      );
      return toModifierGroupDto(await this.load(tx, restaurantId, groupId));
    });
  }

  private async load(
    tx: PrismaTx,
    restaurantId: string,
    groupId: string,
  ): Promise<ModifierGroupWithModifiers> {
    const row = await tx.modifierGroup.findFirst({
      where: { id: groupId, restaurantId },
      include: { modifiers: true },
    });
    if (!row)
      throw new DomainError('MODIFIER_GROUP_NOT_FOUND', 'Modifier group not found', {
        modifierGroupId: groupId,
      });
    return row;
  }
}
