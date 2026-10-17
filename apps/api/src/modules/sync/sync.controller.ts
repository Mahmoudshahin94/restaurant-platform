import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Public, ZodValidationPipe } from '@pos/server';
import {
  type LocationSnapshot,
  type SyncPullResponse,
  type SyncPushResponse,
  syncPullQuerySchema,
  syncPushRequestSchema,
} from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { type AuthenticatedDevice, DeviceGuard } from '../devices/device.guard';
import { ChangeFeedService } from './change-feed.service';
import { SnapshotService } from './snapshot.service';
import { SyncPushService } from './sync-push.service';

function deviceOf(request: FastifyRequest): AuthenticatedDevice {
  if (!request.device) throw new Error('DeviceGuard did not run');
  return request.device;
}

/** Endpoints for location hubs, authenticated by device credential (not staff tokens). */
@Public()
@UseGuards(DeviceGuard)
@Controller('sync')
export class SyncController {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly pushes: SyncPushService,
    private readonly feed: ChangeFeedService,
  ) {}

  /** The hub's location configuration; `304` when the hub already has this version. */
  @Get('snapshot')
  async snapshot(
    @Req() request: FastifyRequest,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LocationSnapshot | undefined> {
    const snapshot = await this.snapshots.build(deviceOf(request));
    const etag = `"${snapshot.version}"`;
    void reply.header('etag', etag).header('cache-control', 'no-store');
    if (ifNoneMatch === etag) {
      void reply.status(304);
      return undefined;
    }
    return snapshot;
  }

  /** The hub's outbox: one result per operation, in order (docs/sync.md). */
  @Post('push')
  @HttpCode(200)
  push(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(syncPushRequestSchema))
    body: z.output<typeof syncPushRequestSchema>,
  ): Promise<SyncPushResponse> {
    return this.pushes.push(deviceOf(request), body);
  }

  /** Change feed after `cursor`; with `wait`, held until a change arrives (long poll). */
  @Get('pull')
  pull(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(syncPullQuerySchema)) query: z.output<typeof syncPullQuerySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SyncPullResponse> {
    void reply.header('cache-control', 'no-store');
    // The response's `close` before it is sent means the hub went away: stop waiting.
    const disconnected = new AbortController();
    reply.raw.once('close', () => {
      disconnected.abort();
    });
    return this.feed.pull(deviceOf(request), query, disconnected.signal);
  }
}
