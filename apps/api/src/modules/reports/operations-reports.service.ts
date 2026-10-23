import { Injectable } from '@nestjs/common';
import { Prisma } from '@pos/database';
import { shareBps, shiftCashSummary } from '@pos/domain';
import { PrismaService } from '@pos/server';
import type { PaymentReport, PrepTimeReport, ShiftReport } from '@pos/validation';
import {
  ALL_CHANNELS,
  type Channel,
  type ReportContext,
  int,
  reportFilter,
} from './report-context';

type Sum = bigint | null;
type MethodType = PaymentReport['rows'][number]['methodType'];

/** Prep-time statistics over `report_kitchen_tickets k`, in whole seconds. */
const PREP_STATS = Prisma.sql`
  COUNT(*)::bigint AS tickets,
  ROUND(AVG(k.prep_seconds))::bigint AS avg_prep,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY k.prep_seconds))::bigint AS median_prep,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY k.prep_seconds))::bigint AS p90_prep,
  ROUND(MAX(k.prep_seconds))::bigint AS max_prep,
  ROUND(AVG(k.wait_seconds))::bigint AS avg_wait,
  COUNT(*) FILTER (WHERE k.is_late)::bigint AS late`;

const movement = () => ({ charges: 0, chargeCount: 0, refunds: 0, refundCount: 0, net: 0 });

/**
 * Money and kitchen reports (ADR 0015): payments by method and channel on the day the money
 * moved, shifts opened in the period, and kitchen prep times per station.
 */
