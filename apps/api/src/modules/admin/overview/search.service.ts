import { Injectable } from '@nestjs/common';
import { Prisma } from '@pos/database';
import { DomainError } from '@pos/domain';
import { type Principal, PrismaService } from '@pos/server';
import type {
  CustomerDetail,
  CustomerSummary,
  OrderSummary,
  Paginated,
  PaymentListItem,
  customerQuerySchema,
  orderSearchQuerySchema,
  paymentSearchQuerySchema,
} from '@pos/validation';
import type { z } from 'zod';
import { dateRange, paging, permittedLocationIds } from '../scope';

const summaryInclude = { _count: { select: { items: true } } } as const;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof summaryInclude }>;

export const toOrderSummary = (o: OrderRow): OrderSummary => ({
  id: o.id,
  locationId: o.locationId,
  orderNumber: o.orderNumber,
  businessDate: o.businessDate.toISOString().slice(0, 10),
  channel: o.channel,
  status: o.status,
  paymentStatus: o.paymentStatus,
  customerName: o.customerName,
  customerPhone: o.customerPhone,
  itemCount: o._count.items,
  total: o.total,
  currencyCode: o.currencyCode,
  createdAt: o.createdAt.toISOString(),
});

const paymentInclude = {
  order: { select: { orderNumber: true, currencyCode: true } },
  refunds: { where: { status: 'CAPTURED' }, select: { amount: true } },
} as const;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export const toPaymentItem = (p: PaymentRow): PaymentListItem => ({
  id: p.id,
  locationId: p.locationId,
  orderId: p.orderId,
  orderNumber: p.order.orderNumber,
  type: p.type,
  status: p.status,
  methodType: p.methodType,
  methodNameEn: p.methodNameEn,
  methodNameAr: p.methodNameAr,
  amount: p.amount,
  reference: p.reference,
  reason: p.reason,
  refundOfId: p.refundOfId,
  refundable:
    p.type === 'CHARGE' && p.status === 'CAPTURED'
      ? p.amount - p.refunds.reduce((sum, r) => sum + r.amount, 0)
      : 0,
  currencyCode: p.order.currencyCode,
  createdAt: p.createdAt.toISOString(),
});

export const paymentListInclude = paymentInclude;

interface CustomerRow {
  key: string;
  name: string | null;
  phone: string;
  email: string | null;
  order_count: bigint;
  total_spent: bigint | null;
  first_order_at: Date;
  last_order_at: Date;
  total_count: bigint;
}

/** SQL for the customer key: a hash of the trimmed phone number (no personal data in URLs). */
const customerKey = Prisma.sql`encode(sha256(convert_to(btrim(o.customer_phone), 'UTF8')), 'hex')`;

