import { Injectable } from '@nestjs/common';
import { newId } from '@pos/domain';
import { type ChangeRecorder, type ChangeSet, type PrismaTx } from '@pos/server';
import { type HubTx, asHubTx } from '../database/hub-database';

/** Full aggregate rows: the cloud upserts exactly what the hub stored (docs/sync.md). */
const orderAggregate = {
  items: { include: { modifiers: true } },
  taxes: true,
  discounts: true,
  statusHistory: true,
  payments: true,
} as const;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as object;

/**
 * Writes every change the hub makes to its outbox (`sync_operations`) inside the same transaction,
 * so a change and its outbox row are committed — or rolled back — together. Phase 6 sends them.
 */
@Injectable()
export class OutboxRecorder implements ChangeRecorder {
  async record(tx: PrismaTx, changes: ChangeSet): Promise<void> {
    const db = asHubTx(tx);
    for (const id of new Set(changes.orderIds)) {
      const order = await db.order.findUnique({ where: { id }, include: orderAggregate });
      if (order) await this.write(db, 'Order', id, 'ORDER_UPSERT', order.version, order);
    }
    for (const id of new Set(changes.shiftIds)) {
      const shift = await db.shift.findUnique({ where: { id }, include: { cash: true } });
      if (shift) await this.write(db, 'Shift', id, 'SHIFT_UPSERT', null, shift);
    }
    for (const id of new Set(changes.ticketIds)) {
      const ticket = await db.kitchenTicket.findUnique({ where: { id }, include: { items: true } });
      if (ticket) {
        await this.write(db, 'KitchenTicket', id, 'KITCHEN_TICKET_UPSERT', ticket.version, ticket);
      }
    }
  }

  private async write(
    db: HubTx,
    entityType: string,
    entityId: string,
    operationType: string,
    version: number | null,
    payload: unknown,
  ): Promise<void> {
    // Entities without a version column get a per-entity sequence, which the cloud uses to drop
    // stale or repeated upserts.
    const entityVersion =
      version ?? (await db.syncOperation.count({ where: { entityType, entityId } })) + 1;
    await db.syncOperation.create({
      data: {
        operationId: newId(),
        entityType,
        entityId,
        operationType,
        entityVersion,
        payload: json(payload),
      },
    });
  }
}
