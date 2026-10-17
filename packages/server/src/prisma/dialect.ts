import { DomainError } from '@pos/domain';
import type { PrismaTx } from './prisma.service';

/**
 * The few operations that need database-specific SQL. Everything else goes through the Prisma
 * API, which behaves the same on PostgreSQL (cloud) and SQLite (location hub).
 */
export abstract class SqlDialect {
  /**
   * Serializes concurrent changes to one order (payments, kitchen actions) for the rest of the
   * transaction. Throws ORDER_NOT_FOUND when the order is not at this location.
   */
  abstract lockOrderRow(tx: PrismaTx, locationId: string, orderId: string): Promise<void>;

  /** Atomically allocates the next order number for a location's business day (YYYY-MM-DD). */
  abstract nextOrderNumber(tx: PrismaTx, locationId: string, businessDate: string): Promise<number>;
}

const notFound = (orderId: string) =>
  new DomainError('ORDER_NOT_FOUND', 'Order not found', { orderId });

export class PostgresDialect extends SqlDialect {
  async lockOrderRow(tx: PrismaTx, locationId: string, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE id = ${orderId}::uuid AND location_id = ${locationId}::uuid FOR UPDATE`;
    if (rows.length !== 1) throw notFound(orderId);
  }

  async nextOrderNumber(tx: PrismaTx, locationId: string, businessDate: string): Promise<number> {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO order_counters (location_id, business_date, last_number)
      VALUES (${locationId}::uuid, ${businessDate}::date, 1)
      ON CONFLICT (location_id, business_date)
      DO UPDATE SET last_number = order_counters.last_number + 1
      RETURNING last_number`;
    const value = rows[0]?.last_number;
    if (value === undefined)
      throw new DomainError('INTERNAL_ERROR', 'Could not allocate order number');
    return value;
  }
}

/**
 * The hub opens SQLite with a single connection, so interactive transactions already run one at a
 * time: there are no row locks to take, and a read-modify-write inside a transaction is atomic.
 */
export class SqliteDialect extends SqlDialect {
  async lockOrderRow(tx: PrismaTx, locationId: string, orderId: string): Promise<void> {
    const found = await tx.order.count({ where: { id: orderId, locationId } });
    if (found !== 1) throw notFound(orderId);
  }

  async nextOrderNumber(tx: PrismaTx, locationId: string, businessDate: string): Promise<number> {
    const date = new Date(`${businessDate}T00:00:00Z`);
    const row = await tx.orderCounter.upsert({
      where: { locationId_businessDate: { locationId, businessDate: date } },
      create: { locationId, businessDate: date, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return row.lastNumber;
  }
}
