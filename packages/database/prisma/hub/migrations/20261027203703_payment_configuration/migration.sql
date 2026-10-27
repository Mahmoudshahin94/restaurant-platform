-- MADAR Phase 8 (ADR 0024): payment provider accounts reach the hub with the snapshot (without
-- their secrets, which stay in the cloud), and tenders and payments name the account. Written by
-- hand as ADD COLUMNs instead of the generated copies of `payment_methods` and `payments`, so a
-- paired hub keeps its rows untouched (SQLite allows a REFERENCES clause on a NULL column).
-- CreateTable
CREATE TABLE "payment_provider_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "location_id" TEXT,
    "method" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "public_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "payment_provider_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_provider_accounts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN "provider_account_id" TEXT REFERENCES "payment_provider_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "provider_account_id" TEXT REFERENCES "payment_provider_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "payment_provider_accounts_tenant_id_method_idx" ON "payment_provider_accounts"("tenant_id", "method");

-- CreateIndex
CREATE INDEX "payment_provider_accounts_location_id_idx" ON "payment_provider_accounts"("location_id");

-- CreateIndex
CREATE INDEX "payment_methods_provider_account_id_idx" ON "payment_methods"("provider_account_id");

-- CreateIndex
CREATE INDEX "payments_provider_account_id_idx" ON "payments"("provider_account_id");
