-- MADAR Phase 5 (ADR 0021): retail catalog. Generic product options and the variants combining
-- them, per-variant SKU, cost and stock flag, product pictures, and barcodes unique per tenant.
-- Order lines keep the SKU and barcode they were sold with.
-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "sku" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "cost" INTEGER,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "track_inventory" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_values" (
    "id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_option_values" (
    "variant_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,

    CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("variant_id","option_value_id")
);

-- CreateTable
CREATE TABLE "product_barcodes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "code" TEXT NOT NULL,
    "symbology" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "file_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_options_product_id_idx" ON "product_options"("product_id");

-- CreateIndex
CREATE INDEX "product_option_values_option_id_idx" ON "product_option_values"("option_id");

-- CreateIndex
CREATE INDEX "product_variant_option_values_option_value_id_idx" ON "product_variant_option_values"("option_value_id");

-- CreateIndex
CREATE INDEX "product_barcodes_product_id_idx" ON "product_barcodes"("product_id");

-- CreateIndex
CREATE INDEX "product_barcodes_variant_id_idx" ON "product_barcodes"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_barcodes_tenant_id_code_key" ON "product_barcodes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- CreateIndex
CREATE INDEX "product_images_file_id_idx" ON "product_images"("file_id");

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "product_option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "tenant_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity the catalog service also checks (ADR 0021); the database is the last line of defence.
ALTER TABLE "product_barcodes"
  ADD CONSTRAINT "product_barcodes_symbology_check"
    CHECK ("symbology" IN ('EAN13', 'EAN8', 'UPC_A', 'CODE128', 'OTHER')),
  -- Printable ASCII without spaces: what a scanner types.
  ADD CONSTRAINT "product_barcodes_code_check" CHECK ("code" ~ '^[!-~]{1,64}$');

-- One primary code per product, or per variant.
CREATE UNIQUE INDEX "product_barcodes_one_primary"
  ON "product_barcodes" ("product_id", (coalesce("variant_id"::text, '')))
  WHERE "is_primary";

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_cost_non_negative" CHECK ("cost" IS NULL OR "cost" >= 0);

-- Change feed (ADR 0012): options, their values, the variants' combinations and barcodes are
-- part of the published menu, so a change reaches the tenant's hubs. Option values and variant
-- combinations find their tenant through their option or variant (two new lookup kinds).
CREATE OR REPLACE FUNCTION change_log_tenant(kind text, r jsonb) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE kind
    WHEN 'tenant' THEN (r->>'id')::uuid
    WHEN 'self' THEN (r->>'tenant_id')::uuid
    WHEN 'role' THEN (SELECT tenant_id FROM roles WHERE id = (r->>'role_id')::uuid)
    WHEN 'user' THEN (SELECT tenant_id FROM users WHERE id = (r->>'user_id')::uuid)
    WHEN 'modifier_group' THEN
      (SELECT tenant_id FROM modifier_groups WHERE id = (r->>'modifier_group_id')::uuid)
    WHEN 'product' THEN (SELECT tenant_id FROM products WHERE id = (r->>'product_id')::uuid)
    WHEN 'location' THEN (SELECT tenant_id FROM locations WHERE id = (r->>'location_id')::uuid)
    WHEN 'option' THEN
      (SELECT p.tenant_id FROM product_options o JOIN products p ON p.id = o.product_id
        WHERE o.id = (r->>'option_id')::uuid)
    WHEN 'variant' THEN
      (SELECT p.tenant_id FROM product_variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = (r->>'variant_id')::uuid)
  END
$$;

CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_options
  FOR EACH ROW EXECUTE FUNCTION record_config_change('product');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_option_values
  FOR EACH ROW EXECUTE FUNCTION record_config_change('option');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_variant_option_values
  FOR EACH ROW EXECUTE FUNCTION record_config_change('variant');
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON product_barcodes
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self');
-- Pictures need none: they stay in the cloud (ADR 0021).
