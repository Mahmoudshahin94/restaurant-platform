import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Public, ZodValidationPipe } from '@pos/server';
import {
  type LocationSnapshot,
  type SyncOrder,
  idSchema,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncResolution,
  syncPullQuerySchema,
  syncPushRequestSchema,
} from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { type AuthenticatedDevice, DeviceGuard } from '../devices/device.guard';
import { ChangeFeedService } from './change-feed.service';
import { CloudOrdersService } from './cloud-orders.service';
import { SnapshotService } from './snapshot.service';
import { SyncAdminService } from './sync-admin.service';
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
    private readonly orders: CloudOrdersService,
    private readonly admin: SyncAdminService,
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

  /** A website order announced on the feed (`ORDER` topic), as an order aggregate. */
  @Get('orders/:orderId')
  order(
    @Req() request: FastifyRequest,
    @Param('orderId', new ZodValidationPipe(idSchema)) orderId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SyncOrder> {
    void reply.header('cache-control', 'no-store');
    return this.orders.aggregate(deviceOf(request), orderId);
  }

  /** An administrator's decision on an operation this hub pushed (`RESOLUTION` topic). */
  @Get('resolutions/:operationId')
  resolution(
    @Req() request: FastifyRequest,
    @Param('operationId', new ZodValidationPipe(idSchema)) operationId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SyncResolution> {
    void reply.header('cache-control', 'no-store');
    return this.admin.resolutionFor(deviceOf(request), operationId);
  }
}
