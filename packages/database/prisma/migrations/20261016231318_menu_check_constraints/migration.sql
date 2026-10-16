-- Integrity guards the application also validates; the database enforces them as a last line of
-- defense against bugs and manual edits. (Prisma does not model CHECK constraints.)

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_non_negative" CHECK ("price" >= 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_price_non_negative" CHECK ("price" >= 0);

ALTER TABLE "modifiers"
  ADD CONSTRAINT "modifiers_price_delta_non_negative" CHECK ("price_delta" >= 0);

ALTER TABLE "modifier_groups"
  ADD CONSTRAINT "modifier_groups_min_select_valid" CHECK ("min_select" >= 0),
  ADD CONSTRAINT "modifier_groups_max_select_valid"
    CHECK ("max_select" IS NULL OR ("max_select" >= 1 AND "max_select" >= "min_select"));

ALTER TABLE "product_modifier_groups"
  ADD CONSTRAINT "product_modifier_groups_min_select_valid" CHECK ("min_select" IS NULL OR "min_select" >= 0),
  ADD CONSTRAINT "product_modifier_groups_max_select_valid" CHECK ("max_select" IS NULL OR "max_select" >= 1);

ALTER TABLE "location_products"
  ADD CONSTRAINT "location_products_price_override_non_negative"
    CHECK ("price_override" IS NULL OR "price_override" >= 0);
