import { Injectable } from '@nestjs/common';
import { businessDateFor } from '@pos/domain';
import type { DailySummary } from '@pos/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { totalsByMethod } from '../shifts/shifts.service';

/**
 * End-of-day summary for one location and business day: order counts, sales totals by channel and
 * collections by payment method (payments on that day's orders). Plain queries; the reporting
 * phase adds views for history and trends.
 */
@Injectable()
export class DailySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(locationId: string, requestedDate: string | undefined): Promise<DailySummary> {
    const location = await this.prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      include: { restaurant: { select: { currencyCode: true } } },
    });
    const businessDate = requestedDate ?? businessDateFor(new Date(), location.timezone);
    const orders = await this.prisma.order.findMany({
      where: { locationId, businessDate: new Date(`${businessDate}T00:00:00Z`) },
      include: { payments: { where: { status: 'CAPTURED' } } },
    });

    const counted = orders.filter((o) => o.status !== 'CANCELLED' && o.status !== 'DRAFT');
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const channels = new Map<string, { count: number; total: number }>();
    for (const o of counted) {
      const entry = channels.get(o.channel) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += o.total;
      channels.set(o.channel, entry);
    }
    const payments = totalsByMethod(orders.flatMap((o) => o.payments));

    return {
      businessDate,
      currencyCode: location.restaurant.currencyCode,
      orders: {
        count: counted.length,
        completed: orders.filter((o) => o.status === 'COMPLETED').length,
        open: orders.filter((o) => ['PLACED', 'CONFIRMED', 'PREPARING', 'READY'].includes(o.status))
          .length,
        cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
      },
      sales: {
        subtotal: sum(counted.map((o) => o.subtotal)),
        discounts: sum(counted.map((o) => o.discountTotal)),
        tax: sum(counted.map((o) => o.taxTotal)),
        total: sum(counted.map((o) => o.total)),
      },
      byChannel: [...channels.entries()]
        .map(([channel, v]) => ({
          channel: channel as DailySummary['byChannel'][number]['channel'],
          ...v,
        }))
        .sort((a, b) => a.channel.localeCompare(b.channel)),
      payments,
      netCollected: sum(payments.map((p) => p.net)),
    };
  }
}
