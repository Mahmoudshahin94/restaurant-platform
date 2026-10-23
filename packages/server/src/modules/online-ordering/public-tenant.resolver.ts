import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { RequestContext } from '../../common/context/request-context';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureService } from '../features/feature.service';

/**
 * The customer website calls without an account, so its requests carry no tenant. Each public
 * route first finds the tenant of what it names (the tenant's slug, a location, a tracked order)
 * and then works inside that tenant only (ADR 0017). The ids come from the browser; they are
 * looked up, never trusted as a tenant. Phase 7 replaces the slug with the verified host name.
 *
 * It is also where public routes meet their modules (ADR 0018): the route's `@RequireFeature`
 * list is checked against the tenant (and location) found, before anything is read.
 */
@Injectable()
export class PublicTenantResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
  ) {}

  async bySlug(slug: string): Promise<string> {
    const tenant = await TenantContext.runUnscoped('storefront: find the tenant by slug', () =>
      this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
    );
    if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    await this.assertModules(tenant.id, null);
    return tenant.id;
  }

  async byLocation(locationId: string): Promise<string> {
    const location = await TenantContext.runUnscoped('storefront: find the location', () =>
      this.prisma.location.findUnique({ where: { id: locationId }, select: { tenantId: true } }),
    );
    if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    await this.assertModules(location.tenantId, locationId);
    return location.tenantId;
  }

  /** The tenant of a tracked order, or null when there is no such order. */
  async byOrder(orderId: string): Promise<string | null> {
    const order = await TenantContext.runUnscoped('order tracking: find the order', () =>
      this.prisma.order.findUnique({
        where: { id: orderId },
        select: { tenantId: true, locationId: true },
      }),
    );
    if (!order) return null;
    await this.assertModules(order.tenantId, order.locationId);
    return order.tenantId;
  }

  /** Runs `fn` inside the tenant of `locationId`. */
  async inLocationTenant<T>(locationId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.runInTenant(await this.byLocation(locationId), fn);
  }

  /** The modules the current public route requires (`@RequireFeature`, via the FeatureGuard). */
  private async assertModules(tenantId: string, locationId: string | null): Promise<void> {
    const required = RequestContext.get()?.requiredFeatures ?? [];
    if (required.length > 0) await this.features.assertEnabled(required, { tenantId, locationId });
  }
}
