-- CreateEnum
CREATE TYPE "kitchen_ticket_status" AS ENUM ('NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('NORMAL', 'RUSH');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "kds_late_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "kds_warn_minutes" INTEGER NOT NULL DEFAULT 8;

-- CreateTable
CREATE TABLE "kitchen_tickets" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "status" "kitchen_ticket_status" NOT NULL DEFAULT 'NEW',
    "priority" "ticket_priority" NOT NULL DEFAULT 'NORMAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "dismissed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_ticket_items" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "variant_name_en" TEXT,
    "variant_name_ar" TEXT,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "modifiers" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "kitchen_ticket_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_tickets_location_id_status_idx" ON "kitchen_tickets"("location_id", "status");

-- CreateIndex
CREATE INDEX "kitchen_tickets_location_id_updated_at_idx" ON "kitchen_tickets"("location_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_tickets_order_id_station_id_key" ON "kitchen_tickets"("order_id", "station_id");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_ticket_id_idx" ON "kitchen_ticket_items"("ticket_id");

-- CreateIndex
CREATE INDEX "kitchen_ticket_items_order_item_id_idx" ON "kitchen_ticket_items"("order_item_id");

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "kitchen_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
