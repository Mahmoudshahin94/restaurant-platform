-- Phase 8 (ADR 0014): refused hub operations keep their payload for administrators, who can
-- settle them; the decision reaches the hub through the RESOLUTION topic of the change feed.
-- CreateEnum
CREATE TYPE "sync_issue_resolution" AS ENUM ('APPLIED_HUB', 'KEPT_CLOUD');

-- AlterEnum
ALTER TYPE "change_topic" ADD VALUE 'RESOLUTION';

-- AlterTable
ALTER TABLE "processed_operations" ADD COLUMN     "payload" JSONB,
ADD COLUMN     "resend_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "resolution" "sync_issue_resolution",
ADD COLUMN     "resolution_note" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMPTZ(3),
ADD COLUMN     "resolved_by_id" UUID;

-- A resolution is a recorded decision: who settled the refusal and when (ADR 0014).
ALTER TABLE "processed_operations" ADD CONSTRAINT "processed_operations_resolution_recorded"
  CHECK ((resolution IS NULL) = (resolved_at IS NULL)
     AND (resolution IS NULL OR resolved_by_id IS NOT NULL));
