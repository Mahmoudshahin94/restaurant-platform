/**
 * Demo sales history for the development seed (`SEED_DEMO_ORDERS=1`): thirty business days of paid
 * orders per branch, so the organization dashboard and the reports show data. Everything derives
 * from the tenant, branch code, day and order number (no randomness): ids are deterministic, a
 * branch-day that exists is left alone, so seeding twice yields the same orders. Orders are
 * priced by the shared pricing engine and written straight to the database (the API cannot
 * back-date them), like the report test fixture.
 */
import { createHash } from 'node:crypto';
import { businessDateFor, formatOrderNumber, priceOrder } from '@pos/domain';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Business days seeded, counting today. */
export const DEMO_ORDER_DAYS = 30;

const DAY_MS = 86_400_000;
const OPENING_FLOAT = 20_000;

/** A number in [0, modulo) derived from `key`: the seed's replacement for randomness. */
function pick(key: string, modulo: number): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) % modulo;
}

/** A stable UUID (version 5 layout) for `key`. */
function stableId(key: string): string {
  const h = createHash('sha1').update(key).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `date` (YYYY-MM-DD) moved by `days`. */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** How far `timeZone` is ahead of UTC at `instant` (ms). */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return local - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the wall clock of `timeZone` shows `date` at `minutes` past midnight. */
function localInstant(date: string, minutes: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  return new Date(wall - zoneOffset(wall - zoneOffset(wall, timeZone), timeZone));
}

export interface DemoOrdersResult {
  /** Orders written by this run. */
  created: number;
  /** Branch-days that already had their orders. */
  skippedDays: number;
}

/**
 * Seeds the demo orders of every branch of a tenant. Needs the tenant's catalog, a cash and a
 * card tender and a drawer per branch (the demo brands have them) and a user to open the shifts;
 * a tenant without them is skipped (returns null).
 */
export async function seedDemoOrders(
  prisma: PrismaClient,
  tenant: { id: string; slug: string },
  now = new Date(),
): Promise<DemoOrdersResult | null> {
  const [tenantRow, locations, products, methods, opener] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenant.id },
      select: { currencyCode: true },
    }),
    prisma.location.findMany({
      where: { tenantId: tenant.id },
      orderBy: { code: 'asc' },
      include: { cashRegisters: { orderBy: { id: 'asc' }, take: 1 } },
    }),
    prisma.product.findMany({
      where: { tenantId: tenant.id, archivedAt: null },
      orderBy: [{ sku: 'asc' }, { id: 'asc' }],
      include: { taxes: { include: { tax: true } } },
    }),
    prisma.paymentMethod.findMany({
      where: { tenantId: tenant.id, archivedAt: null, type: { in: ['CASH', 'CARD'] } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.user.findFirst({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    }),
  ]);
  const cash = methods.find((m) => m.type === 'CASH');
  const card = methods.find((m) => m.type === 'CARD');
  if (!cash || !card || products.length === 0 || !opener) return null;

  const result: DemoOrdersResult = { created: 0, skippedDays: 0 };
  for (const location of locations) {
    const register = location.cashRegisters[0];
    if (!register) continue;
    const today = businessDateFor(now, location.timezone);
    // A busier branch has a larger code hash; the same branch is always as busy.
    const busyness = pick(`${tenant.slug}/${location.code}`, 4);
    for (let back = DEMO_ORDER_DAYS - 1; back >= 0; back -= 1) {
      const date = shiftDate(today, -back);
      const key = `${tenant.slug}/${location.code}/${date}`;
      const count = 6 + busyness + pick(`${key}/count`, 7);
      const step = 720 / count;

      const orders = [];
      for (let n = 1; n <= count; n += 1) {
        // 09:00 to 21:00 local, in order, so a day in progress keeps the orders placed so far.
        const minutes =
          9 * 60 + Math.floor((n - 1) * step) + pick(`${key}/${n}/at`, Math.floor(step));
        const placedAt = localInstant(date, minutes, location.timezone);
        if (placedAt > now) break;
        orders.push({ n, placedAt, id: stableId(`${key}/${n}`) });
      }
      if (orders.length === 0) continue;
      const first = orders[0];
      if (first && (await prisma.order.count({ where: { id: first.id } })) > 0) {
        result.skippedDays += 1;
        continue;
      }

      const rows = {
        orders: [] as Prisma.OrderCreateManyInput[],
        items: [] as Prisma.OrderItemCreateManyInput[],
        taxes: [] as Prisma.OrderTaxCreateManyInput[],
        payments: [] as Prisma.PaymentCreateManyInput[],
        cash: [] as Prisma.CashTransactionCreateManyInput[],
      };
      const shiftId = stableId(`${key}/shift`);
      let cashTotal = 0;
      for (const { n, placedAt, id } of orders) {
        const lineCount = 1 + pick(`${key}/${n}/lines`, 3);
        const start = pick(`${key}/${n}/product`, products.length);
        const lines = Array.from({ length: lineCount }, (_, i) => {
          const product = products[(start + i) % products.length];
          if (!product) throw new Error('No product to order');
          return {
            lineId: stableId(`${id}/line/${i}`),
            product,
            quantity: 1 + pick(`${key}/${n}/quantity/${String(i)}`, 3),
          };
        });
        const priced = priceOrder({
          taxInclusive: location.taxInclusive,
          lines: lines.map((l) => ({
            lineId: l.lineId,
            unitPrice: l.product.price,
            quantity: l.quantity,
            taxes: l.product.taxes.map((t) => ({ taxId: t.taxId, rateBps: t.tax.rateBps })),
          })),
          discounts: [],
          fees: [],
        });
        rows.orders.push({
          id,
          tenantId: tenant.id,
          locationId: location.id,
          orderNumber: formatOrderNumber(location.code, n),
          businessDate: new Date(`${date}T00:00:00Z`),
          channel: pick(`${key}/${n}/channel`, 3) === 0 ? 'TAKEAWAY' : 'DINE_IN',
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          source: 'POS',
          currencyCode: tenantRow.currencyCode,
          taxInclusive: location.taxInclusive,
          subtotal: priced.subtotal,
          discountTotal: priced.discount,
          taxTotal: priced.tax,
          feeTotal: priced.fees,
          total: priced.total,
          placedAt,
          completedAt: new Date(placedAt.getTime() + 15 * 60_000),
          createdAt: placedAt,
        });
        lines.forEach((l, i) => {
          const p = priced.lines[i];
          if (!p) throw new Error('Pricing returned fewer lines than ordered');
          rows.items.push({
            id: l.lineId,
            orderId: id,
            productId: l.product.id,
            nameEn: l.product.nameEn,
            nameAr: l.product.nameAr,
            sku: l.product.sku,
            quantity: l.quantity,
            basePrice: l.product.price,
            unitPrice: l.product.price,
            gross: p.gross,
            discount: p.discount,
            tax: p.tax,
            total: p.total,
            sortOrder: i,
            createdAt: placedAt,
          });
        });
        for (const t of priced.taxBreakdown) {
          const tax = lines.flatMap((l) => l.product.taxes).find((x) => x.taxId === t.taxId)?.tax;
          if (!tax) continue;
          rows.taxes.push({
            orderId: id,
            taxId: t.taxId,
            nameEn: tax.nameEn,
            nameAr: tax.nameAr,
            rateBps: t.rateBps,
            taxableAmount: t.taxableAmount,
            amount: t.amount,
          });
        }
        const method = pick(`${key}/${n}/method`, 3) === 0 ? cash : card;
        const paymentId = stableId(`${id}/payment`);
        const isCash = method.type === 'CASH';
        rows.payments.push({
          id: paymentId,
          tenantId: tenant.id,
          locationId: location.id,
          orderId: id,
          shiftId,
          paymentMethodId: method.id,
          methodType: method.type,
          methodNameEn: method.nameEn,
          methodNameAr: method.nameAr,
          type: 'CHARGE',
          status: 'CAPTURED',
          provider: isCash ? 'cash' : 'external-card',
          amount: priced.total,
          tendered: isCash ? priced.total : null,
          createdAt: placedAt,
        });
        if (isCash) {
          cashTotal += priced.total;
          rows.cash.push({
            id: stableId(`${paymentId}/cash`),
            shiftId,
            type: 'SALE',
            amount: priced.total,
            paymentId,
            createdAt: placedAt,
          });
        }
      }

      const closedAt = new Date(
        Math.min(localInstant(date, 22 * 60, location.timezone).getTime(), now.getTime()),
      );
      await prisma.$transaction(async (tx) => {
        await tx.shift.create({
          data: {
            id: shiftId,
            tenantId: tenant.id,
            locationId: location.id,
            cashRegisterId: register.id,
            status: 'CLOSED',
            openRegisterId: null,
            openingFloat: OPENING_FLOAT,
            openedById: opener.id,
            openedAt: localInstant(date, 8 * 60 + 30, location.timezone),
            closedById: opener.id,
            closedAt,
            expectedCash: OPENING_FLOAT + cashTotal,
            countedCash: OPENING_FLOAT + cashTotal,
            cashDifference: 0,
          },
        });
        await tx.order.createMany({ data: rows.orders });
        await tx.orderItem.createMany({ data: rows.items });
        await tx.orderTax.createMany({ data: rows.taxes });
        await tx.payment.createMany({ data: rows.payments });
        await tx.cashTransaction.createMany({ data: rows.cash });
        // Orders taken later at the branch carry on from the last number of the day.
        await tx.orderCounter.upsert({
          where: {
            locationId_businessDate: {
              locationId: location.id,
              businessDate: new Date(`${date}T00:00:00Z`),
            },
          },
          create: {
            locationId: location.id,
            businessDate: new Date(`${date}T00:00:00Z`),
            lastNumber: orders.length,
          },
          update: { lastNumber: orders.length },
        });
      });
      result.created += orders.length;
    }
  }
  return result;
}
