# Changelog

All notable changes to MADAR. One version names the whole platform: the cloud API, the location
hub, and the admin, POS, KDS, kiosk, website and platform admin apps (ADR 0026). Versions follow
[semantic versioning](https://semver.org/); [docs/release.md](docs/release.md) describes how a
release is cut and rolled out.

## [Unreleased]

### Added

- **Enterprise design system (E0, ADR 0028).** A UI/UX audit of every app, with screenshots, and the approved
  design system: three surface profiles (storefront, counter, console), a complete token set, the button spec,
  the shared components to build and an accessibility bar
  ([docs/madar/design-system.md](docs/madar/design-system.md)). No product code changes yet.
- **Design-system foundations (E1, ADR 0028).** The new tokens (surfaces, `border-strong`,
  `primary-hover`/`-subtle`, `info` and status `-subtle` fills, elevation, z-index, motion, type scale,
  radii derived from the tenant radius, `data-profile` component tokens); the Button spec (`primary`
  replaces `default`, `xl` replaces `touch`, new `md`/`2xl`/icon sizes, a `loading` state, a neutral
  disabled style); and the shared `DropdownMenu`, `AlertDialog` (replaces the admin's confirm dialog)
  and `Toast`/`Toaster`. A tenant's primary now also sets its hover and selected-row tints.

## [1.0.0] - 2026-10-29

The first MADAR release: the offline-first restaurant POS/KDS/online-ordering platform (original
Phases 0–10, ADRs 0001–0016) turned into a multi-tenant commerce platform for restaurants, cafés,
supermarkets, clothing and retail stores, in ten phases (M1–M10, ADRs 0017–0026). Development
only: there is no earlier MADAR version to migrate from.

### Added

- **Multi-tenant foundation (M1, ADR 0017).** `Tenant` replaces `Restaurant` everywhere (database,
  code, routes, error codes, token claim). Business types, the tenant context and a tenant-scoped
  database client that refuses unscoped queries in the cloud, with a lint rule; provisioning
  through one transaction; the PIN sign-in scoped to its tenant; isolation tests across tenants.
- **Modules (M2, ADR 0018).** A catalog of features with business-type defaults, platform
  entitlements and tenant, location and device overrides (`resolveLayered`); `@RequireFeature`
  on routes and capability guards in every app.
- **Branding and theme (M3, ADR 0019).** MADAR's own brand in one place (`PLATFORM_BRAND`), tenant
  branding (names, logo, colours checked for contrast, fonts, radius) per surface, design tokens,
  light, dark and system modes, tenant files.
- **Currency and languages (M4, ADR 0020).** ILS by default, tenant currency display settings, the
  subset of English and Arabic each business supports.
- **Retail (M5, ADR 0021).** SKUs, barcodes (EAN-13, EAN-8, UPC-A and more) with check digits, generic
  product options and variant matrices, a scanner abstraction in the POS, offline scanning at the
  hub.
- **Self-service (M6, ADR 0022).** The kiosk app; terminals (POS, KDS, kiosk, customer display)
  paired with their hub by a one-time code, reporting their contact and version; the shared order
  engine; retail self-checkout; an integrated card terminal provider.
- **Multi-tenant website (M7, ADR 0023).** The tenant found from the host name, verified custom
  domains and `<slug>` subdomains, configurable sections with draft, preview and publish.
- **Payment configuration (M8, ADR 0024).** Per-tenant provider accounts per location and method,
  secrets sealed with envelope encryption and a rotatable master key, never shown again.
- **Platform admin (M9, ADR 0025).** A separate app and identity for MADAR's operators: tenants
  and provisioning, suspension, entitlements, domains, payments overview, the health board,
  server error events, platform and tenant audit logs, and previewed, confirmed and audited
  support repairs. No SQL console.
- **Versions and releases (M10, ADR 0026).**
  - One MADAR version in the root `package.json`, stamped on every app and package, the POS
    desktop app (Tauri, Cargo) and the reported constant by `pnpm version:set`; a drift check
    (`pnpm version:check`, part of `pnpm test:tools`).
  - The version in every app's footer, on `GET /health` of the cloud and every hub, and in
    `x-madar-client-version` on every request of every app and hub.
  - Device versions in real columns (`Device.appVersion`, `lastVersionAt`), recorded from hubs'
    requests, terminal pairing and terminal heartbeats.
  - Releases with notes and minimum hub and app versions; tenants on a STABLE or BETA channel or
    pinned to a version; outdated and unsupported devices flagged.
  - The cloud refuses hubs (`426 HUB_UPGRADE_REQUIRED`) and apps (`426 CLIENT_UPGRADE_REQUIRED`)
    older than it serves. Apps show an "Update required" screen in English and Arabic; hubs keep
    their outbox, keep serving their location and say "Hub update required" on the POS.
  - The platform admin's Releases page, and versions on the health board.
  - This changelog and the versioning and rollout procedure in `docs/release.md`.

### Changed

- Every package moved from `0.1.0` to `1.0.0`.
- `GET /health` answers `{ "status": "ok", "version": "1.0.0" }`.
- A hub refused for its version waits with its outbox (like a suspended business) instead of
  failing its snapshot; this closes the snapshot schema-skew risk found while mapping the platform
  for the migration plan.

### Security

- Platform and tenant identities never mix (ADR 0025); every route is classified and checked at
  start-up; payment secrets are encrypted at rest and never returned (ADR 0024).
