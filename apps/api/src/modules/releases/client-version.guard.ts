import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { assertVersionSupported } from '@pos/domain';
import { reportedVersion } from '@pos/server';
import type { FastifyRequest } from 'fastify';
import { ReleasePolicyService } from './release-policy.service';

/**
 * Refuses an app older than the cloud serves (ADR 0026) with `426 CLIENT_UPGRADE_REQUIRED`, before
 * anything else answers: the admin, the website and anything else that reports its version in
 * `x-madar-client-version`. Not checked here: hubs (their device credential; `DeviceGuard` holds
 * them to the hub minimum) and the platform's own routes, so an operator can always reach the
 * releases page to correct a minimum.
 */
@Injectable()
export class ClientVersionGuard implements CanActivate {
  constructor(private readonly policy: ReleasePolicyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const path = Reflect.getMetadata(PATH_METADATA, context.getClass()) as string | undefined;
    if (path === 'platform' || path?.startsWith('platform/')) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.headers.authorization?.startsWith('Device ')) return true;
    const version = reportedVersion(request.headers);
    if (version === null) return true;
    assertVersionSupported('CLIENT', version, (await this.policy.minimums()).client);
    return true;
  }
}
