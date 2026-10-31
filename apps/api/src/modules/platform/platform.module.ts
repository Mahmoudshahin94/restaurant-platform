import { Module } from '@nestjs/common';
import { OrdersModule, PlatformTokenService, WebsiteModule } from '@pos/server';
import { AdminModule } from '../admin/admin.module';
import { SyncModule } from '../sync/sync.module';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformGuard } from './auth/platform.guard';
import { PlatformOrganizationsController } from './organizations/platform-organizations.controller';
import { PlatformOrganizationsService } from './organizations/platform-organizations.service';
import { PlatformErrorEventsService } from './health/platform-error-events.service';
import { PlatformHealthService } from './health/platform-health.service';
import { PlatformAuditService } from './platform-audit.service';
import {
  PlatformOverviewController,
  PlatformReleasesController,
  PlatformTenantsController,
  SupportController,
} from './platform.controllers';
import { PlatformDirectoryService } from './platform-directory.service';
import { PlatformReleasesService } from './releases/platform-releases.service';
import { SupportConfirmations } from './support/support-confirmation';
import { SupportService } from './support/support.service';
import { PlatformTenantsService } from './tenants/platform-tenants.service';

/**
 * The platform admin's API (ADR 0025), cloud only: MADAR's operators, their sign-in, tenants and
 * provisioning, health, audit logs, the support tools and releases (ADR 0026). Its own identity
 * and tokens: every route is `PlatformGuard`'s, and refuses staff tokens. Its
 * `PlatformErrorEventsService` is the exception filter's error-event sink, which feeds the health
 * board (see `createApp`).
 */
@Module({
  imports: [AdminModule, SyncModule, OrdersModule, WebsiteModule],
  controllers: [
    PlatformAuthController,
    PlatformTenantsController,
    PlatformOrganizationsController,
    PlatformOverviewController,
    SupportController,
    PlatformReleasesController,
  ],
  providers: [
    PlatformTokenService,
    PlatformAuthService,
    PlatformGuard,
    PlatformAuditService,
    PlatformDirectoryService,
    PlatformTenantsService,
    PlatformOrganizationsService,
    PlatformErrorEventsService,
    PlatformHealthService,
    SupportConfirmations,
    SupportService,
    PlatformReleasesService,
  ],
})
export class PlatformModule {}
