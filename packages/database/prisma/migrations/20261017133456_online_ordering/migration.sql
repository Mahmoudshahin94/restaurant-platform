-- CreateEnum
CREATE TYPE "fulfillment_type" AS ENUM ('PICKUP', 'DELIVERY');

-- AlterEnum
ALTER TYPE "change_topic" ADD VALUE 'ORDER';

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "online_accept_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "online_delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "online_delivery_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "online_pickup_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "opening_hours" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accept_by" TIMESTAMPTZ(3),
ADD COLUMN     "customer_email" TEXT,
ADD COLUMN     "delivery_address" JSONB,
ADD COLUMN     "fulfillment_type" "fulfillment_type";

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "shift_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "web_order_counters" (
    "location_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "web_order_counters_pkey" PRIMARY KEY ("location_id","business_date")
);

-- Hand-written integrity rules (ADR 0013; enforced by the application as well).

-- Only online payments are drawer-less.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_shift_required" CHECK ("shift_id" IS NOT NULL OR "method_type" = 'ONLINE');

-- Website orders always say how they are fulfilled; deliveries carry an address.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_fulfillment_website_only"
    CHECK (("channel" = 'WEBSITE') = ("fulfillment_type" IS NOT NULL)),
  ADD CONSTRAINT "orders_delivery_has_address"
    CHECK ("fulfillment_type" IS DISTINCT FROM 'DELIVERY' OR "delivery_address" IS NOT NULL);

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_online_accept_minutes_valid"
    CHECK ("online_accept_minutes" BETWEEN 1 AND 240),
  ADD CONSTRAINT "locations_online_delivery_fee_valid" CHECK ("online_delivery_fee" >= 0),
  ADD CONSTRAINT "locations_opening_hours_array" CHECK (jsonb_typeof("opening_hours") = 'array');

ALTER TABLE "web_order_counters"
  ADD CONSTRAINT "web_order_counters_last_number_positive" CHECK ("last_number" >= 1);

-- Website orders waiting for the restaurant, for the acceptance-timeout sweep.
CREATE INDEX "orders_awaiting_acceptance_idx" ON "orders" ("accept_by")
  WHERE "status" = 'PLACED' AND "channel" = 'WEBSITE';
