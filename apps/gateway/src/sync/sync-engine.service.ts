import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService, RealtimeBus } from '@pos/server';
import type { EventMap, SyncConnectionState } from '@pos/shared-types';
import { isPrismaKnownError } from '@pos/server';
import type { ChangeEntry, SyncOperation as WireOperation } from '@pos/validation';
import { HUB_CONFIG, type HubConfig } from '../config';
import { asHubTx } from '../database/hub-database';
import { HubStateService, type Pairing } from '../hub-state.service';
import { SnapshotSyncService } from '../snapshot/snapshot-sync.service';
import {
  CloudClient,
  CloudCredentialRejected,
  CloudRequestRejected,
  CloudUnavailable,
} from './cloud-client';
import { InboundOrdersService } from './inbound-orders.service';
import { OutboxSignal } from './outbox-signal';
import {
  type OutboxEntry,
  type PlannedSend,
  backoffDelay,
  dependenciesOf,
  groupByEntity,
  isSendable,
  planBatch,
} from './plan-batch';

const isForeignKeyError = (error: unknown) =>
  isPrismaKnownError(error, 'P2003') ||
  (error instanceof Error && error.message.includes('FOREIGN KEY constraint failed'));

/** Operations per push request (the cloud accepts up to 50). */
const BATCH_SIZE = 25;
/** Times the cloud may answer RETRY for one operation before it becomes FAILED. */
const MAX_OPERATION_RETRIES = 10;
/** Backoff for an operation the cloud asked to retry. */
const OPERATION_RETRY_BASE_MS = 2_000;
const OPERATION_RETRY_MAX_MS = 5 * 60_000;
/** Debounce after the outbox grew. */
const PUSH_DEBOUNCE_MS = 200;

interface BatchItem {
  planned: PlannedSend;
  op: WireOperation;
}

type SyncEvent = 'sync.completed' | 'sync.failed' | 'sync.status_changed';

export interface PushSummary {
  sent: number;
  completed: number;
  failed: number;
  retried: number;
}

/** Status figures the POS shows (docs/sync.md, "Connectivity indicator"). */
export interface SyncFigures {
  state: SyncConnectionState;
  pending: number;
  failed: number;
  synced: number;
}

/**
 * The hub's sync engine (ADR 0012).
 *
 * Push: sends the outbox to the cloud whenever it grows, newest state per entity, dependencies
 * first, with exponential backoff while the cloud is unreachable. Pull: follows the cloud's change
 * feed with a long poll and refreshes the location snapshot when configuration changed. Both stop
 * cleanly at shutdown; a crash mid-push is harmless because the cloud de-duplicates.
 */
