-- AlterTable
ALTER TABLE "orders" ADD COLUMN "accept_by" DATETIME;
ALTER TABLE "orders" ADD COLUMN "customer_email" TEXT;
ALTER TABLE "orders" ADD COLUMN "delivery_address" JSONB;
ALTER TABLE "orders" ADD COLUMN "fulfillment_type" TEXT;

-- CreateTable
CREATE TABLE "inbound_orders" (
    "order_id" TEXT NOT NULL PRIMARY KEY,
    "cloud_version" INTEGER NOT NULL,
    "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_locations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "tax_inclusive" BOOLEAN NOT NULL,
    "online_ordering_state" TEXT NOT NULL DEFAULT 'CLOSED',
    "opening_hours" JSONB NOT NULL DEFAULT '[]',
    "online_accept_minutes" INTEGER NOT NULL DEFAULT 10,
    "online_pickup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "online_delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
    "online_delivery_fee" INTEGER NOT NULL DEFAULT 0,
    "cash_rounding_increment" INTEGER,
    "kds_warn_minutes" INTEGER NOT NULL DEFAULT 8,
    "kds_late_minutes" INTEGER NOT NULL DEFAULT 15,
    "address_line" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "locations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_locations" ("address_line", "cash_rounding_increment", "code", "created_at", "id", "is_active", "kds_late_minutes", "kds_warn_minutes", "name_ar", "name_en", "online_ordering_state", "phone", "restaurant_id", "tax_inclusive", "timezone", "updated_at") SELECT "address_line", "cash_rounding_increment", "code", "created_at", "id", "is_active", "kds_late_minutes", "kds_warn_minutes", "name_ar", "name_en", "online_ordering_state", "phone", "restaurant_id", "tax_inclusive", "timezone", "updated_at" FROM "locations";
DROP TABLE "locations";
ALTER TABLE "new_locations" RENAME TO "locations";
CREATE INDEX "locations_restaurant_id_idx" ON "locations"("restaurant_id");
CREATE UNIQUE INDEX "locations_restaurant_id_code_key" ON "locations"("restaurant_id", "code");
CREATE TABLE "new_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restaurant_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "payment_method_id" TEXT NOT NULL,
    "method_type" TEXT NOT NULL,
    "method_name_en" TEXT NOT NULL,
    "method_name_ar" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "amount" INTEGER NOT NULL,
    "tendered" INTEGER,
    "change" INTEGER NOT NULL DEFAULT 0,
    "rounding_adjustment" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "refund_of_id" TEXT,
    "reason" TEXT,
    "created_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payments_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "payments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_payments" ("amount", "change", "created_at", "created_by_id", "id", "location_id", "method_name_ar", "method_name_en", "method_type", "order_id", "payment_method_id", "provider", "provider_ref", "reason", "reference", "refund_of_id", "restaurant_id", "rounding_adjustment", "shift_id", "status", "tendered", "type", "updated_at") SELECT "amount", "change", "created_at", "created_by_id", "id", "location_id", "method_name_ar", "method_name_en", "method_type", "order_id", "payment_method_id", "provider", "provider_ref", "reason", "reference", "refund_of_id", "restaurant_id", "rounding_adjustment", "shift_id", "status", "tendered", "type", "updated_at" FROM "payments";
DROP TABLE "payments";
ALTER TABLE "new_payments" RENAME TO "payments";
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX "payments_shift_id_idx" ON "payments"("shift_id");
CREATE INDEX "payments_location_id_created_at_idx" ON "payments"("location_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

