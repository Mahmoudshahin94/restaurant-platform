import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type {
  KitchenStation,
  UpdateKitchenStationRequest,
  createKitchenStationSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toKitchenStationDto } from './menu.mappers';

@Injectable()
export class KitchenStationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(restaurantId: string, includeArchived: boolean): Promise<KitchenStation[]> {
    const rows = await this.prisma.kitchenStation.findMany({
      where: { restaurantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toKitchenStationDto);
  }

  async create(
    restaurantId: string,
    input: z.output<typeof createKitchenStationSchema>,
  ): Promise<KitchenStation> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.kitchenStation.create({ data: { ...input, restaurantId } });
      await this.audit.record(
        {
          action: 'kitchen_station.created',
          entityType: 'KitchenStation',
          entityId: row.id,
          metadata: { station: input },
        },
        tx,
      );
      return toKitchenStationDto(row);
    });
  }

  async update(
    restaurantId: string,
    stationId: string,
    changes: UpdateKitchenStationRequest,
  ): Promise<KitchenStation> {
    return this.prisma.$transaction(async (tx) => {
      await this.require(tx, restaurantId, stationId);
      const row = await tx.kitchenStation.update({ where: { id: stationId }, data: changes });
      await this.audit.record(
        {
          action: 'kitchen_station.updated',
          entityType: 'KitchenStation',
          entityId: stationId,
          metadata: { changes },
        },
        tx,
      );
      return toKitchenStationDto(row);
    });
  }

  /** Archived stations stop receiving tickets; products keep the link for history. */
  async setArchived(
    restaurantId: string,
    stationId: string,
    archived: boolean,
  ): Promise<KitchenStation> {
    return this.prisma.$transaction(async (tx) => {
      await this.require(tx, restaurantId, stationId);
      const row = await tx.kitchenStation.update({
        where: { id: stationId },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audit.record(
        {
          action: archived ? 'kitchen_station.archived' : 'kitchen_station.restored',
          entityType: 'KitchenStation',
          entityId: stationId,
        },
        tx,
      );
      return toKitchenStationDto(row);
    });
  }

  private async require(
    tx: Pick<PrismaService, 'kitchenStation'>,
    restaurantId: string,
    stationId: string,
  ): Promise<void> {
    const found = await tx.kitchenStation.count({ where: { id: stationId, restaurantId } });
    if (found !== 1)
      throw new DomainError('KITCHEN_STATION_NOT_FOUND', 'Kitchen station not found', {
        stationId,
      });
  }
}
