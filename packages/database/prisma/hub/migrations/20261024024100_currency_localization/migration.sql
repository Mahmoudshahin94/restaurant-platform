-- MADAR Phase 4 (ADR 0020): currency display and languages ride the tenant row of the snapshot.
-- SQLite cannot change a column default in place, so the table is rebuilt; every row is copied.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "legal_name" TEXT,
    "business_type" TEXT NOT NULL DEFAULT 'RESTAURANT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency_code" TEXT NOT NULL DEFAULT 'ILS',
    "currency_symbol" TEXT,
    "currency_display" TEXT,
    "currency_format_locale" TEXT,
    "default_locale" TEXT NOT NULL DEFAULT 'en',
    "supported_locales" JSONB NOT NULL DEFAULT '["en","ar"]',
    "digits" TEXT,
    "timezone" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_tenants" ("business_type", "created_at", "currency_code", "default_locale", "id", "legal_name", "name_ar", "name_en", "slug", "status", "supported_locales", "timezone", "updated_at") SELECT "business_type", "created_at", "currency_code", "default_locale", "id", "legal_name", "name_ar", "name_en", "slug", "status", "supported_locales", "timezone", "updated_at" FROM "tenants";
DROP TABLE "tenants";
ALTER TABLE "new_tenants" RENAME TO "tenants";
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

