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
      ],
    };
  }
}
