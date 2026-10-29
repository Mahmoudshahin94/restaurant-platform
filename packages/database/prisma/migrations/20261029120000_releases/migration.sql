-- MADAR Phase M10 (ADR 0026): one version for the whole platform, the releases MADAR publishes,
-- the channel each tenant follows, and when a device first reported the version it runs.
-- Releases and channels are cloud-only: none of them reach a location hub.

-- CreateEnum
CREATE TYPE "release_channel" AS ENUM ('STABLE', 'BETA');

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "last_version_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "releases" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "channel" "release_channel" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "min_supported_hub_version" TEXT,
    "min_supported_client_version" TEXT,
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_release_channels" (
    "tenant_id" UUID NOT NULL,
    "channel" "release_channel" NOT NULL DEFAULT 'STABLE',
    "pinned_version" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_release_channels_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "releases_version_key" ON "releases"("version");

-- CreateIndex
CREATE INDEX "releases_published_at_idx" ON "releases"("published_at");

-- AddForeignKey
ALTER TABLE "tenant_release_channels" ADD CONSTRAINT "tenant_release_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Versions are semantic (`1.0.0`, `1.2.0-beta.1`, `1.2.0+42`), at most 40 characters, the same
-- rule as @pos/domain `isMadarVersion`; the precedence rules (a minimum above its own release)
-- are the API's.
CREATE FUNCTION is_madar_version(value TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT length(value) <= 40
    AND value ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
$$;

ALTER TABLE "releases"
  ADD CONSTRAINT "releases_version_check" CHECK (is_madar_version("version")),
  ADD CONSTRAINT "releases_min_hub_check"
    CHECK ("min_supported_hub_version" IS NULL OR is_madar_version("min_supported_hub_version")),
  ADD CONSTRAINT "releases_min_client_check"
    CHECK ("min_supported_client_version" IS NULL OR is_madar_version("min_supported_client_version")),
  ADD CONSTRAINT "releases_notes_check" CHECK (length("notes") <= 4000);

ALTER TABLE "tenant_release_channels"
  ADD CONSTRAINT "tenant_release_channels_pinned_check"
    CHECK ("pinned_version" IS NULL OR is_madar_version("pinned_version"));

-- A device's version and when it first reported it come together.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_last_version_check"
    CHECK ("last_version_at" IS NULL OR "app_version" IS NOT NULL);

-- Change feed (ADR 0012): when a device reported its version is a report, like the version itself,
-- not configuration; it changes nothing for the hub.
DROP TRIGGER config_change ON devices;
CREATE TRIGGER config_change AFTER INSERT OR UPDATE OR DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION record_config_change('self', 'last_seen_at', 'app_version', 'last_version_at', 'metadata', 'credential_hash');
