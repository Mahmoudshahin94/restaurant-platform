# ADR 0016: Hardening: the critical E2E suite, protected-by-construction routes, the hub's audit trail

- Status: Accepted (2026-10-23)

## Context

Phases 0–9 built the platform. Phase 10 is the last: prove the specification's 19 critical flows
end to end, audit the testing requirements (section 32), harden security (section 26) and
observability (sections 30–31), and close the contained items of the known-gaps list. Most of the
protections already existed (deny-by-default permissions guard, helmet, CORS, rate limits, Origin
check on cookie refresh, log redaction, typed errors); the audit looked for what was only true by
convention and made it enforced or tested.

## Decision

### End-to-end suite

- The 19 scenarios are mapped to Playwright tests in [testing.md](../testing.md); a tool test
  (`tools/e2e/coverage.test.mjs`, part of `pnpm test:tools`) fails if a named test disappears.
  Existing tests covered most of them; three gaps were filled:
  - **A cross-app journey** (`apps/customer-web/e2e/journey.spec.ts`): one website order through
    the cloud, the hub's change feed, acceptance at the POS, every KDS station (start, ready), cash
    payment and hand-over, with the customer's page following each status. The customer-website
    suite already ran cloud, hub, POS and website together; it now also serves the KDS from its
    hub.
  - **The Internet dropping mid-service** (`apps/pos/e2e/sync.spec.ts`): the test stops the cloud
    it started, the POS shows it offline, the order reaches the local KDS, then syncs exactly once
    on reconnect.
  - **A duplicate sync request**: the test resends the hub's own push (its outbox rows and device
    credential, read from the hub's SQLite file) and expects `DUPLICATE` for every operation and
    still one order in the cloud — what a retry after a lost answer does.
- `pnpm e2e` runs the four suites one after another (`turbo run test:e2e --concurrency=1`). Each
  suite keeps its own ports, `*_e2e` database and hub data directory; running them serially
  avoids load-induced timing flakes rather than port clashes.

### Routes are protected by construction

- `listRoutes(app)` (`@pos/server`) reads every controller route with its protection: `public`,
  `guarded` (`@Public()` behind its own guard, i.e. the hubs' `DeviceGuard`), `permissions`, or
  `unprotected`. `createServerApp` **refuses to start** with an unprotected route, on top of the
  runtime denial the permissions guard already did.
- Security tests walk **every** route instead of sampling: without a token each protected route
  answers `401`; a member whose role has no permissions gets `403 INSUFFICIENT_PERMISSION` on every
  route that requires one; another tenant's owner gets `404` on every route naming a restaurant or
  location; `/sync/*` refuses staff tokens. The public routes are an explicit list in the test, so
  a new one is a reviewed change. The hub runs the same checks on its route set.

### Transport

- `CORS_ORIGINS` entries must be bare origins (`scheme://host[:port]`, http(s) or `tauri`); `*`
  or a path stops the server at start-up. CORS stays credentialed and allowlist-only.
- `TRUST_PROXY` (default 0) sets how many proxies' `X-Forwarded-For` count. Rate limits are per
  client IP; behind a load balancer without it every client would share one budget.
- Helmet defaults are kept (HSTS, nosniff, frame options, `default-src 'self'` CSP, no referrer).
  The API serves JSON only, so the strict CSP costs nothing.
- **CSRF posture** unchanged and now tested end to end: only the refresh and logout endpoints read
  a cookie; the cookie is httpOnly, SameSite=strict, path-scoped to `/api/v1/auth`, and requires an
  `Origin` from `CORS_ORIGINS`. Every other call needs a bearer token, which a cross-site form
  cannot send. Native clients never use the cookie.
- `x-client-source` is informational but lands in audit entries: clients may claim `POS`, `KDS`,
  `WEBSITE` or `ADMIN`; `HUB` only a request authenticated by a device credential; `SYSTEM` never.

### Logs and errors

- The request context (and so every log line of a request, including Fastify's request-completed
  line, and every audit entry) carries `requestId`, `userId`, `restaurantId`, `locationId`, plus
  `orderId` for routes naming an order and `deviceId` for hub calls, whose restaurant and location
  come from the device.
- Redaction now also covers credentials and secrets one level deeper (`body.password`).
- Prisma errors can quote the failed query's arguments (a password hash, a phone number), so
  `loggableError` logs only their kind, code and stack frames; it is used by the exception filter,
  the push service and the realtime gateway.
- The hub keeps only the status, code and message of a cloud refusal (it showed up to 500 raw
  characters of the response), because `/hub/status` is readable on the LAN without signing in.
- `/ready` answers the typed `503 SERVICE_UNAVAILABLE` (a new code, translated) instead of an
  `INTERNAL_ERROR`; liveness and readiness exist on cloud and hub alike.
- Raw SQL was audited: every `$queryRaw`/`$executeRaw` is a tagged template (parameters bound);
  `Prisma.raw` is used only for constant view aliases, and the one `$queryRawUnsafe` interpolates
  a table name from a fixed union. No change was needed.

### The hub's audit trail reaches the cloud

Audit entries written on the hub (PIN sign-ins and failures, shifts and cash movements, payments,
refunds and cancellations at the till, kitchen actions) stayed on the hub. They now travel through
the existing outbox: `AuditService` asks the `ChangeRecorder` to capture each entry in the
transaction that wrote it (an entry written outside a transaction, such as a failed sign-in,
opens one for the pair), and the hub's `OutboxRecorder` writes an `AUDIT_LOG_APPEND` operation.
The cloud stores the entry once under the hub's restaurant and location (entries without a tenant
are the hub's own), redacts its metadata again, refuses another scope, and never rewrites a stored
entry. Reusing the outbox gives the exactly-once ledger, retries, the POS sync screen and the
failure handling for free; a separate uploader with its own cursor would have needed all of them
again and could skip entries committed out of id order. The cloud's recorder captures nothing, so
cloud audit writes are unchanged.

### The till stays signed in across a restart

The POS desktop app keeps the staff session's refresh token in the operating system's secure
storage (macOS Keychain, Windows Credential Manager, Linux kernel keyring; `keyring` crate,
`secure_token_get`/`secure_token_set` commands). It is read once before the first session refresh
and every rotation and sign-out is written through, in order. A browser build (development, E2E)
keeps it in memory as before; it is never put in web storage. Rotation, reuse detection and
revocation are unchanged, so a stolen copy is as limited as any refresh token, and signing out (or
a refused refresh) deletes it.

## Deferred (remaining gaps)

Recorded in [architecture.md](../architecture.md#known-gaps) rather than built now:

- **`LISTEN/NOTIFY` for the change feed** needs a dedicated PostgreSQL connection outside Prisma
  (a new driver dependency and connection lifecycle). Polling once a second per waiting request is
  fine for tens of hubs per instance; replace it before scaling out, together with a shared
  realtime channel and a shared rate-limit store (the limits are in-memory per API instance).
- **Per-account lockout for password sign-in**: password attempts are limited per IP (and PINs
  per employee code); a distributed guess against one account from many addresses is not.
- **Audit entries of conflict resolution** keep the cloud's full copy of an order (ADR 0014), with
  the customer's contact details, readable with `audit.view`. Kept on purpose (it is the undo
  record); erasure is part of the open customer-privacy item.
- **Dependency and container scanning, secret management and CI** are deployment work; the
  repository ships no pipeline yet. A release checklist is in [release.md](../release.md).
- The web apps' own security headers (CSP for the static admin, KDS and website builds) belong to
  the host serving them.
