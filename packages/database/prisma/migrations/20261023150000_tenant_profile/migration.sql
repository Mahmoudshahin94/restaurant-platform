-- MADAR Phase 1 (ADR 0017): the tenant's profile. The business type only picks default
-- configuration; supported locales are the subset of en/ar the tenant offers.
-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "business_type" TEXT NOT NULL DEFAULT 'RESTAURANT',
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "supported_locales" JSONB NOT NULL DEFAULT '["en","ar"]';

