-- MADAR Phase 8 (ADR 0024): payment configuration. Provider accounts say which provider takes a
-- method for the whole tenant or one location; they are configuration (change feed, snapshot).
-- Their secrets are sealed by the API (AES-256-GCM envelope) and stay in the cloud.
-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "provider_account_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "provider_account_id" UUID;

-- CreateTable
CREATE TABLE "payment_provider_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID,
    "method" TEXT NOT NULL,
    "provider_key" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "public_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_secrets" (
    "account_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key_version" INTEGER NOT NULL,
    "wrapped_key" BYTEA NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_provider_secrets_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE INDEX "payment_provider_accounts_tenant_id_method_idx" ON "payment_provider_accounts"("tenant_id", "method");

-- CreateIndex
CREATE INDEX "payment_provider_accounts_location_id_idx" ON "payment_provider_accounts"("location_id");

-- CreateIndex
CREATE INDEX "payment_provider_secrets_tenant_id_idx" ON "payment_provider_secrets"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_provider_secrets_key_version_idx" ON "payment_provider_secrets"("key_version");

-- CreateIndex
CREATE INDEX "payment_methods_provider_account_id_idx" ON "payment_methods"("provider_account_id");

-- CreateIndex
CREATE INDEX "payments_provider_account_id_idx" ON "payments"("provider_account_id");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "payment_provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_account_id_fkey" FOREIGN KEY ("provider_account_id") REFERENCES "payment_provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_accounts" ADD CONSTRAINT "payment_provider_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_accounts" ADD CONSTRAINT "payment_provider_accounts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_secrets" ADD CONSTRAINT "payment_provider_secrets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "payment_provider_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_secrets" ADD CONSTRAINT "payment_provider_secrets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The vocabulary of @pos/shared-types (stored as text, like the website's domains).
ALTER TABLE "payment_provider_accounts" ADD CONSTRAINT "payment_provider_accounts_values_check" CHECK (
  "method" IN ('CASH', 'CARD', 'ONLINE', 'TERMINAL')
  AND "mode" IN ('TEST', 'LIVE')
  AND "status" IN ('ACTIVE', 'DISABLED')
  AND "provider_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  AND jsonb_typeof("public_config") = 'object'
);

-- One ACTIVE account per tenant, method and scope (the tenant, or one location). Disabled
-- accounts stay (their payments name them), so switching providers is: disable, then add.
CREATE UNIQUE INDEX "payment_provider_accounts_active_key" ON "payment_provider_accounts" (
  "tenant_id",
  "method",
  (COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid))
) WHERE "status" = 'ACTIVE';

-- A sealed secret is never empty: a key version, a wrapped data key and a ciphertext.
ALTER TABLE "payment_provider_secrets" ADD CONSTRAINT "payment_provider_secrets_shape_check" CHECK (
  "key_version" > 0
  AND octet_length("wrapped_key") = 60
  AND octet_length("ciphertext") > 28
  AND "fingerprint" ~ '^[0-9a-f]{12}$'
);

-- Change feed (ADR 0012): an account change reaches the tenant's hubs like any configuration.
-- Secrets need none: they never leave the cloud.
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON payment_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
