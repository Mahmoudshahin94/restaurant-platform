import { Injectable } from '@nestjs/common';
import type { Device } from '@pos/database';
import { DomainError } from '@pos/domain';
import { isTerminalDeviceType } from '@pos/shared-types';
import type { PairedTerminal, Terminal } from '@pos/validation';
import {
  hashDeviceSecret,
  hashPairingCode,
  newDeviceSecret,
} from '../../common/auth/device-credentials';
import { ChangeRecorder } from '../../prisma/change-recorder';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export function toTerminalDto(row: Device): Terminal {
  if (!isTerminalDeviceType(row.type)) throw new Error(`Device ${row.id} is not a terminal`);
  return {
    id: row.id,
    tenantId: row.tenantId,
    locationId: row.locationId,
    name: row.name,
    type: row.type,
  };
}

/**
 * Pairs terminals with the location hub (ADR 0022). The admin created the terminal in the cloud,
 * with a one-time pairing code; its hash and expiry came with the snapshot, so pairing works
 * without the cloud. The hub issues the terminal's credential and keeps only its hash, and tells
 * the cloud through the outbox (`DEVICE_UPSERT`) that the terminal is paired.
 */
@Injectable()
export class TerminalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly changes: ChangeRecorder,
  ) {}

  /**
   * `code` is normalized (`pairTerminalSchema`). Any failure looks the same: unknown code. The
   * terminal's version, when it reports one, is recorded from the start (ADR 0026).
   */
  async pair(code: string, version: string | null = null): Promise<PairedTerminal> {
    const now = new Date();
    const secret = newDeviceSecret();
    return this.prisma.$transaction(async (tx) => {
      // The hub's database holds its own location's devices only (the snapshot).
      const device = await tx.device.findFirst({
        where: { pairingCodeHash: hashPairingCode(code) },
      });
      if (
        !device ||
        device.status !== 'PENDING' ||
        !isTerminalDeviceType(device.type) ||
        !device.pairingExpiresAt ||
        device.pairingExpiresAt <= now
      ) {
        throw new DomainError('PAIRING_CODE_INVALID', 'Unknown or expired pairing code');
      }
      const paired = await tx.device.update({
        where: { id: device.id },
        data: {
          status: 'ACTIVE',
          credentialHash: hashDeviceSecret(secret),
          pairingCodeHash: null,
          pairingExpiresAt: null,
          pairedAt: now,
          lastSeenAt: now,
          ...(version ? { appVersion: version, lastVersionAt: now } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'device.paired',
          entityType: 'Device',
          entityId: device.id,
          actorType: 'DEVICE',
          actorId: device.id,
          tenantId: device.tenantId,
          locationId: device.locationId,
          metadata: { name: device.name, type: device.type, appVersion: version },
        },
        tx,
      );
      await this.changes.record(tx, { deviceIds: [device.id] });
      return { device: toTerminalDto(paired), credential: `${device.id}.${secret}` };
    });
  }
}
