import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@pos/domain';
import type { TerminalDeviceType } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { AccessService } from '../../modules/auth/access.service';
import { TerminalAuthService } from '../../modules/auth/terminal-auth.service';
import { TokenService } from '../../modules/auth/token.service';
import { IS_PUBLIC_KEY } from './decorators';
import { DEVICE_ROUTE_KEY } from './device-route';
import { HOST_ROUTE_KEY } from './host-route';

/**
 * Global guard: every route requires a valid access token unless marked @Public() or
 * @HostRoute() (the tenant website, whose tenant comes from the host name). A device
 * route (`@DeviceRoute`, ADR 0022) requires the device credential of a terminal of its types
 * instead, and refuses staff tokens; every other route refuses device credentials, since they
 * carry no bearer token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly terminals: TerminalAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;
    // The website: no account; HostTenantGuard finds the tenant from the host name (ADR 0023).
    if (this.reflector.getAllAndOverride<boolean | undefined>(HOST_ROUTE_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const deviceTypes = this.reflector.getAllAndOverride<TerminalDeviceType[] | undefined>(
      DEVICE_ROUTE_KEY,
      targets,
    );
    if (deviceTypes) {
      const version = request.headers['x-madar-client-version'];
      request.terminal = await this.terminals.authenticate(
        header,
        deviceTypes,
        typeof version === 'string' ? version : undefined,
      );
      return true;
    }
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError('UNAUTHENTICATED', 'Missing bearer token');
    }
    const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    request.principal = await this.access.loadPrincipal(claims.userId, claims.tenantId);
    return true;
  }
}
