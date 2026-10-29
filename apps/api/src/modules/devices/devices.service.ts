import { Inject, Injectable } from '@nestjs/common';
import type { Device as DeviceRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import {
  APP_CONFIG,
  type AppConfig,
  AuditService,
  PAIRING_CODE_TTL_MS,
  PrismaService,
  formatPairingCode,
  hashDeviceSecret,
  hashPairingCode,
  newDeviceSecret,
  newPairingCode,
} from '@pos/server';
import { isTerminalDeviceType } from '@pos/shared-types';
import {
  type AdminDevice,
  type Device,
  type PairDeviceRequest,
  type PairedDevice,
  type PairingCode,
  reportedOutboxSchema,
} from '@pos/validation';

const toDto = (row: DeviceRow): Device => ({
  id: row.id,
  locationId: row.locationId,
  name: row.name,
  type: row.type,
  status: row.status,
  pairedAt: row.pairedAt?.toISOString() ?? null,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  appVersion: row.appVersion,
  lastVersionAt: row.lastVersionAt?.toISOString() ?? null,
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
    pairingExpiresAt: row.pairingExpiresAt?.toISOString() ?? null,
    online:
      row.status === 'ACTIVE' &&
      row.lastSeenAt !== null &&
      now.getTime() - row.lastSeenAt.getTime() <= staleAfterMs,
    outbox: outbox.success ? outbox.data : null,
  };
}

/**
 * Registers a location's devices. A hub gets its credential here (shown once). A terminal (POS,
 * KDS, kiosk, customer display; ADR 0022) gets a one-time pairing code instead: its hub, which
 * receives the code's hash with the snapshot, issues the terminal's credential when the code is
 * typed on it, even offline, and reports the pairing back.
 */
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
    const terminal = isTerminalDeviceType(input.type);
    const secret = newDeviceSecret();
    const code = newPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: {
          tenantId: location.tenantId,
          locationId,
          name: input.name,
          type: input.type,
          ...(terminal
            ? {
                status: 'PENDING',
                pairingCodeHash: hashPairingCode(code),
                pairingExpiresAt: expiresAt,
              }
            : { status: 'ACTIVE', credentialHash: hashDeviceSecret(secret) }),
        },
      });
      await this.audit.record(
        {
          action: terminal ? 'device.created' : 'device.paired',
          entityType: 'Device',
          entityId: row.id,
          locationId,
          metadata: { name: input.name, type: input.type },
        },
        tx,
      );
      return terminal
        ? { device: toDto(row), credential: null, pairing: this.pairingOf(code, expiresAt) }
        : { device: toDto(row), credential: `${row.id}.${secret}`, pairing: null };
    });
  }

  /**
   * A new pairing code for a terminal still waiting to pair (the first one expired or was lost);
   * the previous code stops working with the next snapshot of the hub.
   */
  async renewPairingCode(locationId: string, deviceId: string): Promise<PairingCode> {
    const code = newPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.device.findFirst({ where: { id: deviceId, locationId } });
      if (!found) throw new DomainError('DEVICE_NOT_FOUND', 'Device not found', { deviceId });
      if (found.status !== 'PENDING' || !isTerminalDeviceType(found.type)) {
        throw new DomainError('CONFLICT', 'Only a terminal waiting to pair gets a code', {
          reason: 'NOT_PENDING',
          status: found.status,
        });
      }
      await tx.device.update({
        where: { id: deviceId },
        data: { pairingCodeHash: hashPairingCode(code), pairingExpiresAt: expiresAt },
      });
      await this.audit.record(
        {
          action: 'device.pairing_code_renewed',
          entityType: 'Device',
          entityId: deviceId,
          locationId,
          metadata: { name: found.name, type: found.type },
        },
        tx,
      );
      return this.pairingOf(code, expiresAt);
    });
  }

  /** Revokes a device's credential immediately (lost or replaced hub or terminal). */
  async disable(locationId: string, deviceId: string): Promise<Device> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.device.findFirst({ where: { id: deviceId, locationId } });
      if (!found) throw new DomainError('DEVICE_NOT_FOUND', 'Device not found', { deviceId });
      const row = await tx.device.update({
        where: { id: deviceId },
        data: {
          status: 'DISABLED',
          credentialHash: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
        },
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

  private pairingOf(code: string, expiresAt: Date): PairingCode {
    return { code: formatPairingCode(code), expiresAt: expiresAt.toISOString() };
  }
}
