import { Injectable } from '@nestjs/common';
import { DomainError, isUuid } from '@pos/domain';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureService } from '../features/feature.service';

/**
 * A location a website request names in its body (a new order's `locationId`, ADR 0023). The
 * request is already scoped to the tenant whose verified domain it came to (`HostTenantGuard`),
 * so another tenant's location is simply not found. The route's modules are then checked at that
 * location, as `HostTenantGuard` does for a `:locationId` in the path.
 */
@Injectable()
export class SiteLocations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeatureService,
  ) {}

  async assert(tenantId: string, locationId: string): Promise<void> {
    const location = isUuid(locationId)
      ? await this.prisma.location.findUnique({
          where: { id: locationId },
          select: { tenantId: true },
        })
      : null;
    if (location?.tenantId !== tenantId) {
      throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    const required = RequestContext.get()?.requiredFeatures ?? [];
    if (required.length > 0) await this.features.assertEnabled(required, { tenantId, locationId });
  }
}
