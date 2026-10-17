import { Injectable } from '@nestjs/common';
import type { Device as DeviceRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import { AuditService, PrismaService } from '@pos/server';
import type { Device, PairDeviceRequest, PairedDevice } from '@pos/validation';
import { hashDeviceSecret, newDeviceSecret } from './device-credentials';

const toDto = (row: DeviceRow): Device => ({
  id: row.id,
  locationId: row.locationId,
  name: row.name,
  type: row.type,
  status: row.status,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/** Registers location hubs and issues their credentials (shown once). */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(locationId: string): Promise<Device[]> {
    const rows = await this.prisma.device.findMany({
      where: { locationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDto);
  }

  async pair(locationId: string, input: Required<PairDeviceRequest>): Promise<PairedDevice> {
    const location = await this.prisma.location.findUniqueOrThrow({ where: { id: locationId } });
    const secret = newDeviceSecret();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: {
          restaurantId: location.restaurantId,
          locationId,
          name: input.name,
          type: input.type,
          status: 'ACTIVE',
          credentialHash: hashDeviceSecret(secret),
        },
      });
      await this.audit.record(
        {
          action: 'device.paired',
          entityType: 'Device',
          entityId: row.id,
          locationId,
          metadata: { name: input.name, type: input.type },
        },
        tx,
      );
      return { device: toDto(row), credential: `${row.id}.${secret}` };
    });
  }

  /** Revokes a device's credential immediately (lost or replaced hub). */
  async disable(locationId: string, deviceId: string): Promise<Device> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.device.findFirst({ where: { id: deviceId, locationId } });
      if (!found) throw new DomainError('NOT_FOUND', 'Device not found', { deviceId });
      const row = await tx.device.update({
        where: { id: deviceId },
        data: { status: 'DISABLED', credentialHash: null },
      });
      await this.audit.record(
        {
          action: 'device.disabled',
          entityType: 'Device',
          entityId: deviceId,
          locationId,
          metadata: {},
        },
        tx,
      );
      return toDto(row);
    });
  }
}