/**
 * Searches across the caller's locations for the admin portal: orders, customers (grouped from
 * the contact details on orders; there are no customer accounts yet) and payments. Each list is
 * limited to the locations where the caller holds the list's permission.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async orders(
    principal: Principal,
    q: z.output<typeof orderSearchQuerySchema>,
  ): Promise<Paginated<OrderSummary>> {
    const locationIds = await permittedLocationIds(
      this.prisma,
      principal,
      ['orders.view'],
      q.locationId,
    );
    const where: Prisma.OrderWhereInput = {
      restaurantId: principal.restaurantId,
      locationId: { in: locationIds },
      ...(q.status ? { status: { in: q.status } } : {}),
      ...(q.channel ? { channel: { in: q.channel } } : {}),
      ...(q.paymentStatus ? { paymentStatus: { in: q.paymentStatus } } : {}),
      ...(dateRange(q.from, q.to) ? { businessDate: dateRange(q.from, q.to) } : {}),
      ...(q.search
        ? {
            OR: [
              { orderNumber: { contains: q.search, mode: 'insensitive' } },
              { customerName: { contains: q.search, mode: 'insensitive' } },
              { customerPhone: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: summaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging(q),
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map(toOrderSummary), page: q.page, pageSize: q.pageSize, total };
  }

  async customers(
    principal: Principal,
    q: z.output<typeof customerQuerySchema>,
  ): Promise<Paginated<CustomerSummary>> {
    const locationIds = await permittedLocationIds(this.prisma, principal, ['customers.view']);
    const rows = await this.customerRows(locationIds, {
      search: q.search ?? null,
      key: null,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return {
      items: rows.map(toCustomer),
      page: q.page,
      pageSize: q.pageSize,
      total: Number(rows[0]?.total_count ?? (await this.countCustomers(locationIds, q.search))),
    };
  }

  async customer(principal: Principal, key: string): Promise<CustomerDetail> {
    const locationIds = await permittedLocationIds(this.prisma, principal, ['customers.view']);
    const [row] = await this.customerRows(locationIds, { search: null, key, skip: 0, take: 1 });
    if (!row) throw new DomainError('NOT_FOUND', 'Customer not found');
    const orders = await this.prisma.order.findMany({
      where: {
        locationId: { in: locationIds },
        customerPhone: { contains: row.phone },
      },
      include: summaryInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      customer: toCustomer(row),
      // Same normalisation as the key: the trimmed phone number.
      orders: orders.filter((o) => o.customerPhone?.trim() === row.phone).map(toOrderSummary),
    };
  }

  async payments(
    principal: Principal,
    q: z.output<typeof paymentSearchQuerySchema>,
  ): Promise<Paginated<PaymentListItem>> {
    const locationIds = await permittedLocationIds(
      this.prisma,
      principal,
      ['payments.view'],
      q.locationId,
    );
    const range = dateRange(q.from, q.to);
    const where: Prisma.PaymentWhereInput = {
      restaurantId: principal.restaurantId,
      locationId: { in: locationIds },
      ...(q.type ? { type: q.type } : {}),
      ...(q.methodType ? { methodType: q.methodType } : {}),
      // Dates are the orders' business days (location time), like the order search.
      ...(range ? { order: { businessDate: range } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging(q),
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: rows.map(toPaymentItem), page: q.page, pageSize: q.pageSize, total };
  }

  private customerRows(
    locationIds: string[],
    q: { search: string | null; key: string | null; skip: number; take: number },
  ): Promise<CustomerRow[]> {
    if (locationIds.length === 0) return Promise.resolve([]);
    const like = q.search ? `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return this.prisma.$queryRaw<CustomerRow[]>`
      WITH grouped AS (
        SELECT ${customerKey} AS key,
          btrim(o.customer_phone) AS phone,
          (array_agg(o.customer_name ORDER BY o.created_at DESC)
            FILTER (WHERE o.customer_name IS NOT NULL))[1] AS name,
          (array_agg(o.customer_email ORDER BY o.created_at DESC)
            FILTER (WHERE o.customer_email IS NOT NULL))[1] AS email,
          count(*) AS order_count,
          sum(o.total) FILTER (WHERE o.status NOT IN ('CANCELLED', 'DRAFT')) AS total_spent,
          min(o.created_at) AS first_order_at,
          max(o.created_at) AS last_order_at
        FROM orders o
        WHERE o.location_id = ANY(${locationIds}::uuid[])
          AND o.customer_phone IS NOT NULL AND btrim(o.customer_phone) <> ''
        GROUP BY btrim(o.customer_phone)
      )
      SELECT g.*, count(*) OVER () AS total_count FROM grouped g
      WHERE (${like}::text IS NULL OR g.phone ILIKE ${like} OR g.name ILIKE ${like})
        AND (${q.key}::text IS NULL OR g.key = ${q.key})
      ORDER BY g.last_order_at DESC, g.key
      OFFSET ${q.skip} LIMIT ${q.take}`;
  }

  /** Total when the requested page is past the end (no row carries the window count). */
  private async countCustomers(locationIds: string[], search?: string): Promise<number> {
    const rows = await this.customerRows(locationIds, {
      search: search ?? null,
      key: null,
      skip: 0,
      take: 1,
    });
    return Number(rows[0]?.total_count ?? 0);
  }
}

function toCustomer(row: CustomerRow): CustomerSummary {
  return {
    key: row.key,
    name: row.name,
    phone: row.phone,
    email: row.email,
    orderCount: Number(row.order_count),
    totalSpent: Number(row.total_spent ?? 0),
    firstOrderAt: row.first_order_at.toISOString(),
    lastOrderAt: row.last_order_at.toISOString(),
  };
}
