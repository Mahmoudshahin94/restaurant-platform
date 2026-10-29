import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import {
  DomainError,
  accessKindOf,
  assertTenantAccess,
  assertVersionSupported,
  isUuid,
} from '@pos/domain';
import {
  PrismaService,
  TenantContext,
  parseDeviceCredential,
  reportedVersion,
  secretMatches,
} from '@pos/server';
import type { FastifyRequest } from 'fastify';
import { ReleasePolicyService } from '../releases/release-policy.service';

export interface AuthenticatedDevice {
  id: string;
  tenantId: string;
  locationId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: AuthenticatedDevice;
  }
}

/** Only refresh `lastSeenAt` this often, so polling hubs do not write on every request. */
const SEEN_WRITE_INTERVAL_MS = 60_000;

/**
 * Authenticates a location hub by its device credential (`Authorization: Device <id>.<secret>`).
 * Used on `@Public()` routes, which skip staff authentication; the hub is never a staff user.
 * A suspended tenant's hubs are refused (`TENANT_SUSPENDED`), an archived tenant's may only read
 * (ADR 0025); they are still marked as seen, so the platform's health board shows them online.
 * The hub's MADAR version (`x-madar-client-version`) is recorded on its device row, and a hub
 * older than the cloud serves is refused with `426 HUB_UPGRADE_REQUIRED` (ADR 0026): a cloud whose
 * snapshot has columns the hub does not know never sends it one.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly releases: ReleasePolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const credential = parseDeviceCredential(request.headers.authorization);
    const reject = () => new DomainError('UNAUTHENTICATED', 'Invalid device credential');
    if (!credential || !isUuid(credential.deviceId)) throw reject();

    // The credential names the device, and the device its tenant: nothing is scoped yet.
    const device = await TenantContext.runUnscoped('device sign-in: find the device', () =>
      this.prisma.device.findUnique({
        where: { id: credential.deviceId },
        include: { tenant: { select: { status: true } } },
      }),
    );
    if (
      device?.type !== 'GATEWAY' ||
      device.status !== 'ACTIVE' ||
      !device.credentialHash ||
      !secretMatches(credential.secret, device.credentialHash)
    ) {
      throw reject();
    }
    const version = reportedVersion(request.headers);
    const versionChanged = version !== null && version !== device.appVersion;
    const now = new Date();
    if (
      versionChanged ||
      !device.lastSeenAt ||
      now.getTime() - device.lastSeenAt.getTime() > SEEN_WRITE_INTERVAL_MS
    ) {
      await TenantContext.runInTenant(device.tenantId, () =>
        this.prisma.device.update({
          where: { id: device.id },
          data: {
            lastSeenAt: now,
            ...(versionChanged ? { appVersion: version, lastVersionAt: now } : {}),
          },
        }),
      );
    }
    assertTenantAccess(device.tenant.status, accessKindOf(request.method));
    assertVersionSupported('HUB', version, (await this.releases.minimums()).hub);
    request.device = {
      id: device.id,
      tenantId: device.tenantId,
      locationId: device.locationId,
    };
    return true;
  }
}
