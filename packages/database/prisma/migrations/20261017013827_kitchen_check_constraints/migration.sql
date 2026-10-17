-- Integrity guards for kitchen tickets (validated in the application as well).

ALTER TABLE "kitchen_tickets"
  ADD CONSTRAINT "kitchen_tickets_version_positive" CHECK ("version" >= 1 AND "revision" >= 1),
  -- Timestamps follow the status, so history stays consistent.
  ADD CONSTRAINT "kitchen_tickets_cancelled_consistent"
    CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)),
  ADD CONSTRAINT "kitchen_tickets_ready_consistent"
    CHECK ("status" NOT IN ('READY', 'COMPLETED') OR "ready_at" IS NOT NULL),
  ADD CONSTRAINT "kitchen_tickets_completed_consistent"
    CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL),
  ADD CONSTRAINT "kitchen_tickets_dismissed_only_cancelled"
    CHECK ("dismissed_at" IS NULL OR "status" = 'CANCELLED');

ALTER TABLE "kitchen_ticket_items"
  ADD CONSTRAINT "kitchen_ticket_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_kds_thresholds_valid"
    CHECK ("kds_warn_minutes" >= 1 AND "kds_late_minutes" > "kds_warn_minutes");
