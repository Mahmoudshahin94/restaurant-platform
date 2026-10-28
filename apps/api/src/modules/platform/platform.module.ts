import { Module } from '@nestjs/common';
import { OrdersModule, PlatformTokenService, WebsiteModule } from '@pos/server';
import { AdminModule } from '../admin/admin.module';
import { SyncModule } from '../sync/sync.module';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformGuard } from './auth/platform.guard';
import { PlatformErrorEventsService } from './health/platform-error-events.service';
import { PlatformHealthService } from './health/platform-health.service';
import { PlatformAuditService } from './platform-audit.service';
import {
  PlatformOverviewController,
  PlatformTenantsController,
  SupportController,
} from './platform.controllers';
import { PlatformDirectoryService } from './platform-directory.service';
import { SupportConfirmations } from './support/support-confirmation';
import { SupportService } from './support/support.service';
import { PlatformTenantsService } from './tenants/platform-tenants.service';

/**
 * The platform admin's API (ADR 0025), cloud only: MADAR's operators, their sign-in, tenants and
 * provisioning, health, audit logs and the support tools. Its own identity and tokens: every
 * route is `PlatformGuard`'s, and refuses staff tokens. Its `PlatformErrorEventsService` is the
 * exception filter's error-event sink, which feeds the health board (see `createApp`).
 */
@Module({
  imports: [AdminModule, SyncModule, OrdersModule, WebsiteModule],
  controllers: [
    PlatformAuthController,
    PlatformTenantsController,
    PlatformOverviewController,
    SupportController,
  ],
  providers: [
    PlatformTokenService,
    PlatformAuthService,
    PlatformGuard,
    PlatformAuditService,
    PlatformDirectoryService,
    PlatformTenantsService,
    PlatformErrorEventsService,
    PlatformHealthService,
    SupportConfirmations,
    SupportService,
  ],
})
export class PlatformModule {}
