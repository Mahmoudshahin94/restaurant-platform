-- MADAR Phase 4 (ADR 0020): currency display and languages. The currency itself stays fixed after
-- provisioning (ADR 0002); new tenants default to ILS. Null display settings inherit MADAR's.
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "currency_display" TEXT,
ADD COLUMN     "currency_format_locale" TEXT,
ADD COLUMN     "currency_symbol" TEXT,
ADD COLUMN     "digits" TEXT,
ALTER COLUMN "currency_code" SET DEFAULT 'ILS';

-- Values outside @pos/shared-types' lists cannot be stored, whoever writes them.
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_currency_display_check"
    CHECK ("currency_display" IS NULL OR "currency_display" IN ('narrowSymbol', 'symbol', 'code')),
  ADD CONSTRAINT "tenants_digits_check"
    CHECK ("digits" IS NULL OR "digits" IN ('latn', 'arab')),
  ADD CONSTRAINT "tenants_currency_symbol_check"
    CHECK ("currency_symbol" IS NULL OR char_length("currency_symbol") BETWEEN 1 AND 8);
