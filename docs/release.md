# Release readiness checklist

Run through this before shipping a build to a location or deploying the cloud. Commands are from
[dev-setup.md](dev-setup.md) and [testing.md](testing.md).

## 1. The gate

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green
- [ ] `pnpm format:check` and `pnpm test:tools` (includes the E2E scenario matrix check)
- [ ] `pnpm e2e` green: admin, POS, KDS and customer-website suites, all 19 critical scenarios
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
- [ ] Load balancer health checks: liveness `GET /health`, readiness `GET /ready` (503
      `SERVICE_UNAVAILABLE` while the database is unreachable)
- [ ] TLS terminates in front of the API; HSTS is sent by the API itself
- [ ] One API instance, or accept the known multi-instance limits (in-memory realtime and rate
      limits, per-instance timeout sweep, polled change feed; ADR 0016)

## 3. Location (hub, POS, KDS)

- [ ] Hub paired with `pnpm --filter @pos/gateway pair` by an owner; System → Devices shows it
      online in the admin portal
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

- [ ] `GET /ready` green on every instance; error rate and 5xx logs watched for an hour
- [ ] System → Synchronization in the admin portal shows no new refused hub changes