@Injectable()
export class OperationsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async payments(ctx: ReportContext): Promise<PaymentReport> {
    const [byMethod, byChannel] = await Promise.all([
      this.prisma.$queryRaw<
        {
          payment_method_id: string;
          method_type: MethodType;
          name_en: string;
          name_ar: string;
          charges: Sum;
          charge_count: Sum;
          refunds: Sum;
          refund_count: Sum;
          rounding: Sum;
        }[]
      >`
        SELECT p.payment_method_id, p.method_type::text AS method_type,
          (array_agg(p.method_name_en ORDER BY p.created_at DESC))[1] AS name_en,
          (array_agg(p.method_name_ar ORDER BY p.created_at DESC))[1] AS name_ar,
          SUM(p.amount) FILTER (WHERE p.type = 'CHARGE')::bigint AS charges,
          COUNT(*) FILTER (WHERE p.type = 'CHARGE')::bigint AS charge_count,
          SUM(p.amount) FILTER (WHERE p.type = 'REFUND')::bigint AS refunds,
          COUNT(*) FILTER (WHERE p.type = 'REFUND')::bigint AS refund_count,
          SUM(p.rounding_adjustment) FILTER (WHERE p.type = 'CHARGE')::bigint AS rounding
        FROM report_payments p
        WHERE ${reportFilter(ctx, 'p')}
        GROUP BY p.payment_method_id, p.method_type
        ORDER BY name_en`,
      this.prisma.$queryRaw<
        {
          channel: Channel;
          charges: Sum;
          charge_count: Sum;
          refunds: Sum;
          refund_count: Sum;
        }[]
      >`
        SELECT p.channel::text AS channel,
          SUM(p.amount) FILTER (WHERE p.type = 'CHARGE')::bigint AS charges,
          COUNT(*) FILTER (WHERE p.type = 'CHARGE')::bigint AS charge_count,
          SUM(p.amount) FILTER (WHERE p.type = 'REFUND')::bigint AS refunds,
          COUNT(*) FILTER (WHERE p.type = 'REFUND')::bigint AS refund_count
        FROM report_payments p
        WHERE ${reportFilter(ctx, 'p')}
        GROUP BY p.channel`,
    ]);
    const money = (r: { charges: Sum; charge_count: Sum; refunds: Sum; refund_count: Sum }) => ({
      charges: int(r.charges),
      chargeCount: int(r.charge_count),
      refunds: int(r.refunds),
      refundCount: int(r.refund_count),
      net: int(r.charges) - int(r.refunds),
    });
    const rows = byMethod.map((r) => ({
      paymentMethodId: r.payment_method_id,
      methodType: r.method_type,
      nameEn: r.name_en,
      nameAr: r.name_ar,
      ...money(r),
      roundingAdjustment: int(r.rounding),
    }));
    const totals = rows.reduce(
      (t, r) => ({
        charges: t.charges + r.charges,
        chargeCount: t.chargeCount + r.chargeCount,
        refunds: t.refunds + r.refunds,
        refundCount: t.refundCount + r.refundCount,
        net: t.net + r.net,
        roundingAdjustment: t.roundingAdjustment + r.roundingAdjustment,
      }),
      { ...movement(), roundingAdjustment: 0 },
    );
    return {
      ...ctx.header,
      rows,
      byChannel: (ctx.channels ?? ALL_CHANNELS).map((channel) => {
        const found = byChannel.find((c) => c.channel === channel);
        return { channel, ...(found ? money(found) : movement()) };
      }),
      totals,
    };
  }

  async shifts(ctx: ReportContext): Promise<ShiftReport> {
    const shifts = await this.prisma.$queryRaw<
      {
        id: string;
        location_id: string;
        business_date: string;
        cash_register_id: string;
        register_name_en: string;
        register_name_ar: string;
        status: 'OPEN' | 'CLOSED';
        opened_at: Date;
        closed_at: Date | null;
        opened_by_name: string | null;
        closed_by_name: string | null;
        opening_float: number;
        expected_cash: number | null;
        counted_cash: number | null;
        cash_difference: number | null;
      }[]
    >`
      SELECT sh.id, sh.location_id,
        ((sh.opened_at AT TIME ZONE l.timezone)::date)::text AS business_date,
        sh.cash_register_id, cr.name_en AS register_name_en, cr.name_ar AS register_name_ar,
        sh.status::text AS status, sh.opened_at, sh.closed_at,
        ou.display_name AS opened_by_name, cu.display_name AS closed_by_name,
        sh.opening_float, sh.expected_cash, sh.counted_cash, sh.cash_difference
      FROM shifts sh
      JOIN locations l ON l.id = sh.location_id
      JOIN cash_registers cr ON cr.id = sh.cash_register_id
      LEFT JOIN users ou ON ou.id = sh.opened_by_id
      LEFT JOIN users cu ON cu.id = sh.closed_by_id
      WHERE sh.tenant_id = ${ctx.tenantId}::uuid
        AND sh.location_id = ANY(${ctx.locationIds}::uuid[])
        AND (sh.opened_at AT TIME ZONE l.timezone)::date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
      ORDER BY sh.opened_at DESC, sh.id`;
    const ids = shifts.map((s) => s.id);
    const [cash, payments, orders] = await Promise.all([
      this.prisma.$queryRaw<{ shift_id: string; type: string; amount: Sum }[]>`
        SELECT c.shift_id, c.type::text AS type, SUM(c.amount)::bigint AS amount
        FROM cash_transactions c
        WHERE c.shift_id = ANY(${ids}::uuid[])
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<
        {
          shift_id: string;
          payment_method_id: string;
          method_type: MethodType;
          name_en: string;
          name_ar: string;
          charges: Sum;
          refunds: Sum;
        }[]
      >`
        SELECT p.shift_id, p.payment_method_id, p.method_type::text AS method_type,
          (array_agg(p.method_name_en ORDER BY p.created_at DESC))[1] AS name_en,
          (array_agg(p.method_name_ar ORDER BY p.created_at DESC))[1] AS name_ar,
          SUM(p.amount) FILTER (WHERE p.type = 'CHARGE')::bigint AS charges,
          SUM(p.amount) FILTER (WHERE p.type = 'REFUND')::bigint AS refunds
        FROM payments p
        WHERE p.shift_id = ANY(${ids}::uuid[]) AND p.status = 'CAPTURED'
        GROUP BY p.shift_id, p.payment_method_id, p.method_type
        ORDER BY name_en`,
      this.prisma.$queryRaw<{ shift_id: string; orders: Sum }[]>`
        SELECT p.shift_id, COUNT(DISTINCT p.order_id)::bigint AS orders
        FROM payments p
        WHERE p.shift_id = ANY(${ids}::uuid[]) AND p.status = 'CAPTURED' AND p.type = 'CHARGE'
        GROUP BY 1`,
    ]);

    const rows: ShiftReport['rows'] = shifts.map((s) => {
      const summary = shiftCashSummary(
        s.opening_float,
        cash
          .filter((c) => c.shift_id === s.id)
          .map((c) => ({
            type: c.type as 'SALE' | 'REFUND' | 'PAY_IN' | 'PAY_OUT',
            amount: int(c.amount),
          })),
      );
      const byMethod = payments
        .filter((p) => p.shift_id === s.id)
        .map((p) => ({
          paymentMethodId: p.payment_method_id,
          methodType: p.method_type,
          nameEn: p.name_en,
          nameAr: p.name_ar,
          charges: int(p.charges),
          refunds: int(p.refunds),
          net: int(p.charges) - int(p.refunds),
        }));
      const charges = byMethod.reduce((a, m) => a + m.charges, 0);
      const refunds = byMethod.reduce((a, m) => a + m.refunds, 0);
      const closed = s.status === 'CLOSED';
      return {
        shiftId: s.id,
        locationId: s.location_id,
        businessDate: s.business_date,
        cashRegisterId: s.cash_register_id,
        cashRegisterNameEn: s.register_name_en,
        cashRegisterNameAr: s.register_name_ar,
        status: s.status,
        openedAt: s.opened_at.toISOString(),
        openedByName: s.opened_by_name ?? '',
        closedAt: s.closed_at ? s.closed_at.toISOString() : null,
        closedByName: closed ? (s.closed_by_name ?? '') : null,
        openingFloat: s.opening_float,
        cashSales: summary.cashSales,
        cashRefunds: summary.cashRefunds,
        payIns: summary.payIns,
        payOuts: summary.payOuts,
        // A closed shift keeps what was expected when it closed.
        expectedCash: closed && s.expected_cash !== null ? s.expected_cash : summary.expectedCash,
        countedCash: closed ? s.counted_cash : null,
        cashDifference: closed ? s.cash_difference : null,
        charges,
        refunds,
        netCollected: charges - refunds,
        orders: int(orders.find((o) => o.shift_id === s.id)?.orders),
        byMethod,
      };
    });
    const sum = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((a, r) => a + pick(r), 0);
    return {
      ...ctx.header,
      // Shifts belong to drawers, not to channels.
      channels: null,
      rows,
      totals: {
        shifts: rows.length,
        openShifts: rows.filter((r) => r.status === 'OPEN').length,
        openingFloat: sum((r) => r.openingFloat),
        cashSales: sum((r) => r.cashSales),
        cashRefunds: sum((r) => r.cashRefunds),
        payIns: sum((r) => r.payIns),
        payOuts: sum((r) => r.payOuts),
        expectedCash: sum((r) => r.expectedCash),
        cashDifference: sum((r) => r.cashDifference ?? 0),
        charges: sum((r) => r.charges),
        refunds: sum((r) => r.refunds),
        netCollected: sum((r) => r.netCollected),
        orders: sum((r) => r.orders),
      },
    };
  }

  async prepTimes(ctx: ReportContext): Promise<PrepTimeReport> {
    type Stats = {
      tickets: Sum;
      avg_prep: Sum;
      median_prep: Sum;
      p90_prep: Sum;
      max_prep: Sum;
      avg_wait: Sum;
      late: Sum;
    };
    const [stations, perStation, overall] = await Promise.all([
      this.prisma.kitchenStation.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.$queryRaw<(Stats & { station_id: string })[]>`
        SELECT k.station_id, ${PREP_STATS}
        FROM report_kitchen_tickets k
        WHERE ${reportFilter(ctx, 'k')}
        GROUP BY k.station_id`,
      this.prisma.$queryRaw<Stats[]>`
        SELECT ${PREP_STATS}
        FROM report_kitchen_tickets k
        WHERE ${reportFilter(ctx, 'k')}`,
    ]);
    const figures = (s: Stats | undefined) => {
      const tickets = int(s?.tickets);
      const late = int(s?.late);
      return {
        tickets,
        averagePrepSeconds: int(s?.avg_prep),
        medianPrepSeconds: int(s?.median_prep),
        p90PrepSeconds: int(s?.p90_prep),
        maxPrepSeconds: int(s?.max_prep),
        averageWaitSeconds: int(s?.avg_wait),
        lateTickets: late,
        lateShareBps: shareBps(late, tickets),
      };
    };
    return {
      ...ctx.header,
      rows: stations
        .map((station) => ({
          station,
          stats: perStation.find((p) => p.station_id === station.id),
        }))
        // Archived stations only while they still have tickets in the period.
        .filter(({ station, stats: s }) => station.archivedAt === null || s !== undefined)
        .map(({ station, stats: s }) => ({
          stationId: station.id,
          code: station.code,
          nameEn: station.nameEn,
          nameAr: station.nameAr,
          ...figures(s),
        })),
      totals: figures(overall[0]),
    };
  }
}
