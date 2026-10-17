import { Injectable } from '@nestjs/common';
import { newId } from '@pos/domain';
import { type ChangeRecorder, type ChangeSet, type PrismaTx } from '@pos/server';
import { type HubTx, asHubTx } from '../database/hub-database';
import { OutboxSignal } from './outbox-signal';

/**
 * Full aggregate rows: the cloud stores exactly what the hub stored (docs/sync.md). A payment's
 * cash movements travel with it, so an order never waits for its shift's next upload.
 */
const orderAggregate = {
  items: { include: { modifiers: true } },
  taxes: true,
  discounts: true,
  statusHistory: true,
  payments: { include: { cash: true } },
} as const;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as object;

/**
 * Writes every change the hub makes to its outbox (`sync_operations`) inside the same transaction,
 * so a change and its outbox row are committed — or rolled back — together. The sync engine sends
 * them (ADR 0012).
 */
@Injectable()
export class OutboxRecorder implements ChangeRecorder {
  constructor(private readonly signal: OutboxSignal) {}

  async record(tx: PrismaTx, changes: ChangeSet): Promise<void> {
    const db = asHubTx(tx);
    for (const id of new Set(changes.orderIds)) {
      const order = await db.order.findUnique({ where: { id }, include: orderAggregate });
      if (order) await this.write(db, 'Order', id, 'ORDER_UPSERT', order);
    }
    for (const id of new Set(changes.shiftIds)) {
      const shift = await db.shift.findUnique({ where: { id }, include: { cash: true } });
      if (shift) await this.write(db, 'Shift', id, 'SHIFT_UPSERT', shift);
    }
    for (const id of new Set(changes.ticketIds)) {
      const ticket = await db.kitchenTicket.findUnique({ where: { id }, include: { items: true } });
      if (ticket) await this.write(db, 'KitchenTicket', id, 'KITCHEN_TICKET_UPSERT', ticket);
    }
    this.signal.raise();
  }

  private async write(
    db: HubTx,
    entityType: string,
    entityId: string,
    operationType: string,
    payload: unknown,
  ): Promise<void> {
    // A per-entity sequence of the hub's changes: the cloud refuses one that goes backwards. Not
    // the row's own `version`, which some changes (a second partial payment) do not bump.
    const last = await db.syncOperation.aggregate({
      where: { entityType, entityId },
      _max: { entityVersion: true },
    });
    const entityVersion = (last._max.entityVersion ?? 0) + 1;
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
