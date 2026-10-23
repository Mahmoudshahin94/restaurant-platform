import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError, isUuid } from '@pos/domain';
import { PrismaService } from '@pos/server';
import type { FastifyRequest } from 'fastify';
import { parseDeviceCredential, secretMatches } from './device-credentials';

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
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const credential = parseDeviceCredential(request.headers.authorization);
    const reject = () => new DomainError('UNAUTHENTICATED', 'Invalid device credential');
    if (!credential || !isUuid(credential.deviceId)) throw reject();

    const device = await this.prisma.device.findUnique({ where: { id: credential.deviceId } });
    if (
      device?.type !== 'GATEWAY' ||
      device.status !== 'ACTIVE' ||
      !device.credentialHash ||
      !secretMatches(credential.secret, device.credentialHash)
    ) {
      throw reject();
    }
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > SEEN_WRITE_INTERVAL_MS) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    }
    request.device = {
      id: device.id,
      tenantId: device.tenantId,
      locationId: device.locationId,
    };
    return true;
  }
}
