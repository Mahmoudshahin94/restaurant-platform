import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError, isUuid } from '@pos/domain';
import type { FastifyRequest } from 'fastify';
import { requestMemo } from '../../common/context/request-context';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureService } from '../features/feature.service';
import { HostTenantResolver } from './host-tenant.resolver';

/**
 * Route guard of `@HostRoute()` routes, the tenant website (ADR 0023). Runs after the global
 * guards, which let website routes through without a token:
 *
 * - The tenant is the one whose verified domain the request's host names. `X-Forwarded-Host` is
 *   read only behind a trusted proxy (`TRUST_PROXY`, ADR 0016): Fastify's `request.host` honours
 *   it then, and only then. Without a match the site is not found (`404 SITE_NOT_FOUND`).
 * - The request is then scoped to that tenant like a staff request (`request.scope`, so the
 *   tenant-scoped client confines every query to it). A tenant id, slug or header the browser
 *   sends plays no part.
 * - A `:locationId` must be one of the tenant's locations (`404`, as for staff routes), and the
 *   route's modules are checked for the tenant and that location.
 */
@Injectable()
export class HostTenantGuard implements CanActivate {
  constructor(
    private readonly sites: HostTenantResolver,
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const site = await this.sites.resolve(request.host);
    if (!site) throw new DomainError('SITE_NOT_FOUND', 'No website answers on this host');

    const { locationId } = (request.params ?? {}) as { locationId?: string };
    if (locationId !== undefined) await this.assertLocation(site.tenantId, locationId);
    request.site = site;
    request.scope = { tenantId: site.tenantId, locationId: locationId ?? null };

    const required = request.requiredFeatures ?? [];
    if (required.length > 0) {
      await this.features.assertEnabled(required, request.scope, { memo: requestMemo(request) });
    }
    return true;
  }

  private async assertLocation(tenantId: string, locationId: string): Promise<void> {
    const location = isUuid(locationId)
      ? await TenantContext.runInTenant(tenantId, () =>
          this.prisma.location.findUnique({
            where: { id: locationId },
            select: { tenantId: true },
          }),
        )
      : null;
    if (location?.tenantId !== tenantId) {
      throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
  }
}
