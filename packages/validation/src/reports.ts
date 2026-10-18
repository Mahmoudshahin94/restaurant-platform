import { businessDaysInRange } from '@pos/domain';
import { OrderChannel, PaymentMethodType, ShiftStatus, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/*
 * Reports (Phase 9, ADR 0015): cloud only, `reports.view`, over business dates (the calendar date
 * in each location's time zone). Every amount is in integer minor units of the restaurant
 * currency.
 */

/** Longest range one request may cover (a leap year). */
export const REPORT_MAX_DAYS = 366;

export const REPORT_KINDS = [
  'daily-sales',
  'channels',
  'payments',
  'products',
  'categories',
  'taxes',
  'discounts',
  'shifts',
  'prep-times',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

const isoDate = z.iso.date();
const channelSchema = z.enum(enumValues(OrderChannel));

/** Comma-separated values in a query string (`a,b`), each checked by `item`. */
const csvOf = <T extends z.ZodType>(item: T) =>
  z
    .string()
    .optional()
    .transform((v, ctx): z.output<T>[] | undefined => {
      if (!v) return undefined;
      const parsed = z
        .array(item)
        .min(1)
        .max(50)
        .safeParse(v.split(',').map((s) => s.trim()));
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: 'Unknown value' });
        return z.NEVER;
      }
      return [...new Set(parsed.data)] as z.output<T>[];
    });

export const reportQuerySchema = z
  .object({
    /** Business dates, inclusive. */
    from: isoDate,
    to: isoDate,
    /** Defaults to every location where the caller holds `reports.view`. */
    locationIds: csvOf(idSchema),
    /** Defaults to every channel. Not used by the shift report. */
    channels: csvOf(channelSchema),
  })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to', path: ['to'] })
  .refine((q) => businessDaysInRange(q.from, q.to) <= REPORT_MAX_DAYS, {
    message: `At most ${String(REPORT_MAX_DAYS)} days`,
    path: ['from'],
  });
/** What clients send (lists as arrays; the client joins them). */
export interface ReportQuery {
  from: string;
  to: string;
  locationIds?: readonly string[];
  channels?: readonly z.infer<typeof channelSchema>[];
}

/** Echoed by every report: what was asked and in which currency the amounts are. */
const reportHeader = {
  from: isoDate,
  to: isoDate,
  currencyCode: z.string(),
  /** The locations covered (the request's, or every permitted one). */
  locationIds: z.array(idSchema),
  /** Null = every channel. */
  channels: z.array(channelSchema).nullable(),
  generatedAt: isoDateTimeSchema,
};

const int = z.int();

/** How refunds of sales split (in proportion to the refunded order). */
export const refundFiguresSchema = z.object({
  count: int,
  amount: int,
  tax: int,
  fees: int,
  netSales: int,
});
export type RefundFigures = z.infer<typeof refundFiguresSchema>;

/**
 * Sales figures. Sales are completed orders (also when refunded later) on their business date:
 * `grossSales` Σ subtotal (line prices as charged, so including tax where prices include it),
 * `discounts`, `tax`, `fees`, `totalSales` Σ total (what customers paid), `netSales` = total − tax −
 * fees. Refunds count on the day they were made and are split into tax, fees and net sales.
 */
export const salesFiguresSchema = z.object({
  orders: int,
  grossSales: int,
  discounts: int,
  netSales: int,
  tax: int,
  fees: int,
  totalSales: int,
  averageNetSale: int,
  refunds: refundFiguresSchema,
  /** netSales − refunds.netSales. */
  netSalesAfterRefunds: int,
  /** tax − refunds.tax. */
  taxAfterRefunds: int,
  /** Cancelled orders of the period (not sales; for reference). */
  cancelledOrders: int,
});
export type SalesFigures = z.infer<typeof salesFiguresSchema>;

// --- Daily sales ---------------------------------------------------------------------------------

