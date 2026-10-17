import { Controller, Get, Headers, Req, Res, UseGuards } from '@nestjs/common';
import { Public } from '@pos/server';
import type { LocationSnapshot } from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DeviceGuard } from '../devices/device.guard';
import { SnapshotService } from './snapshot.service';

/** Endpoints for location hubs, authenticated by device credential (not staff tokens). */
@Public()
@UseGuards(DeviceGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly snapshots: SnapshotService) {}

  /** The hub's location configuration; `304` when the hub already has this version. */
  @Get('snapshot')
  async snapshot(
    @Req() request: FastifyRequest,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LocationSnapshot | undefined> {
    const device = request.device;
    if (!device) throw new Error('DeviceGuard did not run');
    const snapshot = await this.snapshots.build(device);
    const etag = `"${snapshot.version}"`;
    void reply.header('etag', etag).header('cache-control', 'no-store');
    if (ifNoneMatch === etag) {
      void reply.status(304);
      return undefined;
    }
    return snapshot;
  }
}
