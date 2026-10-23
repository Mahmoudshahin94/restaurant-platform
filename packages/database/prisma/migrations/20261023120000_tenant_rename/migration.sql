-- MADAR Phase 1 (ADR 0017): the tenant root is no longer called "restaurant". A rename, not a
-- rebuild: every row, id and reference is kept. The change-feed functions and the report views
-- read the old names, so they are replaced here as well.

-- Report views keep the output column names they were created with: drop them first and create
-- them again (below) once the columns are renamed.
DROP VIEW report_refunds;
DROP VIEW report_kitchen_tickets;
DROP VIEW report_payments;
DROP VIEW report_sales_orders;

-- The root table.
ALTER TABLE "restaurants" RENAME TO "tenants";
ALTER TABLE "tenants" RENAME CONSTRAINT "restaurants_pkey" TO "tenants_pkey";
ALTER INDEX "restaurants_slug_key" RENAME TO "tenants_slug_key";

-- Tenant columns.
ALTER TABLE "audit_logs" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "categories" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "change_log" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "devices" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "discounts" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "employees" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "kitchen_stations" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "kitchen_tickets" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "locations" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "modifier_groups" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "orders" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "payment_methods" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "payments" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "processed_operations" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "products" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "roles" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "shifts" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "taxes" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "users" RENAME COLUMN "restaurant_id" TO "tenant_id";

-- Foreign keys.
ALTER TABLE "categories" RENAME CONSTRAINT "categories_restaurant_id_fkey" TO "categories_tenant_id_fkey";
ALTER TABLE "devices" RENAME CONSTRAINT "devices_restaurant_id_fkey" TO "devices_tenant_id_fkey";
ALTER TABLE "discounts" RENAME CONSTRAINT "discounts_restaurant_id_fkey" TO "discounts_tenant_id_fkey";
ALTER TABLE "employees" RENAME CONSTRAINT "employees_restaurant_id_fkey" TO "employees_tenant_id_fkey";
ALTER TABLE "kitchen_stations" RENAME CONSTRAINT "kitchen_stations_restaurant_id_fkey" TO "kitchen_stations_tenant_id_fkey";
ALTER TABLE "kitchen_tickets" RENAME CONSTRAINT "kitchen_tickets_restaurant_id_fkey" TO "kitchen_tickets_tenant_id_fkey";
ALTER TABLE "locations" RENAME CONSTRAINT "locations_restaurant_id_fkey" TO "locations_tenant_id_fkey";
ALTER TABLE "modifier_groups" RENAME CONSTRAINT "modifier_groups_restaurant_id_fkey" TO "modifier_groups_tenant_id_fkey";
ALTER TABLE "orders" RENAME CONSTRAINT "orders_restaurant_id_fkey" TO "orders_tenant_id_fkey";
ALTER TABLE "payment_methods" RENAME CONSTRAINT "payment_methods_restaurant_id_fkey" TO "payment_methods_tenant_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "products_restaurant_id_fkey" TO "products_tenant_id_fkey";
ALTER TABLE "roles" RENAME CONSTRAINT "roles_restaurant_id_fkey" TO "roles_tenant_id_fkey";
ALTER TABLE "taxes" RENAME CONSTRAINT "taxes_restaurant_id_fkey" TO "taxes_tenant_id_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_restaurant_id_fkey" TO "users_tenant_id_fkey";

