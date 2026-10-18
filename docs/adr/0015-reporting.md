# ADR 0015: Reporting: SQL views in the cloud, what counts as a sale, and how refunds net out

- Status: Accepted (2026-10-18)

## Context

Phase 9 adds the specification's initial reports: daily sales, orders by channel, payment
summary, product sales, category sales, tax summary, discount summary and shift summary, each
distinguishing the channels `DINE_IN`, `TAKEAWAY`, `PHONE`, `WEBSITE` and `DELIVERY`. The
specification says not to build an analytics warehouse in V1 and to use PostgreSQL queries or
views. Phase 8 left two gaps for this phase: daily and shift reports beyond the small dashboard,
and kitchen prep-time reporting.

Reports must agree with each other and with the pricing engine (ADR 0002), and they have to
settle questions the earlier phases did not: which orders are sales, on which day a refund
counts, and how a refund (money only; it names no lines) reduces tax and net sales.

## Decision

### Where reports run

- **Cloud only.** A `CloudReportsModule` in `apps/api` (`/restaurants/:rid/reports/<name>`,
  `reports.view`). The cloud holds every location's synchronized history; the hub keeps only the
  shift-close daily summary it already had (`GET /locations/:lid/reports/daily-summary`,
  `shifts.manage`), which is an operational "X report" and stays as it is.
- **Views, not copies.** A migration creates four PostgreSQL views that hold the shared
  definitions, and each report filters and sums them with parameterized SQL (`$queryRaw`):
  - `report_sales_orders`: orders that are sales, with `net_sales`;
  - `report_payments`: captured payments with the business date they happened on and the order's
    channel;
  - `report_refunds`: refunds of sales, with the refunded order's total, fees and per-tax amounts;
  - `report_kitchen_tickets`: tickets that reached READY, with prep and wait seconds and whether
    they were late.
    Prisma does not model views, so there is no schema drift, no new Prisma model or enum, and the
    hub schema (and its contract test) is unchanged. Existing indexes cover the filters
    (`orders(location_id, business_date)`, `payments(location_id, created_at)`,
    `kitchen_tickets(order_id, station_id)`).
- **Scope:** every report covers the locations where the caller holds `reports.view`; a
  `locationIds` filter narrows that and answers `404 LOCATION_NOT_FOUND` for any other location
  (as for other tenants'). One restaurant has one currency, so amounts add up across locations.
- **Period:** `from`/`to` business dates (inclusive, at most 366 days). The business date is the
  calendar date in each location's time zone, as for order numbers: orders carry it already;
  payments and shifts get it from `created_at`/`opened_at AT TIME ZONE location.timezone`.
- **Channels:** every report except the shift summary takes a `channels` filter (the order's
  channel); orders by channel lists all five channels (or the requested ones), including empty
  ones; the payment summary also groups money by channel.

### What counts

- **Sales are completed orders**: status `COMPLETED`, or `REFUNDED` (a completed order refunded
  in full afterwards; Phase 3). Drafts, orders still open (`PLACED` … `READY`, even when already
  paid) and cancelled orders are not sales. Cancelled orders are counted separately for
  reference. A sale belongs to its business date (the order's day, also when it was handed over
  after midnight).
- **Figures** come from the order as the pricing engine stored it:
  `grossSales` = Σ subtotal (line prices as charged, so including tax at tax-inclusive locations),
  `discounts`, `tax`, `fees`, `totalSales` = Σ total (what customers pay), and
  `netSales = total − tax − fees`: the revenue without tax and fees, after discounts. That one
  formula holds for tax-inclusive and tax-exclusive locations alike, so they add up. Averages and
  shares are rounded half away from zero (`averageMinor`, `shareBps`).
- **Refunds count on the day they were made**, against the refunded order's channel, so a closed
  day's figures do not change later; they are reported next to the sales (count and amount) and
  subtracted to give `netSalesAfterRefunds` and `taxAfterRefunds`.
- **A refund is split in proportion to the order it refunds** (`splitRefund` in `@pos/domain`):
  over each of the order's taxes, its fees and its net sales, by largest remainder, so the parts
  always sum to the refund and refunding a whole order gives back exactly its tax, fees and net
  sales. The tax summary uses the same split per tax (`refundedTax`, `netTax`).
- **Refunds of orders that were then cancelled** give back a prepayment, not a sale: they appear
  in the payment and shift reports (money did move) but not in sales.
- **Payment summary** is money, not sales: captured charges and refunds per payment method (names
  as recorded on the payments) and per channel, dated by the day the money moved, including online
  payments (no drawer) and prepayments of orders still open or later cancelled. Cash rounding is
  shown separately. Over a period in which every sale is closed and paid, `totalSales − refunds`
  equals the payment summary's net; the integration tests check this.
- **Product and category sales** use the order lines of sales: quantity, line gross, the
  discount allocated to the line, line tax and net (`line total − line tax`). Their net adds up to
  the sales' net sales when fees are untaxed (all fees today). Refunds are not assigned to
  products (they name no lines). Product names are the latest snapshot on the lines; the category
  is the product's current one (categories are not snapshotted on lines).
- **Tax summary**: per tax, rate and price mode (tax included or added), from the order's tax
  breakdown: taxable amount (excluding the tax), tax, refunded tax and net tax. A rate change
  shows as a separate row; taxable amounts are not added across taxes.
- **Discount summary**: per discount as applied (type and value), times applied, orders and
  amount, with the share of gross sales.
- **Shift summary**: shifts opened in the period with the drawer's opening cash, cash sales and
  refunds, pay-ins and pay-outs, expected cash (stored at close, live for an open shift, using the
  same `shiftCashSummary` as the POS), counted cash, over/short, every tender's charges and
  refunds, and orders paid. Totals add the over/short of closed shifts.
- **Kitchen prep times**: per station, tickets that reached READY (also when bumped later):
  prep time from the ticket reaching the kitchen to READY, the wait until a cook started it,
  average, median, 90th percentile and longest, and how many took longer than the location's
  "late" threshold (`kdsLateMinutes`). Cancelled tickets are not prep work. Tickets belong to their
  order's business date and channel.

### Admin portal

- A Reports section (`/reports/:report`, `reports.view` at some location) with a report picker,
  period presets (today, yesterday, last 7 days, this month, last month) or dates, a location and a
  channel filter, all kept in the URL. Each report shows headline figures, a table with a totals
  row and a CSV export; daily sales has a small single-series bar chart of net sales by day
  (the table is its accessible form). Money is formatted with `Intl.NumberFormat` from exact
  decimal strings, business dates with `Intl.DateTimeFormat` in UTC so they never shift a day.
- **CSV** is locale-free so spreadsheets read numbers: money as decimals of the currency
  (`12.500` for KWD), percentages as decimals, dates as `YYYY-MM-DD`, with a UTF-8 BOM so Excel
  reads Arabic names; it is built in the browser from the data on screen.

## Consequences

- Reports always read live data; no extract, schedule or cache can go stale, and corrections
  (refunds, late hub uploads) appear at once. Large restaurants with years of history may need
  materialized views or a reporting replica later; the views are the seam for that.
- A late upload from an offline hub changes the figures of the day it belongs to; reports are as
  complete as the cloud's copy (the dashboard's hub status tells how current that is).
- Product and category reports show what was sold, not net of refunds; refunds net out in daily
  sales, channels, taxes and payments.
- The business day is the calendar date; venues open past midnight need the configurable
  business-day start (still a known gap) for "tonight's" sales to land on one day.
