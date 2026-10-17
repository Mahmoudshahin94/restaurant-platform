-- CreateEnum
CREATE TYPE "processed_operation_status" AS ENUM ('APPLIED', 'CONFLICT', 'REJECTED');

-- CreateEnum
CREATE TYPE "change_topic" AS ENUM ('CONFIG');

-- CreateTable
CREATE TABLE "processed_operations" (
    "operation_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "operation_type" TEXT NOT NULL,
    "entity_version" INTEGER NOT NULL,
    "row_version" INTEGER,
    "status" "processed_operation_status" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "processed_operations_pkey" PRIMARY KEY ("operation_id")
);

-- CreateTable
CREATE TABLE "change_log" (
    "seq" BIGSERIAL NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID,
    "topic" "change_topic" NOT NULL,
    "entity_id" UUID,
    "tx_id" BIGINT NOT NULL DEFAULT txid_current(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "processed_operations_entity_type_entity_id_status_idx" ON "processed_operations"("entity_type", "entity_id", "status");

-- CreateIndex
CREATE INDEX "processed_operations_location_id_status_updated_at_idx" ON "processed_operations"("location_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "change_log_restaurant_id_seq_idx" ON "change_log"("restaurant_id", "seq");

-- One CONFIG entry per restaurant and transaction, however many rows the transaction touched.
CREATE UNIQUE INDEX "change_log_config_once_per_tx" ON "change_log" ("restaurant_id", "tx_id")
  WHERE "topic" = 'CONFIG';

-- Restaurant a configuration row belongs to, by how the table references it.
CREATE FUNCTION change_log_restaurant(kind text, r jsonb) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE kind
    WHEN 'restaurant' THEN (r->>'id')::uuid
    WHEN 'self' THEN (r->>'restaurant_id')::uuid
    WHEN 'role' THEN (SELECT restaurant_id FROM roles WHERE id = (r->>'role_id')::uuid)
    WHEN 'user' THEN (SELECT restaurant_id FROM users WHERE id = (r->>'user_id')::uuid)
    WHEN 'modifier_group' THEN
      (SELECT restaurant_id FROM modifier_groups WHERE id = (r->>'modifier_group_id')::uuid)
    WHEN 'product' THEN (SELECT restaurant_id FROM products WHERE id = (r->>'product_id')::uuid)
    WHEN 'location' THEN (SELECT restaurant_id FROM locations WHERE id = (r->>'location_id')::uuid)
  END
$$;

-- Records a CONFIG change for the restaurant of the written row (ADR 0012).
--   TG_ARGV[0]  how to find the restaurant (see change_log_restaurant)
--   TG_ARGV[1:] columns whose changes alone are not configuration changes
-- The advisory lock is held until commit, so within a restaurant `seq` order is commit order and
-- a hub's cursor can never pass a change that is still being committed.
CREATE FUNCTION record_config_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  old_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  ignored text[] := array_append(TG_ARGV[1:], 'updated_at');
  rid uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (new_row - ignored) = (old_row - ignored) THEN
    RETURN NULL;
  END IF;
  rid := change_log_restaurant(TG_ARGV[0], coalesce(new_row, old_row));
  IF rid IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('change_log:' || rid::text, 0));
  INSERT INTO change_log (restaurant_id, topic) VALUES (rid, 'CONFIG')
    ON CONFLICT (restaurant_id, tx_id) WHERE topic = 'CONFIG' DO NOTHING;
  RETURN NULL;
END
$$;

-- Every table of the location snapshot (packages/validation SNAPSHOT_TABLES).
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION record_config_change('restaurant');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON locations
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION record_config_change('role');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self', 'last_login_at');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION record_config_change('user');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON taxes
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON kitchen_stations
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON modifier_groups
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON modifiers
  FOR EACH ROW EXECUTE FUNCTION record_config_change('modifier_group');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION record_config_change('product');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_modifier_groups
  FOR EACH ROW EXECUTE FUNCTION record_config_change('product');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_stations
  FOR EACH ROW EXECUTE FUNCTION record_config_change('product');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_taxes
  FOR EACH ROW EXECUTE FUNCTION record_config_change('product');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON location_products
  FOR EACH ROW EXECUTE FUNCTION record_config_change('location');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON discounts
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON table_sections
  FOR EACH ROW EXECUTE FUNCTION record_config_change('location');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON dining_tables
  FOR EACH ROW EXECUTE FUNCTION record_config_change('location');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON cash_registers
  FOR EACH ROW EXECUTE FUNCTION record_config_change('location');
