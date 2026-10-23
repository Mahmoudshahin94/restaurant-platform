import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { Public, PrismaService, RequirePermissions, ZodValidationPipe } from '@pos/server';
import {
  type HubStatus,
  type HubSyncOperation,
  hubSyncOperationsQuerySchema,
  idSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { asHubTx } from './database/hub-database';
import { HubStateService } from './hub-state.service';
import { SyncEngineService } from './sync/sync-engine.service';

/** A human label for an outbox row: the order number of orders, tickets and payments. */
function labelOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const row = payload as { orderNumber?: unknown };
  return typeof row.orderNumber === 'string' ? row.orderNumber : null;
}

@Controller('hub')
export class HubController {
  constructor(
    private readonly state: HubStateService,
    private readonly engine: SyncEngineService,
    private readonly prisma: PrismaService,
  ) {}

  /** Pairing, cloud link and outbox figures; no secrets. Also tells clients they talk to a hub. */
  @Public()
  @Get('status')
  status(): Promise<HubStatus> {
    return this.build();
  }

  /** "Sync now": send the outbox and check the cloud for configuration changes. */
  @RequirePermissions(['orders.view'], { scope: 'any-location' })
  @Post('sync')
  @HttpCode(200)
  async sync(): Promise<HubStatus> {
    await this.engine.syncNow();
    return this.build();
  }

  /** The outbox, for the POS synchronization screen. */
  @RequirePermissions(['orders.view'], { scope: 'any-location' })
  @Get('sync/operations')
  async operations(
    @Query(new ZodValidationPipe(hubSyncOperationsQuerySchema))
    query: z.output<typeof hubSyncOperationsQuerySchema>,
  ): Promise<{ items: HubSyncOperation[] }> {
    // In-flight rows count as pending: they are sent again if the push does not finish.
    const statuses =
      query.status === 'PENDING' ? (['PENDING', 'PROCESSING'] as const) : [query.status];
    const rows = await asHubTx(this.prisma).syncOperation.findMany({
      where: { status: { in: [...statuses] } },
      orderBy:
        query.status === 'COMPLETED'
          ? [{ processedAt: 'desc' }, { createdAt: 'desc' }]
          : [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit,
    });
    // Tickets carry no order number: look it up from the order.
    const orderIds = rows
      .filter((r) => r.entityType === 'KitchenTicket')
      .map((r) => (r.payload as { orderId?: string }).orderId)
      .filter((id): id is string => typeof id === 'string');
    const orders = await asHubTx(this.prisma).order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true },
    });
    const numbers = new Map(orders.map((o) => [o.id, o.orderNumber]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        operationId: r.operationId,
        entityType: r.entityType,
        entityId: r.entityId,
        operationType: r.operationType,
        label:
          labelOf(r.payload) ??
          numbers.get((r.payload as { orderId?: string }).orderId ?? '') ??
          null,
        status: r.status,
        retryCount: r.retryCount,
        nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Puts a failed operation back in the queue, once the cause was fixed (e.g. in the cloud). */
  @RequirePermissions(['sync.view'], { scope: 'any-location' })
  @Post('sync/operations/:id/retry')
  @HttpCode(200)
  async retry(@Param('id', new ZodValidationPipe(idSchema)) id: string): Promise<HubStatus> {
    if (!(await this.engine.retry(id))) {
      throw new DomainError('NOT_FOUND', 'No failed operation with this id', { id });
    }
    return this.build();
  }

  private async build(): Promise<HubStatus> {
    const pairing = await this.state.get('pairing');
    const snapshot = await this.state.get('snapshot');
    const figures = await this.engine.figures();
    return {
      paired: pairing !== null,
      tenantId: pairing?.tenantId ?? null,
      locationId: pairing?.locationId ?? null,
      cloud: this.state.cloud.status,
      state: pairing ? figures.state : 'OFFLINE',
      lastSnapshotAt: snapshot?.appliedAt ?? null,
      snapshotVersion: snapshot?.version ?? null,
      lastError: this.state.cloud.lastError,
      pendingOperations: figures.pending,
      failedOperations: figures.failed,
      syncedOperations: figures.synced,
      lastSyncAt: this.engine.lastSyncAt?.toISOString() ?? null,
      nextAttemptAt: this.engine.nextAttemptAt?.toISOString() ?? null,
    };
  }
}
