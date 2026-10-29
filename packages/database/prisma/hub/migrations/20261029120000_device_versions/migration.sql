-- MADAR Phase M10 (ADR 0026): when a device first reported its current version. Releases and
-- tenant release channels are cloud-only.
-- AlterTable
ALTER TABLE "devices" ADD COLUMN "last_version_at" DATETIME;
