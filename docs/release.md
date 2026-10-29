# Releasing MADAR

How a MADAR version is cut and rolled out ([ADR 0026](adr/0026-versions-and-releases.md)), then
the readiness checklist to run before shipping a build to a location or deploying the cloud.
Commands are from [dev-setup.md](dev-setup.md) and [testing.md](testing.md); what changed in each
version is in [CHANGELOG.md](../CHANGELOG.md).

## Versioning

- **One version for everything.** The root `package.json` holds the MADAR version; every app and
  package, the POS desktop app (`tauri.conf.json`, `Cargo.toml`, `Cargo.lock`) and the
  `MADAR_VERSION` constant the servers and apps report carry the same one. Never edit them by
  hand: `pnpm version:set 1.1.0` writes them all, and `pnpm version:check` (also run by
  `pnpm test:tools`) fails on any drift.
- **Semantic versioning.** Patch (`1.0.1`): fixes, no migration that changes what a hub receives.
  Minor (`1.1.0`): features, additive migrations. Major (`2.0.0`): a breaking change for hubs or
  apps. Pre-releases for the beta channel: `1.1.0-beta.1`, `1.1.0-beta.2`, then `1.1.0`.
- **No client branches.** A client's modules, branding, languages, currency, website and payment
  providers are configuration (ADRs 0018–0024). Every business runs a published MADAR version;
  a fix for one client is a fix in `main`, released like any other.

## Cutting a release

1. From an up-to-date `main`, on a branch `release/<version>`:
   `pnpm version:set <version>`, then add the version's section to `CHANGELOG.md` (Added,
   Changed, Fixed, Security; link the ADRs).
2. **Decide the minimums.** Does this version's cloud send hubs or apps something an older one
   cannot handle?
   - A migration that adds or renames a column of a table the snapshot carries (the
     `SNAPSHOT_TABLES` of `@pos/validation`), changes a sync payload, or changes an enum a hub
     stores: the **hub minimum** is this version (an older hub cannot apply the snapshot).
   - An API response an older app cannot read, or a route an older app needs that is gone: the
     **app minimum** is the oldest app version that still works.
   - Otherwise leave both empty: the previous releases' minimums keep applying.
3. Run the readiness gate below, then merge and tag `v<version>` on `main`.
4. Build and ship: the cloud API, the hub (`apps/gateway`), the web apps, the POS desktop app
   (`pnpm --filter @pos/pos tauri build`) and the kiosk.

## Rolling out

1. **Publish the release** in the platform admin (Releases → Publish a release): its version,
   channel (BETA for a pre-release, STABLE otherwise), the minimums decided above and the notes
   from the changelog. A release's minimums take effect only once the cloud runs that version,
   so it can be published ahead of the deployment.
2. **Beta first.** Put the pilot businesses on the BETA channel (Releases → Change channel, with
   a reason). Their devices are flagged _Outdated_ until they run the beta. Pin a business that
   must not move (a busy season) to the version it runs.
3. **Update the locations before the cloud whenever the release raises the hub minimum:**
   install the new hub and apps at each location, and watch Releases → Device versions (or
   _Outdated devices only_) until no device of the businesses that matter is flagged.
4. **Deploy the cloud.** From now on it refuses hubs below the hub minimum
   (`426 HUB_UPGRADE_REQUIRED`) and apps below the app minimum (`426 CLIENT_UPGRADE_REQUIRED`).
   A refused hub keeps serving its location and keeps every sale in its outbox; its POS shows
   "Hub update required". A refused app shows "Update required" until it is updated. Devices
   still flagged _Unsupported_ need a visit.
