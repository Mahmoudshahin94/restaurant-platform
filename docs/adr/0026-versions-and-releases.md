# ADR 0026: One MADAR version; devices report theirs; the cloud refuses what it cannot serve

- Status: Accepted (2026-10-29)

## Context

MADAR runs as one cloud for every tenant, a hub per location and apps on many screens (Phase M10
of the [migration plan](../madar/migration-plan.md)). Until now every package said `0.1.0`, no
server said which version it ran, and only terminals reported a version (ADR 0022). Four things
needed a decision:

1. **What is "the version"?** Eighteen packages, the desktop app's Tauri and Cargo manifests,
   and the version the apps and hubs report could each drift on their own.
2. **Which hubs and apps does the cloud still serve?** The hub's schema is generated from the
   cloud's (ADR 0011), and the snapshot carries whole rows. A cloud that added a column sends a
   snapshot an older hub cannot apply: the apply fails, and the hub keeps retrying. The
   migration plan's mapping found this skew as an open risk.
3. **How does the platform follow a rollout?** Some businesses should take a new version first,
   some should stay on a known one during a busy season; operators need to see which devices run
   what.
4. **Where does a client's customisation live?** A fork or a branch per client would make "the
   version" meaningless.

## Decision

### One version, stamped everywhere

- **The root `package.json` holds the MADAR version** (semantic versioning: `1.0.0`,
  `1.2.0-beta.1`). `pnpm version:set <version>` (`tools/release/set-version.mjs`) writes it to every
  app and package, `apps/pos/src-tauri/tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, and the
  generated constant `MADAR_VERSION` (`packages/shared-types/src/version.ts`). It changes nothing
  else in those files.
- **The drift check** (`pnpm version:check`, and a `pnpm test:tools` test) fails when any of them
  disagrees with the root.
- **Every app gets it at build time** through Vite's `define` (`MADAR_VERSION`), read from the
  stamped constant; the servers import the constant.
- **It is visible:** `GET /health` answers `{ status, version }` on the cloud and on every hub;
  the platform footer of every app reads "MADAR POS · Powered by JudyTech · v1.0.0"; the hub's
  status (`GET /hub/status`) and the POS synchronization screen show the hub's version.

### Everyone reports their version

- **Every client sends `x-madar-client-version`** with its MADAR version: the admin, POS, KDS,
  kiosk, website and platform admin through `@pos/api-client`, the hub on every request to the
  cloud (push, pull, snapshot, orders, resolutions, and the pairing command).
- **Devices keep it in real columns:** `Device.appVersion` and the new `Device.lastVersionAt`
  (when the device first reported that version). The cloud's `DeviceGuard` records a hub's on
  its own row; the hub records a terminal's when it pairs (`POST /terminals/pair` now reads the
  header) and as it works, and reports both to the cloud in its `DEVICE_UPSERT` (the cloud keeps
  the report's `lastVersionAt`, or the time it heard of the new version). A header that is not a
  semantic version is ignored, never stored.
- Neither column is configuration: the `devices` change-feed trigger ignores `last_version_at`
  like `app_version`, and the snapshot carries neither.

### Releases and the minimum versions

- **`Release`** (cloud-only): `version` (unique, semantic, checked by the database too),
  `channel` (`STABLE` or `BETA`), operator `notes`, `publishedAt`, the publishing operator, and
  two optional minimums: `minSupportedHubVersion` and `minSupportedClientVersion`. A minimum may
  not be above its own release's version.
- **The cloud serves** hubs and apps at or above the **highest minimum declared by any published
  release whose version is at or below the version the cloud runs** (`supportedMinimums` in
  `@pos/domain`). A release published ahead of its deployment changes nothing until the cloud
  runs it; the minimums are the cloud's statement of what it can serve, so they are one rule for
  every tenant, whatever its channel.
- **The refusals:** a hub below the hub minimum (or one that sends no version once a minimum
  exists) gets `426 HUB_UPGRADE_REQUIRED` from `DeviceGuard` on every sync route, so it is never
  sent a snapshot it cannot apply: **this closes the schema-skew risk**, provided a release whose
  migration changes the snapshot raises the hub minimum (the release checklist says so). An app
  below the app minimum gets `426 CLIENT_UPGRADE_REQUIRED` from a global guard
  (`ClientVersionGuard`) on every route before anything else answers. Both carry
  `details.minimumVersion` and `details.version`.
- **Not refused:** the platform's own routes (an operator must always reach the releases page to
  correct a wrong minimum) and a caller that reports no version (a script, an integration): the
  rule protects apps from a cloud they cannot understand; it is not access control.
- The policy is cached for 15 seconds per API instance; publishing or editing a release on an
  instance applies there at once.

### What the apps and hubs do with a refusal

- **Apps:** `@pos/api-client` hands a `CLIENT_UPGRADE_REQUIRED` answer to the app
  (`onUpgradeRequired`), and `UpgradeRequiredGate` (`@pos/app-kit`) replaces the app with a clear
  notice in English or Arabic: the version it runs, the one required, and "Check again" (a web
  app reloads its newest build; the desktop app needs its installer).
- **Hubs:** a `HUB_UPGRADE_REQUIRED` is treated like a suspension (ADR 0025), not like a refused
  credential: the hub keeps serving its LAN from its last snapshot, which its version
  understands, keeps every change in its outbox and retries with backoff. Its status says
  `upgradeRequired: { minimumVersion }`; the POS indicator reads "Hub update required" and the
  synchronization screen explains that nothing is lost and what to install. Once the hub is
  updated, the outbox goes out.

### Rollout tracking

- **`TenantReleaseChannel`** (cloud-only, one row per tenant; none means STABLE): `channel`
  (`STABLE` follows stable releases, `BETA` takes beta and stable ones) and an optional
  `pinnedVersion` (a published release the tenant stays on). Its **target version** is the pin,
  else its channel's newest release.
- **Device status** (`deviceVersionStatus`): `UNSUPPORTED` below the cloud's minimum for its kind
  (a hub against the hub minimum, every terminal against the app minimum), `OUTDATED` below the
  tenant's target, `CURRENT` otherwise, `UNKNOWN` when it never reported a version.
- The channel is **tracking, not enforcement:** MADAR's apps and hubs are installed and updated
  per location (no auto-update service yet); the channel tells operators which version each
  business should be on and flags the devices that are not. It never lowers the minimums.

### The platform's Releases page

- **Permissions:** `releases.view` (every platform role), `releases.publish` (publish and correct
  a release) and `releases.rollout` (a tenant's channel or pin), held by OWNER and OPERATOR. Tenant
  tokens never reach these routes (`401`, the platform route class of ADR 0025).
- **API:** `GET /platform/releases` (the cloud's version, the minimums it enforces, the newest
  release per channel, every release), `POST /platform/releases`, `PATCH /platform/releases/:id`
  (channel, notes, minimums; never the version), `GET /platform/device-versions` (per tenant: its
  rollout, its active devices with location, version, since when, last contact and status;
  `outdatedOnly`), and `GET`/`PUT /platform/tenants/:tenantId/release-channel` (with a reason).
- **Audit:** publishing and correcting a release are in the platform audit log (correcting with
  before and after); a tenant's channel change is in both logs with its reason.
- **The app:** a Releases page (summary, published releases, device versions per tenant and
  location with the outdated and unsupported ones flagged, publish and channel dialogs); the
  health board gains a Versions column and shows the cloud's version.

### Customisation is configuration

A client's differences (modules, branding, languages, currency, website, payment providers) are
configuration of one codebase (ADRs 0018–0024), never a branch or a fork: every business runs a
published MADAR version, which is what makes the version, the minimums and the rollout meaningful.

## Consequences

- One number names a build of everything; a release is a tag of the whole repository.
- The cloud can change the snapshot without breaking hubs: it refuses the old ones first, and
  they wait without losing a sale until they are updated.
- An operator who sets a minimum too high cuts the apps it names off the cloud; the platform admin
  is exempt so the minimum can be corrected, and the minimums apply only once the cloud runs the
  release.
- Hubs on the LAN do not yet refuse POS, KDS or kiosk apps older than themselves; the hub and its
  apps are installed together per location.

### Deferred

- Automatic updates (the Tauri updater for the POS, an update channel for hubs and kiosks) driven
  by the tenant's channel; today the channel only tracks.
- The hub enforcing a minimum for its own LAN clients, from the cloud's release metadata.
- Scheduled publication (a future `publishedAt`), release artefacts and checksums, and CI to
  build and tag a release.
