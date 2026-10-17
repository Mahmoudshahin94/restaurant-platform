import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@pos/domain';
import type { FastifyRequest } from 'fastify';

export const SERVER_MODE = Symbol('SERVER_MODE');
/** `cloud`: the multi-tenant API. `hub`: a location hub serving POS/KDS on the restaurant LAN. */
export type ServerMode = 'cloud' | 'hub';

const MANAGED_IN_CLOUD_KEY = 'server:managedInCloud';

/**
 * Marks a controller whose data the cloud owns (menu, prices, floor plan, locations). On a
 * location hub its reads work against the local mirror, but every write is refused: changes are
 * made in the cloud admin portal and reach the hub through sync.
 */
export const ManagedInCloud = () => SetMetadata(MANAGED_IN_CLOUD_KEY, true);

@Injectable()
export class ManagedInCloudGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.mode !== 'hub') return true;
    const managed = this.reflector.getAllAndOverride<boolean | undefined>(MANAGED_IN_CLOUD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const { method } = context.switchToHttp().getRequest<FastifyRequest>();
    if (managed && method !== 'GET' && method !== 'HEAD') {
      throw new DomainError('MANAGED_IN_CLOUD', 'This is managed in the cloud admin portal');
    }
    return true;
  }
}