@Injectable()
export class SyncEngineService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SyncEngineService.name);
  private readonly stopping = new AbortController();
  /** Interrupts a backoff sleep or a long poll, e.g. for "Sync now". */
  private wake = new AbortController();
  private pushing: Promise<PushSummary> | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private pruneTimer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private failures = 0;
  private lastState: SyncConnectionState | null = null;

  lastSyncAt: Date | null = null;
  nextAttemptAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: HubStateService,
    private readonly snapshots: SnapshotSyncService,
    private readonly bus: RealtimeBus,
    private readonly signal: OutboxSignal,
    private readonly inbound: InboundOrdersService,
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
  ) {}

  private get db() {
    return asHubTx(this.prisma);
  }

  async onApplicationBootstrap(): Promise<void> {
    // Rows a crash left in flight are sent again; the cloud answers DUPLICATE if it had them.
    await this.db.syncOperation.updateMany({
      where: { status: 'PROCESSING' },
      data: { status: 'PENDING' },
    });
    if (!this.config.sync.enabled) return;
    this.unsubscribe = this.signal.subscribe(() => {
      this.schedulePush(PUSH_DEBOUNCE_MS);
    });
    this.schedulePush(0);
    void this.pullLoop();
    this.pruneTimer = setInterval(() => void this.prune(), 60 * 60_000);
    this.pruneTimer.unref();
  }

  onModuleDestroy(): void {
    this.stopping.abort();
    this.wake.abort();
    this.unsubscribe?.();
    if (this.pushTimer) clearTimeout(this.pushTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  // --- Status ------------------------------------------------------------------------------------

  async figures(): Promise<SyncFigures> {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [pending, failed, synced] = await Promise.all([
      this.db.syncOperation.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.db.syncOperation.count({ where: { status: 'FAILED' } }),
      this.db.syncOperation.count({ where: { status: 'COMPLETED', processedAt: { gte: since } } }),
    ]);
    const cloud = this.state.cloud;
    let state: SyncConnectionState;
    if (failed > 0 || cloud.credentialRejected) state = 'SYNC_ERROR';
    else if (cloud.status === 'OFFLINE') state = 'OFFLINE';
    else if (pending > 0 || this.pushing !== null || cloud.status === 'UNKNOWN') state = 'SYNCING';
    else state = 'ONLINE';
    return { state, pending, failed, synced };
  }

  /** Tells screens when the indicator changes (online ↔ offline, errors appear or clear). */
  private async announce(): Promise<void> {
    const pairing = await this.state.get('pairing');
    if (!pairing) return;
    const figures = await this.figures();
    if (figures.state === this.lastState) return;
    this.lastState = figures.state;
    this.publish(pairing, 'sync.status_changed', {
      state: figures.state,
      pending: figures.pending,
      failed: figures.failed,
    });
  }

  private publish<K extends SyncEvent>(pairing: Pairing, type: K, payload: EventMap[K]): void {
    const scope = { restaurantId: pairing.restaurantId, locationId: pairing.locationId };
    this.bus.publish([this.bus.event(type, scope, payload)]);
  }

  // --- Manual controls ---------------------------------------------------------------------------

  /** "Sync now": forget the backoff, push everything that can go, and check the feed. */
  async syncNow(): Promise<void> {
    this.failures = 0;
    this.nextAttemptAt = null;
    if (this.state.cloud.credentialRejected) {
      // Try again: the hub may have been re-paired meanwhile.
      this.state.markCloud('OFFLINE', this.state.cloud.lastError);
    }
    await this.db.syncOperation.updateMany({
      where: { status: 'PENDING', nextRetryAt: { not: null } },
      data: { nextRetryAt: null },
    });
    this.interrupt();
    await this.pullOnce(0).catch((error: unknown) => {
      this.onCloudError(error, 'pull');
    });
    await this.pushNow();
  }

  /** Puts a FAILED operation back in the queue (after someone fixed the cause). */
  async retry(id: string): Promise<boolean> {
    const { count } = await this.db.syncOperation.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'PENDING', nextRetryAt: null, retryCount: 0 },
    });
    if (count > 0) {
      this.schedulePush(0);
      await this.announce();
    }
    return count > 0;
  }

  // --- Push --------------------------------------------------------------------------------------

  private schedulePush(delayMs: number): void {
    if (this.stopping.signal.aborted) return;
    // While backing off, new work waits for the backoff instead of cancelling it.
    if (this.nextAttemptAt) delayMs = Math.max(delayMs, this.nextAttemptAt.getTime() - Date.now());
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushNow();
    }, delayMs);
    this.pushTimer.unref();
  }

  /** Single-flight: concurrent callers share one run, which sends until nothing is left. */
  pushNow(): Promise<PushSummary> {
    this.pushing ??= this.pushAll().finally(() => {
      this.pushing = null;
      void this.announce();
    });
    return this.pushing;
  }

  private async pushAll(): Promise<PushSummary> {
    const total: PushSummary = { sent: 0, completed: 0, failed: 0, retried: 0 };
    const pairing = await this.state.get('pairing');
    if (!pairing || this.state.cloud.credentialRejected) return total;
    if (this.nextAttemptAt && this.nextAttemptAt > new Date()) return total;
    const client = new CloudClient(pairing, this.config.cloudTimeoutMs);

    for (;;) {
      if (this.stopping.signal.aborted) return total;
      const batch = await this.nextBatch();
      if (batch.length === 0) break;
      let summary: PushSummary;
      try {
        summary = await this.send(client, pairing, batch);
      } catch (error) {
        await this.release(batch);
        this.onCloudError(error, 'push');
        return total;
      }
      total.sent += summary.sent;
      total.completed += summary.completed;
      total.failed += summary.failed;
      total.retried += summary.retried;
      // Only operations waiting for a retry remain: stop, a timer brings them back.
      if (summary.completed === 0 && summary.failed === 0) break;
    }
    this.scheduleOperationRetry();
    return total;
  }

  private async nextBatch(): Promise<BatchItem[]> {
    const entries = (await this.db.syncOperation.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, entityType: true, entityId: true, status: true, nextRetryAt: true },
    })) as OutboxEntry[];
    const now = new Date();
    // Payloads only for the newest operation of entities that could go now.
    const candidates = groupByEntity(entries)
      .filter((g) => isSendable(g, now))
      .slice(0, BATCH_SIZE * 4)
      .map((g) => g.entries.at(-1)?.id)
      .filter((id): id is string => id !== undefined);
    const rows = await this.db.syncOperation.findMany({ where: { id: { in: candidates } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Website orders received from the cloud: the version the hub's change is based on (ADR 0013).
    const inbound = new Map(
      (
        await this.db.inboundOrder.findMany({
          where: {
            orderId: { in: rows.filter((r) => r.entityType === 'Order').map((r) => r.entityId) },
          },
        })
      ).map((i) => [i.orderId, i.cloudVersion]),
    );
    const deps = new Map(rows.map((r) => [r.id, dependenciesOf(r.entityType, r.payload)]));
    return planBatch(entries, deps, now, BATCH_SIZE).flatMap((planned) => {
      const row = byId.get(planned.sendId);
      if (!row) return [];
      const op = {
        operationId: row.operationId,
        entityType: row.entityType,
        entityId: row.entityId,
        operationType: row.operationType,
        entityVersion: row.entityVersion,
        ...(row.entityType === 'Order' && inbound.has(row.entityId)
          ? { baseVersion: inbound.get(row.entityId) }
          : {}),
        payload: row.payload,
      } as WireOperation;
      return [{ planned, op }];
    });
  }

  private async send(
    client: CloudClient,
    pairing: Pairing,
    batch: BatchItem[],
  ): Promise<PushSummary> {
    const covered = batch.flatMap((b) => b.planned.coveredIds);
    await this.db.syncOperation.updateMany({
      where: { id: { in: covered } },
      data: { status: 'PROCESSING' },
    });
    const outbox = await this.figures();
    let response;
    try {
      response = await client.push(
        {
          operations: batch.map((b) => b.op),
          outbox: { pending: outbox.pending, failed: outbox.failed },
        },
        this.stopping.signal,
      );
    } catch (error) {
      if (error instanceof CloudRequestRejected) {
        // The whole request was refused (should not happen: payloads are checked per operation).
        // Keep the operations; an operator sees the error on the sync screen.
        this.logger.error(`Cloud refused a push: ${String(error.status)} ${error.message}`);
      }
      throw error;
    }

    const summary: PushSummary = { sent: batch.length, completed: 0, failed: 0, retried: 0 };
    const results = new Map(response.results.map((r) => [r.operationId, r]));
    let lastError = '';
    const now = new Date();
    for (const { planned, op } of batch) {
      const result = results.get(op.operationId);
      const older = planned.coveredIds.filter((id) => id !== planned.sendId);
      if (result?.status === 'APPLIED' || result?.status === 'DUPLICATE') {
        // The newest state is in the cloud: older operations of the entity are superseded.
        await this.db.syncOperation.updateMany({
          where: { id: { in: planned.coveredIds } },
          data: {
            status: 'COMPLETED',
            processedAt: now,
            errorCode: null,
            errorMessage: null,
            nextRetryAt: null,
          },
        });
        summary.completed += 1;
        continue;
      }
      await this.db.syncOperation.updateMany({
        where: { id: { in: older } },
        data: { status: 'PENDING' },
      });
      const code = result?.code ?? 'SYNC_UNAVAILABLE';
      const message = result?.message ?? 'No result from the cloud';
      const current = await this.db.syncOperation.findUniqueOrThrow({
        where: { id: planned.sendId },
        select: { retryCount: true },
      });
      const permanent =
        result?.status === 'CONFLICT' ||
        result?.status === 'REJECTED' ||
        current.retryCount + 1 >= MAX_OPERATION_RETRIES;
      if (permanent) {
        await this.db.syncOperation.update({
          where: { id: planned.sendId },
          data: {
            status: 'FAILED',
            errorCode: code,
            errorMessage: message,
            retryCount: { increment: result?.status === 'RETRY' || !result ? 1 : 0 },
            nextRetryAt: null,
          },
        });
        summary.failed += 1;
        lastError = `${code}: ${message}`;
      } else {
        const delay = backoffDelay(
          current.retryCount,
          OPERATION_RETRY_BASE_MS,
          OPERATION_RETRY_MAX_MS,
        );
        await this.db.syncOperation.update({
          where: { id: planned.sendId },
          data: {
            status: 'PENDING',
            errorCode: code,
            errorMessage: message,
            retryCount: { increment: 1 },
            nextRetryAt: new Date(now.getTime() + Math.max(500, delay)),
          },
        });
        summary.retried += 1;
      }
    }

    this.onCloudSuccess();
    const figures = await this.figures();
    if (summary.completed > 0) {
      this.publish(pairing, 'sync.completed', {
        processed: summary.completed,
        pending: figures.pending,
      });
    }
    if (summary.failed > 0) {
      this.publish(pairing, 'sync.failed', { failed: figures.failed, lastError });
      this.logger.warn(`Cloud refused ${String(summary.failed)} operation(s): ${lastError}`);
    }
    return summary;
  }

  /** A push that never reached the cloud: its operations go back to PENDING unchanged. */
  private async release(batch: BatchItem[]): Promise<void> {
    await this.db.syncOperation.updateMany({
      where: { id: { in: batch.flatMap((b) => b.planned.coveredIds) }, status: 'PROCESSING' },
      data: { status: 'PENDING' },
    });
  }

  /** Wakes the push for the earliest operation the cloud asked to retry later. */
  private scheduleOperationRetry(): void {
    void this.db.syncOperation
      .findFirst({
        where: { status: 'PENDING', nextRetryAt: { not: null } },
        orderBy: { nextRetryAt: 'asc' },
        select: { nextRetryAt: true },
      })
      .then((next) => {
        if (next?.nextRetryAt) {
          this.schedulePush(Math.max(0, next.nextRetryAt.getTime() - Date.now()) + 50);
        }
      });
  }

  // --- Pull --------------------------------------------------------------------------------------

  private async pullLoop(): Promise<void> {
    while (!this.stopping.signal.aborted) {
      try {
        await this.pullOnce(this.config.sync.pullWaitSeconds);
      } catch (error) {
        this.onCloudError(error, 'pull');
        await this.sleep(this.nextAttemptAt ? this.nextAttemptAt.getTime() - Date.now() : 1000);
      }
    }
  }

  /**
   * One change-feed request. A hub without a cursor takes the head of the feed first, then its
   * snapshot, so no change between the two is missed.
   */
  private async pullOnce(waitSeconds: number): Promise<void> {
    this.state.invalidate();
    const pairing = await this.state.get('pairing');
    if (!pairing) {
      await this.sleep(5000);
      return;
    }
    if (this.state.cloud.credentialRejected) {
      // Nothing works until the hub is paired again; check occasionally.
      await this.sleep(this.config.sync.retryMaxMs);
      this.state.markCloud('OFFLINE', this.state.cloud.lastError);
    }
    const client = new CloudClient(pairing, this.config.cloudTimeoutMs);
    const cursor = await this.state.get('cursor');
    const wake = this.wake.signal;
    const signal = AbortSignal.any([this.stopping.signal, wake]);

    if (cursor === null) {
      const head = await client.pull(null, 0, signal);
      await this.refreshConfiguration();
      await this.state.set('cursor', head.cursor);
      this.onCloudSuccess();
      return;
    }
    let page;
    try {
      page = await client.pull(cursor, waitSeconds, signal);
    } catch (error) {
      // Woken on purpose ("Sync now"): not a cloud failure.
      if (wake.aborted && !this.stopping.signal.aborted) return;
      throw error;
    }
    await this.handleChanges(client, page.changes, signal);
    await this.state.set('cursor', page.cursor);
    this.onCloudSuccess();
  }

  /**
   * Applies one page of the feed: a configuration change refreshes the snapshot (once per page,
   * first, so website orders find the products they reference); each website order announced is
   * fetched and stored once, at its newest state. A failure leaves the cursor where it was, so the
   * page is handled again.
   */
  private async handleChanges(
    client: CloudClient,
    changes: readonly ChangeEntry[],
    signal: AbortSignal,
  ): Promise<void> {
    if (changes.some((c) => c.topic === 'CONFIG')) await this.refreshConfiguration();
    const orderIds = [
      ...new Set(changes.flatMap((c) => (c.topic === 'ORDER' && c.entityId ? [c.entityId] : []))),
    ];
    for (const orderId of orderIds) {
      let order;
      try {
        order = await client.order(orderId, signal);
      } catch (error) {
        // Not (or no longer) this location's order: nothing to store.
        if (error instanceof CloudRequestRejected && error.status === 404) continue;
        throw error;
      }
      try {
        await this.inbound.ingest(order);
      } catch (error) {
        if (!isForeignKeyError(error)) throw error;
        // The order references catalog rows this hub does not have yet: refresh, then retry.
        await this.refreshConfiguration();
        await this.inbound.ingest(order);
      }
    }
  }

  private async refreshConfiguration(): Promise<void> {
    const outcome = await this.snapshots.syncNow();
    if (outcome === 'rejected') throw new CloudCredentialRejected('Snapshot refused');
    if (outcome !== 'applied' && outcome !== 'unchanged') {
      throw new CloudUnavailable(`Snapshot ${outcome}`);
    }
  }

  // --- Connectivity ------------------------------------------------------------------------------

  private onCloudSuccess(): void {
    const wasDown = this.failures > 0 || this.state.cloud.status !== 'ONLINE';
    this.failures = 0;
    this.nextAttemptAt = null;
    this.lastSyncAt = new Date();
    this.state.markCloud('ONLINE');
    if (wasDown) {
      // The cloud is back: send what queued up while it was away.
      this.schedulePush(0);
      void this.announce();
    }
  }

  private onCloudError(error: unknown, during: 'push' | 'pull'): void {
    if (this.stopping.signal.aborted) return;
    if (error instanceof CloudCredentialRejected) {
      this.state.markCredentialRejected(error.message);
      this.logger.error(error.message);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof CloudUnavailable))
        this.logger.warn(`Sync ${during} failed: ${message}`);
      this.state.markCloud('OFFLINE', message);
    }
    this.failures += 1;
    const delay = Math.max(
      500,
      backoffDelay(this.failures - 1, this.config.sync.retryBaseMs, this.config.sync.retryMaxMs),
    );
    this.nextAttemptAt = new Date(Date.now() + delay);
    this.schedulePush(delay);
    void this.announce();
  }

  /** Ends the current long poll or backoff sleep; later ones are unaffected. */
  private interrupt(): void {
    this.wake.abort();
    this.wake = new AbortController();
  }

  /** Sleeps unless shut down or woken ("Sync now"). */
  private sleep(ms: number): Promise<void> {
    const signal = AbortSignal.any([this.stopping.signal, this.wake.signal]);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      if (signal.aborted) done();
      else signal.addEventListener('abort', done, { once: true });
    });
  }

  // --- Housekeeping ------------------------------------------------------------------------------

  /** Completed rows older than the retention keep their row (and sequence) but drop the payload. */
  async prune(): Promise<number> {
    const before = new Date(Date.now() - this.config.sync.retentionDays * 24 * 60 * 60_000);
    const { count } = await this.db.syncOperation.updateMany({
      where: { status: 'COMPLETED', processedAt: { lt: before }, NOT: { payload: { equals: {} } } },
      data: { payload: {} },
    });
    return count;
  }
}
