import { Injectable } from '@nestjs/common';
import { averageMinor, businessDatesInRange, shareBps, splitRefund } from '@pos/domain';
import { PrismaService } from '@pos/server';
import type {
  CategoryReport,
  ChannelReport,
  DailySalesReport,
  DiscountReport,
  ProductReport,
  RefundFigures,
  SalesFigures,
  TaxReport,
} from '@pos/validation';
import {
  ALL_CHANNELS,
  type Channel,
  type ReportContext,
  int,
  reportFilter,
} from './report-context';

type Sum = bigint | null;

/** Sales figures of one business date and channel, before deriving averages. */
interface Cell {
  date: string;
  channel: Channel;
  orders: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  tax: number;
  fees: number;
  totalSales: number;
  cancelledOrders: number;
  refunds: RefundFigures;
}

interface RefundRow {
  business_date: string;
  channel: Channel;
  amount: number;
  tax_inclusive: boolean;
  order_total: number;
  order_fee_total: number;
  order_taxes: { taxId: string; rateBps: number; amount: number; nameEn: string; nameAr: string }[];
}

const noRefunds = (): RefundFigures => ({ count: 0, amount: 0, tax: 0, fees: 0, netSales: 0 });

function addRefunds(a: RefundFigures, b: RefundFigures): RefundFigures {
  return {
    count: a.count + b.count,
    amount: a.amount + b.amount,
    tax: a.tax + b.tax,
    fees: a.fees + b.fees,
    netSales: a.netSales + b.netSales,
  };
}

/** Adds cells up and derives the figures that are not sums. */
function figures(cells: readonly Cell[]): SalesFigures {
  const sum = (pick: (c: Cell) => number) => cells.reduce((acc, c) => acc + pick(c), 0);
  const refunds = cells.reduce((acc, c) => addRefunds(acc, c.refunds), noRefunds());
  const orders = sum((c) => c.orders);
  const netSales = sum((c) => c.netSales);
  const tax = sum((c) => c.tax);
  return {
    orders,
    grossSales: sum((c) => c.grossSales),
    discounts: sum((c) => c.discounts),
    netSales,
    tax,
    fees: sum((c) => c.fees),
    totalSales: sum((c) => c.totalSales),
    averageNetSale: averageMinor(netSales, orders),
    refunds,
    netSalesAfterRefunds: netSales - refunds.netSales,
    taxAfterRefunds: tax - refunds.tax,
    cancelledOrders: sum((c) => c.cancelledOrders),
  };
}

/**
 * Sales reports (ADR 0015) over the `report_*` views: daily sales, orders by channel, product,
 * category, tax and discount summaries. SQL filters and sums; refunds are split into tax, fees
 * and net sales with `splitRefund` from `@pos/domain`, in proportion to the refunded order.
 */
