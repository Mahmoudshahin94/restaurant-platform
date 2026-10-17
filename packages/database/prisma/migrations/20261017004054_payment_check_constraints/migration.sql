-- Integrity guards for money movements (validated in the application as well).

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_cash_fields_valid"
    CHECK ("change" >= 0 AND ("tendered" IS NULL OR "tendered" >= "amount" + "rounding_adjustment" - 0)),
  ADD CONSTRAINT "payments_refund_link_valid"
    CHECK (("type" = 'REFUND') = ("refund_of_id" IS NOT NULL)),
  ADD CONSTRAINT "payments_refund_has_reason"
    CHECK ("type" <> 'REFUND' OR ("reason" IS NOT NULL AND length(trim("reason")) > 0));

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_opening_float_non_negative" CHECK ("opening_float" >= 0),
  ADD CONSTRAINT "shifts_open_lock_consistent"
    CHECK (("status" = 'OPEN') = ("open_register_id" IS NOT NULL)),
  ADD CONSTRAINT "shifts_closing_consistent"
    CHECK ("status" = 'OPEN' OR ("closed_at" IS NOT NULL AND "counted_cash" IS NOT NULL AND "expected_cash" IS NOT NULL));

ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_transactions_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "cash_transactions_manual_reason"
    CHECK ("type" NOT IN ('PAY_IN', 'PAY_OUT') OR ("reason" IS NOT NULL AND length(trim("reason")) > 0));

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_cash_rounding_valid"
    CHECK ("cash_rounding_increment" IS NULL OR "cash_rounding_increment" >= 1);
