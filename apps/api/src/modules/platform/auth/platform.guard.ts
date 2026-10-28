import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, assertPlatformPermissions, isUuid } from '@pos/domain';
import {
  PLATFORM_PERMISSIONS_KEY,
  PlatformTokenService,
  PrismaService,
  TenantContext,
} from '@pos/server';
import { type PlatformPermission, platformPermissionsOf } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';

/**
 * Route guard of the platform API (ADR 0025), on every platform controller. The global staff
 * guards let platform routes through; this one:
 *
 * - takes a platform access token only (its own key and audience): a staff token, a device
 *   credential or no token is `401`;
 * - loads the operator fresh (a deactivated account stops at once) and checks the route's
 *   platform permissions against the role (`403 INSUFFICIENT_PERMISSION`);
 * - for a route naming `:tenantId`, answers `404 TENANT_NOT_FOUND` for an unknown tenant and
 *   scopes the request to that tenant, so the tenant-scoped client confines every query to it.
 *   The tenant's status does not apply: operators must reach a suspended tenant.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: PlatformTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PlatformPermission[] | undefined>(
      PLATFORM_PERMISSIONS_KEY,
      targets,
    );
    if (!required) throw new DomainError('INSUFFICIENT_PERMISSION', 'Not a platform route');
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError('UNAUTHENTICATED', 'Missing bearer token');
    }
    const id = await this.tokens.verify(header.slice('Bearer '.length).trim());
    const user = await this.prisma.platformUser.findUnique({ where: { id } });
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Unknown platform user');
    if (!user.isActive) throw new DomainError('ACCOUNT_DISABLED', 'Account is disabled');
    assertPlatformPermissions(user.role, required);
    request.platformUser = {
      id: user.id,
      role: user.role,
      permissions: platformPermissionsOf(user.role),
    };

    const { tenantId } = (request.params ?? {}) as { tenantId?: string };
    if (tenantId !== undefined) {
      const tenant = isUuid(tenantId)
        ? await TenantContext.runInTenant(tenantId, () =>
            this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
          )
        : null;
      if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
      request.scope = { tenantId, locationId: null };
    }
    return true;
  }
}
