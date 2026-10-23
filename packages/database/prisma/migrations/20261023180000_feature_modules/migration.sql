-- MADAR Phase 2 (ADR 0018): modules. The platform's entitlements and the tenant's overrides
-- (tenant-wide, per location, per device). Both are configuration: they ride the hub snapshot and
-- the change feed, so a location hub enforces modules offline.
-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "tenant_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "entitled" BOOLEAN NOT NULL,
    "tenant_configurable" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("tenant_id","feature")
);

-- CreateTable
CREATE TABLE "feature_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID,
    "device_id" UUID,
    "scope" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_overrides_location_id_idx" ON "feature_overrides"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_overrides_tenant_id_scope_feature_key" ON "feature_overrides"("tenant_id", "scope", "feature");

-- AddForeignKey
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One override per scope: `scope` is derived from the ids, never chosen freely. A device's
-- override also names the device's location, so a hub's snapshot finds it by location.
ALTER TABLE "feature_overrides" ADD CONSTRAINT "feature_overrides_scope_check" CHECK (
  scope = CASE
    WHEN device_id IS NOT NULL THEN 'device:' || device_id::text
    WHEN location_id IS NOT NULL THEN 'location:' || location_id::text
    ELSE 'tenant'
  END
  AND (device_id IS NULL OR location_id IS NOT NULL)
);

-- Change feed (ADR 0012): a module switched for a tenant reaches its hubs like any configuration.
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON tenant_entitlements
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON feature_overrides
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
