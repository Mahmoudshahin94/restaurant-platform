-- Integrity guards for pricing configuration and financial records (validated in the
-- application as well; the database is the last line of defense).

ALTER TABLE "taxes"
  ADD CONSTRAINT "taxes_rate_valid" CHECK ("rate_bps" BETWEEN 0 AND 10000);

ALTER TABLE "discounts"
  ADD CONSTRAINT "discounts_value_valid"
    CHECK ("value" >= 0 AND ("type" <> 'PERCENTAGE' OR "value" <= 10000));

ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_seats_valid" CHECK ("seats" BETWEEN 1 AND 100);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative"
    CHECK ("subtotal" >= 0 AND "discount_total" >= 0 AND "tax_total" >= 0 AND "fee_total" >= 0 AND "total" >= 0),
  ADD CONSTRAINT "orders_discount_within_subtotal" CHECK ("discount_total" <= "subtotal"),
  ADD CONSTRAINT "orders_guest_count_valid" CHECK ("guest_count" IS NULL OR "guest_count" BETWEEN 1 AND 500),
  ADD CONSTRAINT "orders_version_positive" CHECK ("version" >= 1);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_valid" CHECK ("quantity" BETWEEN 1 AND 999),
  ADD CONSTRAINT "order_items_amounts_non_negative"
    CHECK ("base_price" >= 0 AND "unit_price" >= 0 AND "gross" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0),
  ADD CONSTRAINT "order_items_discount_within_gross" CHECK ("discount" <= "gross");

ALTER TABLE "order_item_modifiers"
  ADD CONSTRAINT "order_item_modifiers_price_non_negative" CHECK ("price_delta" >= 0);

ALTER TABLE "order_taxes"
  ADD CONSTRAINT "order_taxes_values_valid"
    CHECK ("rate_bps" BETWEEN 0 AND 10000 AND "taxable_amount" >= 0 AND "amount" >= 0);

ALTER TABLE "order_discounts"
  ADD CONSTRAINT "order_discounts_amount_non_negative" CHECK ("amount" >= 0 AND "value" >= 0);

ALTER TABLE "order_counters"
  ADD CONSTRAINT "order_counters_positive" CHECK ("last_number" >= 1);
