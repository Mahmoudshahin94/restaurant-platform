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

- [ ] `NODE_ENV=production` (secure cookies; the mock payment provider is refused)
- [ ] `JWT_ACCESS_SECRET` (≥ 32 random characters) and `TRACKING_TOKEN_SECRET` set from a secret
      store, unique per environment, never the `.env.example` values
- [ ] `DATABASE_URL` uses a least-privilege role over TLS; backups and point-in-time recovery on
- [ ] `CORS_ORIGINS` lists exactly the admin, KDS (if served by the cloud) and website origins
      (bare origins; the server refuses `*`), plus `tauri://localhost` / `http://tauri.localhost`
      for desktop POS builds that call the cloud directly
- [ ] `TRUST_PROXY` = number of proxies in front of the API (rate limits are per client IP)
- [ ] `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `WEB_ORDER_RATE_LIMIT_PER_MINUTE`,
      `TRACKING_RATE_LIMIT_PER_MINUTE` reviewed for the expected traffic
- [ ] `ONLINE_PAYMENT_PROVIDER=none` until a real gateway adapter exists (ADR 0013)
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
