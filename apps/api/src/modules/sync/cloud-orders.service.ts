import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { PrismaService } from '@pos/server';
import { type SyncOrder, syncOrderSchema } from '@pos/validation';
import type { AuthenticatedDevice } from '../devices/device.guard';

/** The order aggregate exactly as hubs exchange it (the outbox payload shape, ADR 0012). */
export const orderAggregate = {
  items: { include: { modifiers: true } },
  taxes: true,
  discounts: true,
  statusHistory: true,
  payments: { include: { cash: true } },
} as const;

/**
 * Serves orders the cloud announced on its change feed (`ORDER` topic) to the location's hub, in
 * the same shape the hub pushes, so the hub can store them with one code path (ADR 0013).
 */
@Injectable()
export class CloudOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async aggregate(device: AuthenticatedDevice, orderId: string): Promise<SyncOrder> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: orderAggregate,
    });
    // Another location's order looks exactly like a missing one.
    if (!row || row.locationId !== device.locationId) {
      throw new DomainError('ORDER_NOT_FOUND', 'Order not found', { orderId });
    }
    // JSON round trip: dates become ISO strings, as in the hub's outbox.
    return syncOrderSchema.parse(JSON.parse(JSON.stringify(row)));
  }
}
