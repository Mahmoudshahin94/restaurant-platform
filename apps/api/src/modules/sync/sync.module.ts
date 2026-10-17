import { Module } from '@nestjs/common';
import { OnlineOrderingModule } from '@pos/server';
import { DevicesModule } from '../devices/devices.module';
import { ChangeFeedService } from './change-feed.service';
import { SnapshotService } from './snapshot.service';
import { SyncIssuesController } from './sync-issues.controller';
import { CloudOrdersService } from './cloud-orders.service';
import { SyncPushService } from './sync-push.service';
import { SyncController } from './sync.controller';

/** Cloud side of the hub link: snapshot, outbox ingest (push) and change feed (pull). */
@Module({
  imports: [DevicesModule, OnlineOrderingModule],
  controllers: [SyncController, SyncIssuesController],
  providers: [SnapshotService, SyncPushService, ChangeFeedService, CloudOrdersService],
})
export class SyncModule {}
