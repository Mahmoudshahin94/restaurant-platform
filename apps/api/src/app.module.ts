import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaClient } from '@pos/database';
import {
  type AppConfig,
  FloorModule,
  KitchenModule,
  LocationsModule,
  MenuModule,
  OnlineOrderingModule,
  OrdersModule,
  PaymentsModule,
  PricingConfigModule,
  ReportsModule,
  TenantsModule,
  ServerCoreModule,
  ShiftsModule,
} from '@pos/server';
import { AdminModule } from './modules/admin/admin.module';
import { DevicesModule } from './modules/devices/devices.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ReleasesModule } from './modules/releases/releases.module';
import { CloudReportsModule } from './modules/reports/reports.module';
import { SyncModule } from './modules/sync/sync.module';
import { WebOrderChangeRecorder } from './modules/sync/web-order-change.recorder';

/** The cloud API: the shared server modules on PostgreSQL, plus cloud-only administration. */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ServerCoreModule.forRoot({
          config,
          mode: 'cloud',
          database: {
            client: { useFactory: () => new PrismaClient({ datasourceUrl: config.DATABASE_URL }) },
            dialect: 'postgres',
            // Website orders the cloud creates or changes go on the change feed (ADR 0013).
            changeRecorder: WebOrderChangeRecorder,
          },
        }),
        // Cloud-only: organizations (E1), and an account's brands across every tenant for sign-in.
        OrganizationsModule,
        // Cloud-only: which hubs and apps this cloud still serves (ADR 0026).
        ReleasesModule,
        TenantsModule,
        LocationsModule,
        MenuModule,
        PricingConfigModule,
        FloorModule,
        OrdersModule,
        PaymentsModule,
        ShiftsModule,
        ReportsModule,
        KitchenModule,
        // Cloud-only: the customer website's ordering, hub pairing and the hub link.
        OnlineOrderingModule,
        DevicesModule,
        SyncModule,
        // Cloud-only: the admin portal's staff, payment setup, overviews and audit log.
        AdminModule,
        // Cloud-only: reports over PostgreSQL views (Phase 9).
        CloudReportsModule,
        // Cloud-only: MADAR's own platform admin (ADR 0025), a separate identity.
        PlatformModule,
      ],
    };
  }
}
