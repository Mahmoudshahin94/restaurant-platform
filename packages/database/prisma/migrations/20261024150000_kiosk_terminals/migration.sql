-- MADAR Phase 6 (ADR 0022): self-service kiosks. Terminals (POS, KDS, kiosk, customer display)
-- pair with their location hub using a one-time code; kiosk orders get their own channel and
-- source; a kiosk's integrated card terminal takes payments that touch no cash drawer.

-- AlterEnum
ALTER TYPE "action_source" ADD VALUE 'KIOSK';
-- AlterEnum
ALTER TYPE "device_type" ADD VALUE 'KIOSK';
-- AlterEnum
ALTER TYPE "order_channel" ADD VALUE 'KIOSK';

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "app_version" TEXT,
ADD COLUMN     "paired_at" TIMESTAMPTZ(3),
ADD COLUMN     "pairing_code_hash" TEXT,
ADD COLUMN     "pairing_expires_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "device_id" UUID;

-- CreateIndex
CREATE INDEX "payments_device_id_idx" ON "payments"("device_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A pairing code exists only with its expiry, and only while the terminal waits to pair.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_pairing_code_check"
    CHECK (("pairing_code_hash" IS NULL) = ("pairing_expires_at" IS NULL)
      AND ("pairing_code_hash" IS NULL OR "status" = 'PENDING')),
  ADD CONSTRAINT "devices_app_version_check"
    CHECK ("app_version" IS NULL OR length("app_version") BETWEEN 1 AND 40);

-- Drawer-less payments: ONLINE (website, ADR 0013) and, now, CARD payments taken by a terminal
-- device's integrated card reader. Every other payment belongs to a cashier's shift.
ALTER TABLE "payments" DROP CONSTRAINT "payments_shift_required";
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_shift_required"
    CHECK ("shift_id" IS NOT NULL OR "method_type" = 'ONLINE'
      OR ("method_type" = 'CARD' AND "device_id" IS NOT NULL));

-- Change feed (ADR 0012): the location's devices ride the snapshot (a terminal waiting to pair
-- with its code, a disabled one locked out at its hub). What devices report as they work (last
-- contact, app version, a hub's outbox) is not configuration and changes nothing for the hub.
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self', 'last_seen_at', 'app_version', 'metadata', 'credential_hash');
