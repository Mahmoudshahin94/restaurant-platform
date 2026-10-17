import { type DynamicModule, Module } from '@nestjs/common';
import { PrismaClient } from '@pos/database';
import {
  type AppConfig,
  FloorModule,
  KitchenModule,
  LocationsModule,
  MenuModule,
  OrdersModule,
  PaymentsModule,
  PricingConfigModule,
  ReportsModule,
  RestaurantsModule,
  ServerCoreModule,
  ShiftsModule,
} from '@pos/server';
import { DevicesModule } from './modules/devices/devices.module';
import { SyncModule } from './modules/sync/sync.module';

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
          },
        }),
        RestaurantsModule,
        LocationsModule,
        MenuModule,
        PricingConfigModule,
        FloorModule,
        OrdersModule,
        PaymentsModule,
        ShiftsModule,
        ReportsModule,
        KitchenModule,
        // Cloud-only: hub pairing and the hub link.
        DevicesModule,
        SyncModule,
      ],
    };
  }
}
