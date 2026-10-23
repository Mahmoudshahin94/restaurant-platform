-- MADAR Phase 1 (ADR 0017): the tenant's profile. Added columns, not a rebuilt table.
ALTER TABLE "tenants" ADD COLUMN "legal_name" TEXT;
ALTER TABLE "tenants" ADD COLUMN "business_type" TEXT NOT NULL DEFAULT 'RESTAURANT';
ALTER TABLE "tenants" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "tenants" ADD COLUMN "supported_locales" JSONB NOT NULL DEFAULT '["en","ar"]';