export const dailySalesReportSchema = z.object({
  ...reportHeader,
  /** One row per business date in the range, including days without sales. */
  rows: z.array(salesFiguresSchema.extend({ businessDate: isoDate })),
  totals: salesFiguresSchema,
});
export type DailySalesReport = z.infer<typeof dailySalesReportSchema>;
export type DailySalesRow = DailySalesReport['rows'][number];

// --- Orders by channel ---------------------------------------------------------------------------

export const channelReportSchema = z.object({
  ...reportHeader,
  /** Every requested channel, in catalog order, including channels without orders. */
  rows: z.array(
    salesFiguresSchema.extend({
      channel: channelSchema,
      /** Share of the period's net sales, basis points. */
      shareBps: int,
    }),
  ),
  totals: salesFiguresSchema,
});
export type ChannelReport = z.infer<typeof channelReportSchema>;
export type ChannelReportRow = ChannelReport['rows'][number];

// --- Payment summary -----------------------------------------------------------------------------

const moneyMovementSchema = z.object({
  charges: int,
  chargeCount: int,
  refunds: int,
  refundCount: int,
  /** charges − refunds. */
  net: int,
});

export const paymentReportSchema = z.object({
  ...reportHeader,
  /** Per payment method (names as recorded on the payments), by the day the money moved. */
  rows: z.array(
    moneyMovementSchema.extend({
      paymentMethodId: idSchema,
      methodType: z.enum(enumValues(PaymentMethodType)),
      nameEn: z.string(),
      nameAr: z.string(),
      /** Cash rounding kept in the drawer (cash charges). */
      roundingAdjustment: int,
    }),
  ),
  /** The same money per order channel. */
  byChannel: z.array(moneyMovementSchema.extend({ channel: channelSchema })),
  totals: moneyMovementSchema.extend({ roundingAdjustment: int }),
});
export type PaymentReport = z.infer<typeof paymentReportSchema>;
export type PaymentReportRow = PaymentReport['rows'][number];

// --- Product and category sales ------------------------------------------------------------------

/** Line figures of sales: quantity, line gross, allocated discount, tax and net (ex tax). */
const lineFiguresSchema = z.object({
  quantity: int,
  orders: int,
  grossSales: int,
  discounts: int,
  tax: int,
  netSales: int,
  /** Share of the period's line net sales, basis points. */
  shareBps: int,
});

export const productReportSchema = z.object({
  ...reportHeader,
  /** Per product and size, best selling (by net sales) first. */
  rows: z.array(
    lineFiguresSchema.extend({
      productId: idSchema,
      variantId: idSchema.nullable(),
      nameEn: z.string(),
      nameAr: z.string(),
      variantNameEn: z.string().nullable(),
      variantNameAr: z.string().nullable(),
      categoryId: idSchema,
      categoryNameEn: z.string(),
      categoryNameAr: z.string(),
    }),
  ),
  totals: lineFiguresSchema,
});
export type ProductReport = z.infer<typeof productReportSchema>;
export type ProductReportRow = ProductReport['rows'][number];

export const categoryReportSchema = z.object({
  ...reportHeader,
  rows: z.array(
    lineFiguresSchema.extend({
      categoryId: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      /** Distinct products sold. */
      products: int,
    }),
  ),
  totals: lineFiguresSchema,
});
export type CategoryReport = z.infer<typeof categoryReportSchema>;
export type CategoryReportRow = CategoryReport['rows'][number];

// --- Tax summary ---------------------------------------------------------------------------------

const taxFiguresSchema = z.object({
  orders: int,
  /** The base the tax was computed on, excluding the tax itself. */
  taxableAmount: int,
  tax: int,
  /** The tax part of refunds of sales (in proportion to the refunded order). */
  refundedTax: int,
  netTax: int,
});

export const taxReportSchema = z.object({
  ...reportHeader,
  /** Per tax and rate (a rate change shows as a separate row), split by price mode. */
  rows: z.array(
    taxFiguresSchema.extend({
      taxId: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      rateBps: int,
      taxInclusive: z.boolean(),
    }),
  ),
  /** Bases are not added up across taxes (one order can carry several). */
  totals: taxFiguresSchema.omit({ taxableAmount: true }),
});
export type TaxReport = z.infer<typeof taxReportSchema>;
export type TaxReportRow = TaxReport['rows'][number];

