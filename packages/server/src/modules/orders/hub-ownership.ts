import { DomainError } from '@pos/domain';
import type { ServerMode } from '../../common/auth/managed-in-cloud';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Whether a location hub owns this order in the cloud: the cloud has applied a change of it pushed
 * by a hub (ADR 0012), which includes website orders after the hand-over (ADR 0013). Always false
 * on the hub itself, which owns everything it serves.
 */
export async function isHubOwnedOrder(
  mode: ServerMode,
  tx: PrismaTx,
  orderId: string,
): Promise<boolean> {
  if (mode !== 'cloud') return false;
  const applied = await tx.processedOperation.findFirst({
    where: { entityType: 'Order', entityId: orderId, status: 'APPLIED' },
    select: { operationId: true },
  });
  return applied !== null;
}

/**
 * Staff changes in the cloud to an order a hub owns would be overwritten by, or conflict with, the
 * hub's next push. They are refused: the order is changed at the restaurant's POS (ADR 0014). The
 * cloud still settles online card payments, which never touch the order row's version.
 */
export async function assertCloudMayChangeOrder(
  mode: ServerMode,
  tx: PrismaTx,
  orderId: string,
): Promise<void> {
  if (await isHubOwnedOrder(mode, tx, orderId)) {
    throw new DomainError(
      'INVALID_ORDER_STATE',
      'This order belongs to the restaurant’s hub; change it at the POS',
      { reason: 'OWNED_BY_RESTAURANT' },
    );
  }
}
