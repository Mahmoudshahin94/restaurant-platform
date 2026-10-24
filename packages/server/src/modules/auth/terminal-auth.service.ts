import { Injectable } from '@nestjs/common';
import type { Device } from '@pos/database';
import { DomainError, isUuid } from '@pos/domain';
import { type TerminalDeviceType, isTerminalDeviceType } from '@pos/shared-types';
import { parseDeviceCredential, secretMatches } from '../../common/auth/device-credentials';
import type { AuthenticatedTerminal } from '../../common/auth/device-route';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { ChangeRecorder } from '../../prisma/change-recorder';
import { PrismaService } from '../../prisma/prisma.service';

/** Only refresh `lastSeenAt` this often, so a polling kiosk does not write on every request. */
const SEEN_WRITE_INTERVAL_MS = 60_000;
/** Tell the cloud (outbox) at most this often that a terminal is alive; a new version at once. */
const SEEN_REPORT_INTERVAL_MS = 5 * 60_000;
/** What `x-madar-client-version` may carry (e.g. `1.0.0`, `1.2.0-beta.1+42`). */
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;

/**
 * Authenticates terminals paired with this hub (ADR 0022) by their device credential, and keeps
 * what they report: the last contact and the app version (`x-madar-client-version`). The cloud
 * hears of both through the outbox (`DEVICE_UPSERT`), throttled. A credential is valid only for an
 * ACTIVE terminal whose hub issued it; the cloud's disabling reaches the hub with the snapshot.
 */
@Injectable()
export class TerminalAuthService {
  private readonly reportedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeRecorder,
  ) {}

  async authenticate(
    header: string | undefined,
    types: readonly TerminalDeviceType[],
    version?: string,
  ): Promise<AuthenticatedTerminal> {
    const credential = parseDeviceCredential(header);
    const reject = () => new DomainError('UNAUTHENTICATED', 'Invalid device credential');
    if (!credential || !isUuid(credential.deviceId)) throw reject();
    // The credential names the device, and the device its tenant: nothing is scoped yet.
    const device = await TenantContext.runUnscoped('terminal sign-in: find the device', () =>
      this.prisma.device.findUnique({ where: { id: credential.deviceId } }),
    );
    if (
      !device ||
      !isTerminalDeviceType(device.type) ||
      device.status !== 'ACTIVE' ||
      !device.credentialHash ||
      !secretMatches(credential.secret, device.credentialHash)
    ) {
      throw reject();
    }
    if (!types.includes(device.type)) {
      throw new DomainError('INSUFFICIENT_PERMISSION', 'Not a route for this kind of device', {
        deviceType: device.type,
      });
    }
    await this.touch(device, version !== undefined && VERSION.test(version) ? version : null);
    return {
      id: device.id,
      tenantId: device.tenantId,
      locationId: device.locationId,
      type: device.type,
      name: device.name,
    };
  }

  private async touch(device: Device, version: string | null): Promise<void> {
    const now = Date.now();
    const appVersion = version ?? device.appVersion;
    const versionChanged = appVersion !== device.appVersion;
    const stale = !device.lastSeenAt || now - device.lastSeenAt.getTime() > SEEN_WRITE_INTERVAL_MS;
    if (!stale && !versionChanged) return;
    const report =
      versionChanged || now - (this.reportedAt.get(device.id) ?? 0) > SEEN_REPORT_INTERVAL_MS;
    await TenantContext.runInTenant(device.tenantId, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.device.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date(now), appVersion },
        });
        if (report) await this.changes.record(tx, { deviceIds: [device.id] });
      }),
    );
    if (report) this.reportedAt.set(device.id, now);
  }
}