@Injectable()
export class SalesReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dailySales(ctx: ReportContext): Promise<DailySalesReport> {
    const cells = await this.cells(ctx);
    return {
      ...ctx.header,
      rows: businessDatesInRange(ctx.from, ctx.to).map((businessDate) => ({
        businessDate,
        ...figures(cells.filter((c) => c.date === businessDate)),
      })),
      totals: figures(cells),
    };
  }

  async channels(ctx: ReportContext): Promise<ChannelReport> {
    const cells = await this.cells(ctx);
    const totals = figures(cells);
    return {
      ...ctx.header,
      rows: (ctx.channels ?? ALL_CHANNELS).map((channel) => {
        const row = figures(cells.filter((c) => c.channel === channel));
        return { channel, ...row, shareBps: shareBps(row.netSales, totals.netSales) };
      }),
      totals,
    };
  }

  async products(ctx: ReportContext): Promise<ProductReport> {
    const rows = await this.prisma.$queryRaw<
      {
        product_id: string;
        variant_id: string | null;
        name_en: string;
        name_ar: string;
        variant_name_en: string | null;
        variant_name_ar: string | null;
        category_id: string;
        category_name_en: string;
        category_name_ar: string;
        quantity: Sum;
        orders: Sum;
        gross: Sum;
        discounts: Sum;
        tax: Sum;
        net: Sum;
      }[]
    >`
      SELECT i.product_id, i.variant_id, c.id AS category_id,
        c.name_en AS category_name_en, c.name_ar AS category_name_ar,
        (array_agg(i.name_en ORDER BY s.business_date DESC, i.created_at DESC))[1] AS name_en,
        (array_agg(i.name_ar ORDER BY s.business_date DESC, i.created_at DESC))[1] AS name_ar,
        (array_agg(i.variant_name_en ORDER BY s.business_date DESC, i.created_at DESC))[1]
          AS variant_name_en,
        (array_agg(i.variant_name_ar ORDER BY s.business_date DESC, i.created_at DESC))[1]
          AS variant_name_ar,
        SUM(i.quantity)::bigint AS quantity, COUNT(DISTINCT i.order_id)::bigint AS orders,
        SUM(i.gross)::bigint AS gross, SUM(i.discount)::bigint AS discounts,
        SUM(i.tax)::bigint AS tax, SUM(i.total - i.tax)::bigint AS net
      FROM report_sales_orders s
      JOIN order_items i ON i.order_id = s.id
      JOIN products p ON p.id = i.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE ${reportFilter(ctx, 's')}
      GROUP BY i.product_id, i.variant_id, c.id
      ORDER BY net DESC, quantity DESC, name_en`;
    const [totals] = await this.lineTotals(ctx);
    const totalNet = int(totals?.net);
    return {
      ...ctx.header,
      rows: rows.map((r) => ({
        productId: r.product_id,
        variantId: r.variant_id,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        variantNameEn: r.variant_name_en,
        variantNameAr: r.variant_name_ar,
        categoryId: r.category_id,
        categoryNameEn: r.category_name_en,
        categoryNameAr: r.category_name_ar,
        quantity: int(r.quantity),
        orders: int(r.orders),
        grossSales: int(r.gross),
        discounts: int(r.discounts),
        tax: int(r.tax),
        netSales: int(r.net),
        shareBps: shareBps(int(r.net), totalNet),
      })),
      totals: this.lineTotalFigures(totals),
    };
  }

  async categories(ctx: ReportContext): Promise<CategoryReport> {
    const rows = await this.prisma.$queryRaw<
      {
        category_id: string;
        name_en: string;
        name_ar: string;
        products: Sum;
        quantity: Sum;
        orders: Sum;
        gross: Sum;
        discounts: Sum;
        tax: Sum;
        net: Sum;
      }[]
    >`
      SELECT c.id AS category_id, c.name_en, c.name_ar,
        COUNT(DISTINCT i.product_id)::bigint AS products,
        SUM(i.quantity)::bigint AS quantity, COUNT(DISTINCT i.order_id)::bigint AS orders,
        SUM(i.gross)::bigint AS gross, SUM(i.discount)::bigint AS discounts,
        SUM(i.tax)::bigint AS tax, SUM(i.total - i.tax)::bigint AS net
      FROM report_sales_orders s
      JOIN order_items i ON i.order_id = s.id
      JOIN products p ON p.id = i.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE ${reportFilter(ctx, 's')}
      GROUP BY c.id
      ORDER BY net DESC, c.name_en`;
    const [totals] = await this.lineTotals(ctx);
    const totalNet = int(totals?.net);
    return {
      ...ctx.header,
      rows: rows.map((r) => ({
        categoryId: r.category_id,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        products: int(r.products),
        quantity: int(r.quantity),
        orders: int(r.orders),
        grossSales: int(r.gross),
        discounts: int(r.discounts),
        tax: int(r.tax),
        netSales: int(r.net),
        shareBps: shareBps(int(r.net), totalNet),
      })),
      totals: this.lineTotalFigures(totals),
    };
  }

  async taxes(ctx: ReportContext): Promise<TaxReport> {
    const [sales, refunds, taxedOrders] = await Promise.all([
      this.prisma.$queryRaw<
        {
          tax_id: string;
          rate_bps: number;
          tax_inclusive: boolean;
          name_en: string;
          name_ar: string;
          orders: Sum;
          taxable: Sum;
          tax: Sum;
        }[]
      >`
        SELECT t.tax_id, t.rate_bps, s.tax_inclusive,
          (array_agg(t.name_en ORDER BY s.business_date DESC))[1] AS name_en,
          (array_agg(t.name_ar ORDER BY s.business_date DESC))[1] AS name_ar,
          COUNT(DISTINCT s.id)::bigint AS orders,
          SUM(t.taxable_amount)::bigint AS taxable, SUM(t.amount)::bigint AS tax
        FROM report_sales_orders s
        JOIN order_taxes t ON t.order_id = s.id
        WHERE ${reportFilter(ctx, 's')}
        GROUP BY t.tax_id, t.rate_bps, s.tax_inclusive`,
      this.refundRows(ctx),
      this.prisma.$queryRaw<{ orders: Sum }[]>`
        SELECT COUNT(DISTINCT s.id)::bigint AS orders
        FROM report_sales_orders s
        JOIN order_taxes t ON t.order_id = s.id
        WHERE ${reportFilter(ctx, 's')} AND t.amount > 0`,
    ]);

    type Row = TaxReport['rows'][number];
    const rows = new Map<string, Row>();
    const keyOf = (taxId: string, rateBps: number, inclusive: boolean) =>
      `${taxId}:${String(rateBps)}:${String(inclusive)}`;
    for (const s of sales) {
      const tax = int(s.tax);
      rows.set(keyOf(s.tax_id, s.rate_bps, s.tax_inclusive), {
        taxId: s.tax_id,
        nameEn: s.name_en,
        nameAr: s.name_ar,
        rateBps: s.rate_bps,
        taxInclusive: s.tax_inclusive,
        orders: int(s.orders),
        taxableAmount: int(s.taxable),
        tax,
        refundedTax: 0,
        netTax: tax,
      });
    }
    for (const r of refunds) {
      const split = splitRefund(r.amount, {
        total: r.order_total,
        taxes: r.order_taxes.map((t) => t.amount),
        fees: r.order_fee_total,
      });
      r.order_taxes.forEach((t, i) => {
        const part = split.taxes[i] ?? 0;
        const key = keyOf(t.taxId, t.rateBps, r.tax_inclusive);
        const row = rows.get(key) ?? {
          taxId: t.taxId,
          nameEn: t.nameEn,
          nameAr: t.nameAr,
          rateBps: t.rateBps,
          taxInclusive: r.tax_inclusive,
          orders: 0,
          taxableAmount: 0,
          tax: 0,
          refundedTax: 0,
          netTax: 0,
        };
        row.refundedTax += part;
        row.netTax = row.tax - row.refundedTax;
        rows.set(key, row);
      });
    }
    const list = [...rows.values()].sort(
      (a, b) =>
        a.nameEn.localeCompare(b.nameEn) ||
        a.rateBps - b.rateBps ||
        Number(a.taxInclusive) - Number(b.taxInclusive),
    );
    const sum = (pick: (r: Row) => number) => list.reduce((acc, r) => acc + pick(r), 0);
    return {
      ...ctx.header,
      rows: list,
      totals: {
        orders: int(taxedOrders[0]?.orders),
        tax: sum((r) => r.tax),
        refundedTax: sum((r) => r.refundedTax),
        netTax: sum((r) => r.netTax),
      },
    };
  }

  async discounts(ctx: ReportContext): Promise<DiscountReport> {
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<
        {
          discount_id: string;
          type: 'PERCENTAGE' | 'FIXED';
          value: number;
          name_en: string;
          name_ar: string;
          applications: Sum;
          orders: Sum;
          amount: Sum;
        }[]
      >`
        SELECT d.discount_id, d.type::text AS type, d.value,
          (array_agg(d.name_en ORDER BY d.created_at DESC))[1] AS name_en,
          (array_agg(d.name_ar ORDER BY d.created_at DESC))[1] AS name_ar,
          COUNT(*)::bigint AS applications, COUNT(DISTINCT d.order_id)::bigint AS orders,
          SUM(d.amount)::bigint AS amount
        FROM report_sales_orders s
        JOIN order_discounts d ON d.order_id = s.id
        WHERE ${reportFilter(ctx, 's')}
        GROUP BY d.discount_id, d.type, d.value
        ORDER BY amount DESC, name_en`,
      this.prisma.$queryRaw<{ orders: Sum; applications: Sum; amount: Sum; gross: Sum }[]>`
        SELECT
          (SELECT COUNT(DISTINCT d.order_id) FROM order_discounts d
             WHERE d.order_id IN (SELECT s.id FROM report_sales_orders s
                                  WHERE ${reportFilter(ctx, 's')}))::bigint AS orders,
          (SELECT COUNT(*) FROM order_discounts d
             WHERE d.order_id IN (SELECT s.id FROM report_sales_orders s
                                  WHERE ${reportFilter(ctx, 's')}))::bigint AS applications,
          (SELECT SUM(s.discount_total) FROM report_sales_orders s
             WHERE ${reportFilter(ctx, 's')})::bigint AS amount,
          (SELECT SUM(s.subtotal) FROM report_sales_orders s
             WHERE ${reportFilter(ctx, 's')})::bigint AS gross`,
    ]);
    const t = totals[0];
    const amount = int(t?.amount);
    const grossSales = int(t?.gross);
    return {
      ...ctx.header,
      rows: rows.map((r) => ({
        discountId: r.discount_id,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        type: r.type,
        value: r.value,
        applications: int(r.applications),
        orders: int(r.orders),
        amount: int(r.amount),
      })),
      totals: {
        applications: int(t?.applications),
        orders: int(t?.orders),
        amount,
        grossSales,
        shareOfGrossBps: shareBps(amount, grossSales),
      },
    };
  }

  // --- building blocks ---------------------------------------------------------------------------

  /** Sales, cancellations and refunds per business date and channel. */
  private async cells(ctx: ReportContext): Promise<Cell[]> {
    const [sales, cancelled, refunds] = await Promise.all([
      this.prisma.$queryRaw<
        {
          business_date: string;
          channel: Channel;
          orders: Sum;
          gross: Sum;
          discounts: Sum;
          net: Sum;
          tax: Sum;
          fees: Sum;
          total: Sum;
        }[]
      >`
        SELECT s.business_date::text AS business_date, s.channel::text AS channel,
          COUNT(*)::bigint AS orders, SUM(s.subtotal)::bigint AS gross,
          SUM(s.discount_total)::bigint AS discounts, SUM(s.net_sales)::bigint AS net,
          SUM(s.tax_total)::bigint AS tax, SUM(s.fee_total)::bigint AS fees,
          SUM(s.total)::bigint AS total
        FROM report_sales_orders s
        WHERE ${reportFilter(ctx, 's')}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ business_date: string; channel: Channel; orders: Sum }[]>`
        SELECT o.business_date::text AS business_date, o.channel::text AS channel,
          COUNT(*)::bigint AS orders
        FROM orders o
        WHERE ${reportFilter(ctx, 'o')} AND o.status = 'CANCELLED'
        GROUP BY 1, 2`,
      this.refundRows(ctx),
    ]);

    const cells = new Map<string, Cell>();
    const cell = (date: string, channel: Channel): Cell => {
      const key = `${date}:${channel}`;
      let entry = cells.get(key);
      if (!entry) {
        entry = {
          date,
          channel,
          orders: 0,
          grossSales: 0,
          discounts: 0,
          netSales: 0,
          tax: 0,
          fees: 0,
          totalSales: 0,
          cancelledOrders: 0,
          refunds: noRefunds(),
        };
        cells.set(key, entry);
      }
      return entry;
    };
    for (const s of sales) {
      Object.assign(cell(s.business_date, s.channel), {
        orders: int(s.orders),
        grossSales: int(s.gross),
        discounts: int(s.discounts),
        netSales: int(s.net),
        tax: int(s.tax),
        fees: int(s.fees),
        totalSales: int(s.total),
      });
    }
    for (const c of cancelled) cell(c.business_date, c.channel).cancelledOrders = int(c.orders);
    for (const r of refunds) {
      const split = splitRefund(r.amount, {
        total: r.order_total,
        taxes: r.order_taxes.map((t) => t.amount),
        fees: r.order_fee_total,
      });
      const entry = cell(r.business_date, r.channel);
      entry.refunds = addRefunds(entry.refunds, {
        count: 1,
        amount: r.amount,
        tax: split.taxes.reduce((a, b) => a + b, 0),
        fees: split.fees,
        netSales: split.netSales,
      });
    }
    return [...cells.values()];
  }

  /** Refunds of sales made in the period (by the refund's business date). */
  private refundRows(ctx: ReportContext): Promise<RefundRow[]> {
    return this.prisma.$queryRaw<RefundRow[]>`
      SELECT r.business_date::text AS business_date, r.channel::text AS channel, r.amount,
        r.tax_inclusive, r.order_total, r.order_fee_total, r.order_taxes
      FROM report_refunds r
      WHERE ${reportFilter(ctx, 'r')}
      ORDER BY r.id`;
  }

  private lineTotals(ctx: ReportContext) {
    return this.prisma.$queryRaw<
      {
        quantity: Sum;
        orders: Sum;
        gross: Sum;
        discounts: Sum;
        tax: Sum;
        net: Sum;
      }[]
    >`
      SELECT SUM(i.quantity)::bigint AS quantity, COUNT(DISTINCT i.order_id)::bigint AS orders,
        SUM(i.gross)::bigint AS gross, SUM(i.discount)::bigint AS discounts,
        SUM(i.tax)::bigint AS tax, SUM(i.total - i.tax)::bigint AS net
      FROM report_sales_orders s
      JOIN order_items i ON i.order_id = s.id
      WHERE ${reportFilter(ctx, 's')}`;
  }

  private lineTotalFigures(
    t: Awaited<ReturnType<SalesReportsService['lineTotals']>>[number] | undefined,
  ) {
    const net = int(t?.net);
    return {
      quantity: int(t?.quantity),
      orders: int(t?.orders),
      grossSales: int(t?.gross),
      discounts: int(t?.discounts),
      tax: int(t?.tax),
      netSales: net,
      shareBps: net === 0 ? 0 : 10_000,
    };
  }
}
