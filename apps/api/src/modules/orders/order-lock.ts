import { DomainError } from '@pos/domain';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Locks the order row for the rest of the transaction (SELECT … FOR UPDATE). Payments and kitchen
 * actions take it so concurrent terminals and stations serialize on the order they change.
 */
export async function lockOrderRow(
  tx: PrismaTx,
  locationId: string,
  orderId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders WHERE id = ${orderId}::uuid AND location_id = ${locationId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new DomainError('ORDER_NOT_FOUND', 'Order not found', { orderId });
}
