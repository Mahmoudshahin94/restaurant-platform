-- MADAR Phase 3 (ADR 0019): tenant branding and the files it shows (logos, favicons). Branding is
-- configuration: it rides the hub snapshot and the change feed, so a location hub shows the
-- tenant's look offline.
-- CreateTable
CREATE TABLE "tenant_branding" (
    "tenant_id" UUID NOT NULL,
    "display_name_en" TEXT,
    "display_name_ar" TEXT,
    "logo_file_id" UUID,
    "favicon_file_id" UUID,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "accent_color" TEXT,
    "font_family" TEXT,
    "logo_size" TEXT,
    "theme_mode" TEXT,
    "surface_style" TEXT,
    "border_radius" INTEGER,
    "surfaces" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "tenant_files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_branding_logo_file_id_idx" ON "tenant_branding"("logo_file_id");

-- CreateIndex
CREATE INDEX "tenant_branding_favicon_file_id_idx" ON "tenant_branding"("favicon_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_files_storage_key_key" ON "tenant_files"("storage_key");

-- CreateIndex
CREATE INDEX "tenant_files_tenant_id_created_at_idx" ON "tenant_files"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "tenant_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_favicon_file_id_fkey" FOREIGN KEY ("favicon_file_id") REFERENCES "tenant_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_files" ADD CONSTRAINT "tenant_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A file's storage key always lies inside its tenant's folder, so no row can point at another
-- tenant's bytes.
ALTER TABLE "tenant_files" ADD CONSTRAINT "tenant_files_storage_key_check" CHECK (
  storage_key LIKE 'tenants/' || tenant_id::text || '/%' AND position('..' in storage_key) = 0
);

-- Change feed (ADR 0012): a branding change reaches the tenant's hubs like any configuration.
-- Files need none: they are immutable, and only reach a hub once branding refers to them.
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
