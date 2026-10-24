import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  type AppConfig,
  FloorModule,
  KioskModule,
  KitchenModule,
  LocationsModule,
  MenuModule,
  OrdersModule,
  PaymentsModule,
  PricingConfigModule,
  ReportsModule,
  TenantsModule,
  ServerCoreModule,
  ShiftsModule,
  TerminalsModule,
} from '@pos/server';
import { HUB_CONFIG, type HubConfig } from './config';
import { asServerClient, configureSqlite, createHubClient } from './database/hub-database';
import { migrateHubDatabase } from './database/migrator';
import { HubStateService } from './hub-state.service';
import { HubController } from './hub.controller';
import { ProvisionedGuard } from './provisioned.guard';
import { SnapshotSyncService } from './snapshot/snapshot-sync.service';
import { InboundOrdersService } from './sync/inbound-orders.service';
import { OutboxSignal } from './sync/outbox-signal';
import { OutboxRecorder } from './sync/outbox.recorder';
import { SyncEngineService } from './sync/sync-engine.service';

/** Global so the outbox recorder, created inside the database module, can raise it. */
@Global()
@Module({ providers: [OutboxSignal], exports: [OutboxSignal] })
class OutboxSignalModule {}

/**
 * The location hub: the same server modules as the cloud, on SQLite, in hub mode (cloud-managed
 * settings are read-only, PIN sign-in is available, every change goes to the outbox and the sync
 * engine delivers it). It also pairs and serves the location's terminals, the kiosk among them.
 */
@Module({})
export class HubModule {
  static forRoot(config: { app: AppConfig; hub: HubConfig }): DynamicModule {
    return {
      module: HubModule,
      imports: [
        OutboxSignalModule,
        ServerCoreModule.forRoot({
          config: config.app,
          mode: 'hub',
          database: {
            client: {
              useFactory: async () => {
                const client = createHubClient(config.app.DATABASE_URL);
                await configureSqlite(client);
                await migrateHubDatabase(client);
                return asServerClient(client);
              },
            },
            dialect: 'sqlite',
            changeRecorder: OutboxRecorder,
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
        // Terminals paired here, and the self-service kiosk they include (ADR 0022).
        TerminalsModule,
        KioskModule,
      ],
      controllers: [HubController],
      providers: [
        { provide: HUB_CONFIG, useValue: config.hub },
        HubStateService,
        SnapshotSyncService,
        InboundOrdersService,
        SyncEngineService,
        { provide: APP_GUARD, useClass: ProvisionedGuard },
      ],
    };
  }
}