5. **Promote.** Once the beta is good, publish the final version on STABLE (or change the beta
   release's channel) and move the pilot businesses back to STABLE.

**Rolling back.** Redeploy the previous cloud version: the minimums of a release the cloud no
longer runs stop applying at once. If a minimum was set too high, lower it on the release
(Releases → Edit); the platform admin is never refused, so this is always possible. Database
migrations are forward-only: a rollback past a migration needs a fix-forward release instead.

# Release readiness checklist

## 1. The gate

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm version:check`: every app, package, the desktop app and `MADAR_VERSION` agree with the
      root `package.json`, and `CHANGELOG.md` has the version's section
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green
- [ ] `pnpm format:check` and `pnpm test:tools` (includes the E2E scenario matrix check)
- [ ] `pnpm e2e` green: every suite (admin, POS, KDS, customer website, kiosk, platform admin)
      and every critical scenario of the [testing.md](testing.md) matrix
- [ ] `pnpm --filter @pos/pos rust:check` (fmt, clippy `-D warnings`, tests) for a desktop release
- [ ] `pnpm --filter @pos/database migrate:status` clean against the target database
- [ ] Hub schema in step: the `hub-schema.contract` test passes (part of `pnpm test`)

## 2. Cloud configuration (production)

- [ ] `NODE_ENV=production` (secure cookies; the test payment adapters are refused)
- [ ] `JWT_ACCESS_SECRET` (≥ 32 random characters) and `TRACKING_TOKEN_SECRET` set from a secret
      store, unique per environment, never the `.env.example` values
- [ ] `DATABASE_URL` uses a least-privilege role over TLS; backups and point-in-time recovery on
- [ ] `CORS_ORIGINS` lists exactly the admin, KDS (if served by the cloud) and website origins
      (bare origins; the server refuses `*`), plus `tauri://localhost` / `http://tauri.localhost`
      for desktop POS builds that call the cloud directly
- [ ] `TRUST_PROXY` = number of proxies in front of the API (rate limits are per client IP)
- [ ] `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `WEB_ORDER_RATE_LIMIT_PER_MINUTE`,
      `TRACKING_RATE_LIMIT_PER_MINUTE` reviewed for the expected traffic
- [ ] `DEV_PAYMENT_PROVIDERS` unset (the server refuses to start otherwise). Until a real gateway
      adapter exists, tenants have no online provider and their websites take no card (ADR 0024)
- [ ] **Payment secrets key** (ADR 0024): `PAYMENT_SECRETS_KEY=1:<base64 of 32 random bytes>`
      (`openssl rand -base64 32`) from the secret store, unique per environment, never the
      `.env.example` value. The cloud refuses to start without it. Treat it like the database's
      own credentials: anyone with the key and a database dump can read every tenant's provider
      secrets; losing every version of it loses them (administrators then re-enter them). Keep it
      out of logs, images and CI output; the hubs never need it.
- [ ] **Key rotation** (yearly, and at once if the key may have leaked): add the new version
      (`1:<old>,2:<new>`), deploy, run `pnpm --filter @pos/api payment-secrets:rotate` (it reports
      how many secrets it re-encrypted and any it could not open), then remove `1:` and deploy
      again. If it leaked, also have each tenant replace its provider keys at the provider.
- [ ] **Platform admin** (ADR 0025): `PLATFORM_JWT_SECRET` (≥ 32 random characters) from the
      secret store, so platform tokens rotate independently of staff tokens; `CORS_ORIGINS`
      includes the platform admin's origin, served on its own host (not a tenant domain)
- [ ] **First platform owner:** run `pnpm platform:create-owner` once (see dev-setup.md), with
      `PLATFORM_USER_PASSWORD` set and the production `DATABASE_URL`; store the password in the
      team's vault. Until a second factor exists, keep the number of platform accounts small and
      their passwords long; deactivate leavers at once (it takes effect on the next request)
- [ ] `LOG_LEVEL=info`; logs shipped to a store that keeps `requestId`, `tenantId`,
      `locationId`, `userId`, `orderId`, `deviceId`
- [ ] Load balancer health checks: liveness `GET /health` (it also answers the running
      version: check it after the deploy), readiness `GET /ready` (503 `SERVICE_UNAVAILABLE`
      while the database is unreachable)
- [ ] The release is published in the platform admin with its minimums (see Rolling out), and
      the locations a raised hub minimum would refuse are updated first
- [ ] TLS terminates in front of the API; HSTS is sent by the API itself
- [ ] One API instance, or accept the known multi-instance limits (in-memory realtime and rate
      limits, per-instance timeout sweep, polled change feed; ADR 0016)

## 3. Location (hub, POS, KDS)

- [ ] Hub paired with `pnpm --filter @pos/gateway pair` by an owner; System → Devices shows it
      online in the admin portal, with the version it runs (`GET /health` on the hub answers it
      too); the platform admin's Releases page does not flag it
- [ ] `HUB_CORS_ORIGINS` lists the POS/KDS origins served on the LAN; `HUB_DATA_DIR` on a disk
      that is backed up (it holds the location's open orders until they sync)
- [ ] POS desktop build points at the hub (`VITE_API_URL`); signing in, restarting the app and
      still being signed in works (refresh token in the OS keychain)
- [ ] Unplug the Internet: the POS footer says "Offline", an order reaches the KDS; plug it back:
      "Sync now" leaves nothing pending and no failure; the order and its audit entries show in
      the admin portal
- [ ] Printers: a test receipt (network ESC/POS or the browser dialog)

## 4. Product checks

- [ ] Spot-check the main journey in English and Arabic: website order → POS accept → KDS start
      and ready → payment → the customer's page shows "Completed" / "مكتمل"
- [ ] Admin portal: reports for today match the till's shift close-out
- [ ] Known gaps reviewed with the tenant ([architecture.md](architecture.md#known-gaps))

## 5. After deploy

- [ ] `GET /ready` green and `GET /health` answering the new version on every instance; error
      rate and 5xx logs watched for an hour
- [ ] Releases → Device versions: nothing unexpectedly _Unsupported_; the health board's
      Versions column is clear for the businesses on this version's channel
- [ ] System → Synchronization in the admin portal shows no new refused hub changes
