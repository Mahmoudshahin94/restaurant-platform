-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_configs" (
    "tenant_id" UUID NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "website_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "tenant_domains_domain_idx" ON "tenant_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_tenant_id_domain_key" ON "tenant_domains"("tenant_id", "domain");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_configs" ADD CONSTRAINT "website_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (ADR 0023) -------------------------------------------------------------------------

-- Domains are stored normalized (lower case, punycode ASCII, no port or trailing dot), so the
-- host of a request is compared with one form only.
ALTER TABLE "tenant_domains"
  ADD CONSTRAINT "tenant_domains_domain_check"
    CHECK ("domain" ~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$' AND "domain" NOT LIKE '%..%'),
  ADD CONSTRAINT "tenant_domains_kind_check" CHECK ("kind" IN ('SUBDOMAIN', 'CUSTOM')),
  ADD CONSTRAINT "tenant_domains_status_check"
    CHECK ("status" IN ('PENDING', 'VERIFIED', 'FAILED', 'DISABLED')),
  ADD CONSTRAINT "tenant_domains_verified_at_check"
    CHECK ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL),
  -- The canonical address must be one that serves the site.
  ADD CONSTRAINT "tenant_domains_primary_verified_check"
    CHECK (NOT "is_primary" OR "status" = 'VERIFIED');

-- A domain serves one tenant at most. Pending claims of the same name by several tenants may
-- coexist: only the one whose token is in DNS becomes VERIFIED, so a claim cannot block the owner.
CREATE UNIQUE INDEX "tenant_domains_verified_domain_key" ON "tenant_domains"("domain")
  WHERE "status" = 'VERIFIED';

-- One primary domain per tenant.
CREATE UNIQUE INDEX "tenant_domains_one_primary_key" ON "tenant_domains"("tenant_id")
  WHERE "is_primary";

-- Published once means a published version; never published means none.
ALTER TABLE "website_configs"
  ADD CONSTRAINT "website_configs_version_check"
    CHECK ("version" >= 0 AND ("version" = 0) = ("published" IS NULL));
