import { Inject, Injectable } from '@nestjs/common';
import type { Device as DeviceRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import { APP_CONFIG, type AppConfig, AuditService, PrismaService } from '@pos/server';
import {
  type AdminDevice,
  type Device,
  type PairDeviceRequest,
  type PairedDevice,
  reportedOutboxSchema,
} from '@pos/validation';
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

/**
 * A device for the admin portal: whether it was heard from within the heartbeat window, and the
 * outbox size its last push reported (kept in `metadata.outbox`; non-secret).
 */
export function toAdminDevice(row: DeviceRow, staleAfterMs: number, now = new Date()): AdminDevice {
  const metadata =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const outbox = reportedOutboxSchema.safeParse(metadata.outbox);
  return {
    ...toDto(row),
    online:
      row.status === 'ACTIVE' &&
      row.lastSeenAt !== null &&
      now.getTime() - row.lastSeenAt.getTime() <= staleAfterMs,
    outbox: outbox.success ? outbox.data : null,
  };
}

/** Registers location hubs and issues their credentials (shown once). */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get staleAfterMs(): number {
    return this.config.HUB_HEARTBEAT_STALE_SECONDS * 1000;
  }

  async list(locationId: string): Promise<AdminDevice[]> {
    const rows = await this.prisma.device.findMany({
      where: { locationId },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return rows.map((row) => toAdminDevice(row, this.staleAfterMs, now));
  }

  async pair(locationId: string, input: Required<PairDeviceRequest>): Promise<PairedDevice> {
    const location = await this.prisma.location.findUniqueOrThrow({ where: { id: locationId } });
    const secret = newDeviceSecret();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: {
          tenantId: location.tenantId,
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
      if (!found) throw new DomainError('DEVICE_NOT_FOUND', 'Device not found', { deviceId });
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
          metadata: { name: found.name, type: found.type },
        },
        tx,
      );
      return toDto(row);
    });
  }
}
