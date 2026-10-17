import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { SnapshotService } from './snapshot.service';
import { SyncController } from './sync.controller';

/** Cloud side of the hub link. Phase 6 adds push (outbox ingest) and the change feed. */
@Module({
  imports: [DevicesModule],
  controllers: [SyncController],
  providers: [SnapshotService],
})
export class SyncModule {}
