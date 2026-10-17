import { Injectable } from '@nestjs/common';
import { ChangeRecorder, type ChangeSet, type PrismaTx } from '@pos/server';

/**
 * The cloud's change capture (ADR 0013): every transaction that creates or changes a website order
 * appends an `ORDER` entry to the change feed, inside that transaction, so the location's hub
 * fetches the order. Other orders, shifts and tickets come from hubs and are not echoed back.
 *
 * Takes the same per-restaurant advisory lock as the configuration triggers (ADR 0012), so `seq`
 * order is commit order and a hub's cursor never passes an entry that commits late.
 */
@Injectable()
export class WebOrderChangeRecorder extends ChangeRecorder {
  async record(tx: PrismaTx, changes: ChangeSet): Promise<void> {
    const ids = [...new Set(changes.orderIds ?? [])];
    if (ids.length === 0) return;
    const orders = await tx.order.findMany({
      where: { id: { in: ids }, channel: 'WEBSITE' },
      select: { id: true, restaurantId: true, locationId: true },
      orderBy: { id: 'asc' },
    });
    for (const order of orders) await recordOrderChange(tx, order);
  }
}

/**
 * Appends one ORDER entry for an order the cloud changed (also used by the hub-push path and the
 * admin portal's online refunds).
 */
export async function recordOrderChange(
  tx: PrismaTx,
  order: { id: string; restaurantId: string; locationId: string },
): Promise<void> {
  await appendChange(tx, order.restaurantId, order.locationId, 'ORDER', order.id);
}

/**
 * Appends one RESOLUTION entry: an administrator settled an operation the location's hub pushed
 * (ADR 0014); the hub fetches the decision from `/sync/resolutions/:operationId`.
 */
export async function recordResolutionChange(
  tx: PrismaTx,
  issue: { operationId: string; restaurantId: string; locationId: string },
): Promise<void> {
  await appendChange(tx, issue.restaurantId, issue.locationId, 'RESOLUTION', issue.operationId);
}

async function appendChange(
  tx: PrismaTx,
  restaurantId: string,
  locationId: string,
  topic: 'ORDER' | 'RESOLUTION',
  entityId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM (SELECT pg_advisory_xact_lock(
      hashtextextended(${`change_log:${restaurantId}`}, 0))) AS locked`;
  await tx.changeLog.create({ data: { restaurantId, locationId, topic, entityId } });
}