// --- Discount summary ----------------------------------------------------------------------------

export const discountReportSchema = z.object({
  ...reportHeader,
  rows: z.array(
    z.object({
      discountId: idSchema,
      nameEn: z.string(),
      nameAr: z.string(),
      type: z.enum(['PERCENTAGE', 'FIXED']),
      /** Basis points for PERCENTAGE, minor units for FIXED (as applied). */
      value: int,
      /** Times applied. */
      applications: int,
      orders: int,
      amount: int,
    }),
  ),
  totals: z.object({
    applications: int,
    /** Sales with at least one discount. */
    orders: int,
    amount: int,
    /** Discounts as basis points of gross sales. */
    shareOfGrossBps: int,
    grossSales: int,
  }),
});
export type DiscountReport = z.infer<typeof discountReportSchema>;
export type DiscountReportRow = DiscountReport['rows'][number];

// --- Shift summary -------------------------------------------------------------------------------

const shiftFiguresSchema = z.object({
  openingFloat: int,
  cashSales: int,
  cashRefunds: int,
  payIns: int,
  payOuts: int,
  /** Stored at close; computed live for an open shift. */
  expectedCash: int,
  /** Closed shifts only (null while open). */
  countedCash: int.nullable(),
  /** counted − expected; negative = short. */
  cashDifference: int.nullable(),
  /** All tenders. */
  charges: int,
  refunds: int,
  netCollected: int,
  /** Orders with a charge in the shift. */
  orders: int,
});

export const shiftReportSchema = z.object({
  ...reportHeader,
  /** Shifts opened on a business date in the range, newest first. */
  rows: z.array(
    shiftFiguresSchema.extend({
      shiftId: idSchema,
      locationId: idSchema,
      businessDate: isoDate,
      cashRegisterId: idSchema,
      cashRegisterNameEn: z.string(),
      cashRegisterNameAr: z.string(),
      status: z.enum(enumValues(ShiftStatus)),
      openedAt: isoDateTimeSchema,
      openedByName: z.string(),
      closedAt: isoDateTimeSchema.nullable(),
      closedByName: z.string().nullable(),
      byMethod: z.array(
        z.object({
          paymentMethodId: idSchema,
          methodType: z.enum(enumValues(PaymentMethodType)),
          nameEn: z.string(),
          nameAr: z.string(),
          charges: int,
          refunds: int,
          net: int,
        }),
      ),
    }),
  ),
  totals: shiftFiguresSchema.omit({ countedCash: true, cashDifference: true }).extend({
    shifts: int,
    openShifts: int,
    /** Over/short of closed shifts. */
    cashDifference: int,
  }),
});
export type ShiftReport = z.infer<typeof shiftReportSchema>;
export type ShiftReportRow = ShiftReport['rows'][number];

// --- Kitchen prep times --------------------------------------------------------------------------

const prepFiguresSchema = z.object({
  /** Tickets that reached READY. */
  tickets: int,
  averagePrepSeconds: int,
  medianPrepSeconds: int,
  p90PrepSeconds: int,
  maxPrepSeconds: int,
  /** Average time from reaching the kitchen to a cook starting it (started tickets). */
  averageWaitSeconds: int,
  /** Ready later than the location's "late" threshold (kdsLateMinutes). */
  lateTickets: int,
  lateShareBps: int,
});

export const prepTimeReportSchema = z.object({
  ...reportHeader,
  rows: z.array(
    prepFiguresSchema.extend({
      stationId: idSchema,
      code: z.string(),
      nameEn: z.string(),
      nameAr: z.string(),
    }),
  ),
  totals: prepFiguresSchema,
});
export type PrepTimeReport = z.infer<typeof prepTimeReportSchema>;
export type PrepTimeReportRow = PrepTimeReport['rows'][number];
