-- A role an organization added to a user (E1); the hub keeps the column so the rows sync as they are.
ALTER TABLE "user_roles" ADD COLUMN "granted_by_organization" BOOLEAN NOT NULL DEFAULT false;
