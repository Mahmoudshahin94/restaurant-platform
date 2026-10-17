import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Public, PrismaService, RequirePermissions } from '@pos/server';
import type { HubStatus } from '@pos/validation';
import { asHubTx } from './database/hub-database';
import { HubStateService } from './hub-state.service';
import { SnapshotSyncService } from './snapshot/snapshot-sync.service';

@Controller('hub')
export class HubController {
  constructor(
    private readonly state: HubStateService,
    private readonly snapshots: SnapshotSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /** Pairing, cloud reachability and outbox size; no secrets. Also tells clients they talk to a hub. */
  @Public()
  @Get('status')
  status(): Promise<HubStatus> {
    return this.build();
  }

  /** Pull the latest configuration from the cloud now. */
  @RequirePermissions(['sync.view'], { scope: 'any-location' })
  @Post('sync')
  @HttpCode(200)
  async sync(): Promise<HubStatus> {
    await this.snapshots.syncNow();
    return this.build();
  }

  private async build(): Promise<HubStatus> {
    const pairing = await this.state.get('pairing');
    const snapshot = await this.state.get('snapshot');
    const pendingOperations = await asHubTx(this.prisma).syncOperation.count({
      where: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
    });
    return {
      paired: pairing !== null,
      restaurantId: pairing?.restaurantId ?? null,
      locationId: pairing?.locationId ?? null,
      cloud: this.state.cloud.status,
      lastSnapshotAt: snapshot?.appliedAt ?? null,
      snapshotVersion: snapshot?.version ?? null,
      lastError: this.state.cloud.lastError,
      pendingOperations,
    };
  }
}
