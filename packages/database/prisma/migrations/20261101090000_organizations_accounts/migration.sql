-- E1 enterprise organizations: Organization above Tenant, OrganizationMember, and the shared login
-- Account (one per person; a User per brand links to it). The password hash moves from users to
-- accounts, backfilled one account per existing user, so existing sign-ins keep working.

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('OWNER', 'MANAGER', 'FINANCE');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "last_tenant_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "organization_id" UUID;

-- AlterTable (account_id is filled below, then made NOT NULL)
ALTER TABLE "users" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "organization_member_id" UUID;

-- Backfill: one account per existing user (e-mails were globally unique), the user's own brand as
-- the brand signed into last.
INSERT INTO "accounts" ("id", "email", "password_hash", "last_tenant_id", "created_at", "updated_at")
SELECT gen_random_uuid(), "email", "password_hash", "tenant_id", "created_at", now() FROM "users";

UPDATE "users" SET "account_id" = "accounts"."id"
FROM "accounts" WHERE "accounts"."email" = "users"."email";

ALTER TABLE "users" ALTER COLUMN "account_id" SET NOT NULL;

-- DropIndex
DROP INDEX "users_email_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "password_hash";

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_account_id_idx" ON "organization_members"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_account_id_key" ON "organization_members"("organization_id", "account_id");

-- CreateIndex
CREATE INDEX "tenants_organization_id_idx" ON "tenants"("organization_id");

-- CreateIndex
CREATE INDEX "users_account_id_idx" ON "users"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_account_id_key" ON "users"("tenant_id", "account_id");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
