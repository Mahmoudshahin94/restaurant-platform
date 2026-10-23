-- MADAR Phase 2 (ADR 0018): modules. Checked by hand: two new tables, nothing rebuilt. The rows
-- arrive with the snapshot; the cloud keeps the scope check constraint (one override per scope).
-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "tenant_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "entitled" BOOLEAN NOT NULL,
    "tenant_configurable" BOOLEAN NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("tenant_id", "feature"),
    CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "feature_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "location_id" TEXT,
    "device_id" TEXT,
    "scope" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "feature_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feature_overrides_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feature_overrides_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "feature_overrides_location_id_idx" ON "feature_overrides"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_overrides_tenant_id_scope_feature_key" ON "feature_overrides"("tenant_id", "scope", "feature");

