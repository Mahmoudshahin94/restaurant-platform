-- MADAR Phase 1 (ADR 0017): the hub's copy of the tenant root is renamed like the cloud's.
-- Renames, not the drop-and-copy Prisma generates, so a paired hub keeps its data. SQLite
-- updates the foreign keys that point at a renamed table or column; indexes cannot be renamed,
-- so they are dropped and created again.
ALTER TABLE "restaurants" RENAME TO "tenants";
ALTER TABLE "audit_logs" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "categories" RENAME COLUMN "restaurant_id" TO "tenant_id";
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
ALTER TABLE "products" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "roles" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "shifts" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "taxes" RENAME COLUMN "restaurant_id" TO "tenant_id";
ALTER TABLE "users" RENAME COLUMN "restaurant_id" TO "tenant_id";

DROP INDEX "audit_logs_restaurant_id_created_at_idx";
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
DROP INDEX "categories_restaurant_id_sort_order_idx";
CREATE INDEX "categories_tenant_id_sort_order_idx" ON "categories"("tenant_id", "sort_order");
DROP INDEX "discounts_restaurant_id_idx";
CREATE INDEX "discounts_tenant_id_idx" ON "discounts"("tenant_id");
DROP INDEX "employees_restaurant_id_employee_code_key";
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");
DROP INDEX "kitchen_stations_restaurant_id_code_key";
CREATE UNIQUE INDEX "kitchen_stations_tenant_id_code_key" ON "kitchen_stations"("tenant_id", "code");
DROP INDEX "locations_restaurant_id_idx";
CREATE INDEX "locations_tenant_id_idx" ON "locations"("tenant_id");
DROP INDEX "locations_restaurant_id_code_key";
CREATE UNIQUE INDEX "locations_tenant_id_code_key" ON "locations"("tenant_id", "code");
DROP INDEX "modifier_groups_restaurant_id_idx";
CREATE INDEX "modifier_groups_tenant_id_idx" ON "modifier_groups"("tenant_id");
DROP INDEX "payment_methods_restaurant_id_idx";
CREATE INDEX "payment_methods_tenant_id_idx" ON "payment_methods"("tenant_id");
DROP INDEX "products_restaurant_id_category_id_sort_order_idx";
CREATE INDEX "products_tenant_id_category_id_sort_order_idx" ON "products"("tenant_id", "category_id", "sort_order");
DROP INDEX "products_restaurant_id_sku_key";
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");
DROP INDEX "roles_restaurant_id_name_key";
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");
DROP INDEX "taxes_restaurant_id_idx";
CREATE INDEX "taxes_tenant_id_idx" ON "taxes"("tenant_id");
DROP INDEX "users_restaurant_id_idx";
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");
DROP INDEX "restaurants_slug_key";
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- The hub's pairing record names its tenant too (hub_state, JSON).
UPDATE "hub_state"
SET "value" = json_set(json_remove("value", '$.restaurantId'), '$.tenantId', json_extract("value", '$.restaurantId'))
WHERE "key" = 'pairing' AND json_extract("value", '$.restaurantId') IS NOT NULL;
