import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { syncPermissionCatalog } from '@pos/database';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';

/** Ensures every code-defined permission key exists before roles reference it. Idempotent. */
@Injectable()
export class PermissionCatalogInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogInitializer.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    // Start-up work across tenants: every system role receives new permissions.
    const added = await TenantContext.runUnscoped('start-up: permission catalog', () =>
      syncPermissionCatalog(this.prisma),
    );
    if (added > 0) this.logger.log(`Added ${added} permission(s) to the catalog`);
  }
}
