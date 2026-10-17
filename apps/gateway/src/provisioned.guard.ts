import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { FastifyRequest } from 'fastify';
import { HubStateService } from './hub-state.service';

/**
 * Until the hub has its first snapshot it has no staff, menu or tables: every API call except the
 * hub's own status answers HUB_NOT_PROVISIONED (503) instead of confusing "wrong password" errors.
 */
@Injectable()
export class ProvisionedGuard implements CanActivate {
  constructor(private readonly state: HubStateService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { url } = context.switchToHttp().getRequest<FastifyRequest>();
    if (!url.startsWith('/api/') || url.startsWith('/api/v1/hub/')) return true;
    if (await this.state.get('snapshot')) return true;
    throw new DomainError('HUB_NOT_PROVISIONED', 'This hub has not been set up yet');
  }
}
