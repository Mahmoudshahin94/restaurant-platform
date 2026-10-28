import { Module } from '@nestjs/common';
import { OnlineOrderingModule } from '@pos/server';
import { DevicesModule } from '../devices/devices.module';
import { ChangeFeedService } from './change-feed.service';
import { SnapshotService } from './snapshot.service';
import { SyncAdminController } from './sync-admin.controller';
import { SyncAdminService } from './sync-admin.service';
import { CloudOrdersService } from './cloud-orders.service';
import { SyncPushService } from './sync-push.service';
import { SyncController } from './sync.controller';

/** Cloud side of the hub link: snapshot, outbox ingest (push) and change feed (pull). */
@Module({
  imports: [DevicesModule, OnlineOrderingModule],
  controllers: [SyncController, SyncAdminController],
  providers: [
    SnapshotService,
    SyncPushService,
    ChangeFeedService,
    CloudOrdersService,
    SyncAdminService,
  ],
  // The platform's support tools settle refused operations through the same rules (ADR 0025).
  exports: [SyncAdminService],
})
export class SyncModule {}
