import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '@pos/server';
import type { SyncPullResponse, syncPullQuerySchema } from '@pos/validation';
import type { z } from 'zod';
import type { AuthenticatedDevice } from '../devices/device.guard';

/** How often a waiting pull looks for new changes (ADR 0012: LISTEN/NOTIFY can replace this). */
const POLL_MS = 1000;

/**
 * The change feed a hub reads (`GET /sync/pull`): entries for its restaurant (all locations) or its
 * own location, after its cursor, in `seq` order. With `wait`, the request is held until a change
 * arrives or the wait ends (long poll), so changes reach the hub within about a second.
 */
@Injectable()
export class ChangeFeedService implements OnModuleDestroy {
  private readonly closing = new AbortController();

  constructor(private readonly prisma: PrismaService) {}

  onModuleDestroy(): void {
    // Release waiting hubs so the server can shut down; they simply pull again.
    this.closing.abort();
  }

  async pull(
    device: AuthenticatedDevice,
    query: z.output<typeof syncPullQuerySchema>,
    disconnected?: AbortSignal,
  ): Promise<SyncPullResponse> {
    const scope = {
      restaurantId: device.restaurantId,
      OR: [{ locationId: null }, { locationId: device.locationId }],
    };
    if (query.cursor === undefined) {
      // A new hub starts at the head; it takes a full snapshot right after (docs/sync.md).
      const head = await this.prisma.changeLog.aggregate({ where: scope, _max: { seq: true } });
      return { changes: [], cursor: String(head._max.seq ?? 0n), hasMore: false };
    }

    const after = BigInt(query.cursor);
    const deadline = Date.now() + query.wait * 1000;
    const signals = AbortSignal.any([this.closing.signal, ...(disconnected ? [disconnected] : [])]);
    for (;;) {
      const rows = await this.prisma.changeLog.findMany({
        where: { ...scope, seq: { gt: after } },
        orderBy: { seq: 'asc' },
        take: query.limit + 1,
      });
      if (rows.length > 0 || Date.now() >= deadline || signals.aborted) {
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          changes: page.map((r) => ({
            seq: String(r.seq),
            topic: r.topic,
            entityId: r.entityId,
            createdAt: r.createdAt.toISOString(),
          })),
          cursor: last ? String(last.seq) : query.cursor,
          hasMore: rows.length > query.limit,
        };
      }
      await sleep(Math.min(POLL_MS, deadline - Date.now()), signals);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}
