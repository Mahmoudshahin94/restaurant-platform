-- MADAR Phase 6 (ADR 0022): terminals paired at the hub, and payments taken by a kiosk's card
-- terminal. Written by hand as ADD COLUMNs instead of the generated copy of `payments`, so a
-- paired hub keeps its rows untouched (SQLite allows a REFERENCES clause on a NULL column).
-- AlterTable
ALTER TABLE "devices" ADD COLUMN "app_version" TEXT;
ALTER TABLE "devices" ADD COLUMN "paired_at" DATETIME;
ALTER TABLE "devices" ADD COLUMN "pairing_code_hash" TEXT;
ALTER TABLE "devices" ADD COLUMN "pairing_expires_at" DATETIME;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "device_id" TEXT REFERENCES "devices" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "payments_device_id_idx" ON "payments"("device_id");
