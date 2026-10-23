-- MADAR Phase 3 (ADR 0019): branding. Checked by hand: two new tables, nothing rebuilt. The rows
-- (and the files' bytes) arrive with the snapshot; the cloud keeps the storage key check.
-- CreateTable
CREATE TABLE "tenant_branding" (
    "tenant_id" TEXT NOT NULL PRIMARY KEY,
    "display_name_en" TEXT,
    "display_name_ar" TEXT,
    "logo_file_id" TEXT,
    "favicon_file_id" TEXT,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "accent_color" TEXT,
    "font_family" TEXT,
    "logo_size" TEXT,
    "theme_mode" TEXT,
    "surface_style" TEXT,
    "border_radius" INTEGER,
    "surfaces" JSONB NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "tenant_branding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tenant_branding_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "tenant_files" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tenant_branding_favicon_file_id_fkey" FOREIGN KEY ("favicon_file_id") REFERENCES "tenant_files" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tenant_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "tenant_branding_logo_file_id_idx" ON "tenant_branding"("logo_file_id");

-- CreateIndex
CREATE INDEX "tenant_branding_favicon_file_id_idx" ON "tenant_branding"("favicon_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_files_storage_key_key" ON "tenant_files"("storage_key");

-- CreateIndex
CREATE INDEX "tenant_files_tenant_id_created_at_idx" ON "tenant_files"("tenant_id", "created_at");

