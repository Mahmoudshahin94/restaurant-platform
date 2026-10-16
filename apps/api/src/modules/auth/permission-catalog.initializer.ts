import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { syncPermissionCatalog } from '@pos/database';
import { PrismaService } from '../../prisma/prisma.service';

/** Ensures every code-defined permission key exists before roles reference it. Idempotent. */
@Injectable()
export class PermissionCatalogInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogInitializer.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const added = await syncPermissionCatalog(this.prisma);
    if (added > 0) this.logger.log(`Added ${added} permission(s) to the catalog`);
  }
}