-- Indexes.
ALTER INDEX "audit_logs_restaurant_id_created_at_idx" RENAME TO "audit_logs_tenant_id_created_at_idx";
ALTER INDEX "categories_restaurant_id_sort_order_idx" RENAME TO "categories_tenant_id_sort_order_idx";
ALTER INDEX "change_log_restaurant_id_seq_idx" RENAME TO "change_log_tenant_id_seq_idx";
ALTER INDEX "discounts_restaurant_id_idx" RENAME TO "discounts_tenant_id_idx";
ALTER INDEX "employees_restaurant_id_employee_code_key" RENAME TO "employees_tenant_id_employee_code_key";
ALTER INDEX "kitchen_stations_restaurant_id_code_key" RENAME TO "kitchen_stations_tenant_id_code_key";
ALTER INDEX "locations_restaurant_id_code_key" RENAME TO "locations_tenant_id_code_key";
ALTER INDEX "locations_restaurant_id_idx" RENAME TO "locations_tenant_id_idx";
ALTER INDEX "modifier_groups_restaurant_id_idx" RENAME TO "modifier_groups_tenant_id_idx";
ALTER INDEX "payment_methods_restaurant_id_idx" RENAME TO "payment_methods_tenant_id_idx";
ALTER INDEX "products_restaurant_id_category_id_sort_order_idx" RENAME TO "products_tenant_id_category_id_sort_order_idx";
ALTER INDEX "products_restaurant_id_sku_key" RENAME TO "products_tenant_id_sku_key";
ALTER INDEX "roles_restaurant_id_name_key" RENAME TO "roles_tenant_id_name_key";
ALTER INDEX "taxes_restaurant_id_idx" RENAME TO "taxes_tenant_id_idx";
ALTER INDEX "users_restaurant_id_idx" RENAME TO "users_tenant_id_idx";

-- Change feed (ADR 0012): the tenant a configuration row belongs to, by how the table references
-- it. Replaces change_log_restaurant(); record_config_change() keeps its name, so the triggers
-- on the snapshot tables stay attached.
CREATE FUNCTION change_log_tenant(kind text, r jsonb) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE kind
    WHEN 'tenant' THEN (r->>'id')::uuid
    WHEN 'self' THEN (r->>'tenant_id')::uuid
    WHEN 'role' THEN (SELECT tenant_id FROM roles WHERE id = (r->>'role_id')::uuid)
    WHEN 'user' THEN (SELECT tenant_id FROM users WHERE id = (r->>'user_id')::uuid)
    WHEN 'modifier_group' THEN
      (SELECT tenant_id FROM modifier_groups WHERE id = (r->>'modifier_group_id')::uuid)
    WHEN 'product' THEN (SELECT tenant_id FROM products WHERE id = (r->>'product_id')::uuid)
    WHEN 'location' THEN (SELECT tenant_id FROM locations WHERE id = (r->>'location_id')::uuid)
  END
$$;

-- Records a CONFIG change for the tenant of the written row (ADR 0012).
--   TG_ARGV[0]  how to find the tenant (see change_log_tenant)
--   TG_ARGV[1:] columns whose changes alone are not configuration changes
-- The advisory lock is held until commit, so within a tenant `seq` order is commit order and
-- a hub's cursor can never pass a change that is still being committed.
CREATE OR REPLACE FUNCTION record_config_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  old_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  ignored text[] := array_append(TG_ARGV[1:], 'updated_at');
  tid uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (new_row - ignored) = (old_row - ignored) THEN
    RETURN NULL;
  END IF;
  tid := change_log_tenant(TG_ARGV[0], coalesce(new_row, old_row));
  IF tid IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('change_log:' || tid::text, 0));
  INSERT INTO change_log (tenant_id, topic) VALUES (tid, 'CONFIG')
    ON CONFLICT (tenant_id, tx_id) WHERE topic = 'CONFIG' DO NOTHING;
  RETURN NULL;
END
$$;

DROP FUNCTION change_log_restaurant(text, jsonb);

-- The root table's trigger names its lookup kind; attach it again with the new one.
DROP TRIGGER config_change ON tenants;
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON tenants
  FOR EACH ROW EXECUTE FUNCTION record_config_change('tenant');

-- Report views (ADR 0015), unchanged apart from the tenant column.
CREATE VIEW report_sales_orders AS
SELECT
  o.id,
  o.tenant_id,
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

CREATE VIEW report_payments AS
SELECT
  p.id,
  p.tenant_id,
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

CREATE VIEW report_refunds AS
SELECT
  rp.id,
  rp.tenant_id,
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

CREATE VIEW report_kitchen_tickets AS
SELECT
  k.id,
  k.tenant_id,
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
