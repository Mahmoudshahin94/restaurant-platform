-- A role an organization added to a user (E1): removed again when the membership ends, while the
-- user's own assignments stay.
ALTER TABLE "user_roles" ADD COLUMN "granted_by_organization" BOOLEAN NOT NULL DEFAULT false;

-- The name a member's users get in brands that join the organization later.
ALTER TABLE "organization_members" ADD COLUMN "display_name" TEXT;
UPDATE "organization_members" m SET "display_name" = a."email" FROM "accounts" a WHERE a."id" = m."account_id";
ALTER TABLE "organization_members" ALTER COLUMN "display_name" SET NOT NULL;
