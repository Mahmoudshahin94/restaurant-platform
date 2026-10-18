-- Phase 9 reporting (ADR 0015). Cloud only: plain views over the operational tables, no copies
-- and no warehouse. They fix the definitions every report shares (which orders are sales, the
-- business date of a payment, prep time of a kitchen ticket); the reports filter and sum them.
-- Prisma does not model views, so they cause no schema drift and the hub schema is unchanged.

-- Sales: completed orders, including those refunded afterwards (refunds are reported on their
-- own date, see report_refunds). Drafts, open and cancelled orders are not sales.
-- net_sales = what the customer pays without tax and fees, after discounts; the same in
-- tax-inclusive and tax-exclusive locations.
CREATE VIEW report_sales_orders AS
SELECT
  o.id,
  o.restaurant_id,
  o.location_id,
  o.business_date,
  o.channel,
  o.tax_inclusive,
  o.subtotal,
  o.discount_total,
  o.tax_total,
  o.fee_total,
  o.total,
  o.total - o.tax_total - o.fee_total AS net_sales
FROM orders o
WHERE o.status IN ('COMPLETED', 'REFUNDED');

-- Money movements: captured charges and refunds, dated by the business day (calendar date in
-- the location's time zone) on which they happened, with the order's channel.
CREATE VIEW report_payments AS
SELECT
  p.id,
  p.restaurant_id,
  p.location_id,
  p.order_id,
  p.shift_id,
  p.payment_method_id,
  p.method_type,
  p.method_name_en,
  p.method_name_ar,
  p.type,
  p.amount,
  p.rounding_adjustment,
  p.created_at,
  (p.created_at AT TIME ZONE l.timezone)::date AS business_date,
  o.channel,
  o.status AS order_status
FROM payments p
JOIN locations l ON l.id = p.location_id
JOIN orders o ON o.id = p.order_id
WHERE p.status = 'CAPTURED';

-- Refunds of sales, on the business day they were made, with what the refunded order consisted
-- of (total, fees and per-tax amounts) so a report can split each refund into tax, fees and net
-- sales in proportion (splitRefund in @pos/domain). Refunds of orders that were then cancelled
-- give back a prepayment, not a sale: they appear in report_payments only.
CREATE VIEW report_refunds AS
SELECT
  rp.id,
  rp.restaurant_id,
  rp.location_id,
  rp.order_id,
  rp.business_date,
  rp.channel,
  rp.amount,
  o.tax_inclusive,
  o.total AS order_total,
  o.fee_total AS order_fee_total,
  COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object('taxId', t.tax_id, 'rateBps', t.rate_bps, 'amount', t.amount,
                                 'nameEn', t.name_en, 'nameAr', t.name_ar)
              ORDER BY t.tax_id)
     FROM order_taxes t
     WHERE t.order_id = o.id),
    '[]'::jsonb
  ) AS order_taxes
FROM report_payments rp
JOIN orders o ON o.id = rp.order_id
WHERE rp.type = 'REFUND' AND rp.order_status IN ('COMPLETED', 'REFUNDED');

-- Kitchen tickets that reached READY (also when later bumped), with the order's business day
-- and channel. Prep time runs from the ticket reaching the kitchen to READY; the wait from the
-- kitchen receiving it to a cook starting it. Cancelled tickets are not prep work.
CREATE VIEW report_kitchen_tickets AS
SELECT
  k.id,
  k.restaurant_id,
  k.location_id,
  k.station_id,
  k.order_id,
  o.business_date,
  o.channel,
  k.priority,
  EXTRACT(EPOCH FROM (k.ready_at - k.created_at)) AS prep_seconds,
  EXTRACT(EPOCH FROM (k.started_at - k.created_at)) AS wait_seconds,
  (k.ready_at - k.created_at) > make_interval(mins => l.kds_late_minutes) AS is_late
FROM kitchen_tickets k
JOIN orders o ON o.id = k.order_id
JOIN locations l ON l.id = k.location_id
WHERE k.ready_at IS NOT NULL AND k.status IN ('READY', 'COMPLETED');
