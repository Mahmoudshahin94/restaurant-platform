import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, accessKindOf, assertTenantAccess } from '@pos/domain';
import type { TerminalDeviceType } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { AccessService } from '../../modules/auth/access.service';
import { TerminalAuthService } from '../../modules/auth/terminal-auth.service';
import { TokenService } from '../../modules/auth/token.service';
import { reportedVersion } from './client-version';
import { IS_PUBLIC_KEY, SESSION_ROUTE_KEY } from './decorators';
import { DEVICE_ROUTE_KEY } from './device-route';
import { HOST_ROUTE_KEY } from './host-route';
import { PLATFORM_PERMISSIONS_KEY } from './platform-route';

/**
 * Global guard: every route requires a valid access token unless marked @Public() or
 * @HostRoute() (the tenant website, whose tenant comes from the host name). A device
 * route (`@DeviceRoute`, ADR 0022) requires the device credential of a terminal of its types
 * instead, and refuses staff tokens; every other route refuses device credentials, since they
 * carry no bearer token. A platform route (`@RequirePlatformPermissions`, ADR 0025) is left to
 * the cloud's `PlatformGuard`, which takes platform tokens only; staff tokens are signed with
 * another key for another audience, so a platform token is refused here.
 *
 * The staff member's tenant must allow the request (ADR 0025): a suspended tenant nothing, an
 * archived one reading only. A `@SessionRoute()` (switching brands) counts as reading: it changes
 * the caller's session, not the tenant's data.
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
    if (this.reflector.getAllAndOverride<unknown>(PLATFORM_PERMISSIONS_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const deviceTypes = this.reflector.getAllAndOverride<TerminalDeviceType[] | undefined>(
      DEVICE_ROUTE_KEY,
      targets,
    );
    if (deviceTypes) {
      request.terminal = await this.terminals.authenticate(
        header,
        deviceTypes,
        reportedVersion(request.headers),
      );
      return true;
    }
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError('UNAUTHENTICATED', 'Missing bearer token');
    }
    const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    const principal = await this.access.loadPrincipal(claims.userId, claims.tenantId);
    const session = this.reflector.getAllAndOverride<boolean | undefined>(
      SESSION_ROUTE_KEY,
      targets,
    );
    assertTenantAccess(principal.tenantStatus, session ? 'read' : accessKindOf(request.method));
    request.principal = principal;
    return true;
  }
}
