# Development setup

## Prerequisites

- Node.js ≥ 22 (see `.nvmrc`) and pnpm 10 (`npm i -g pnpm@10`, or `corepack enable` on Node
  versions that ship corepack).
- PostgreSQL 16, either local (e.g. Homebrew) or via Docker:
  `docker compose -f infrastructure/docker-compose.yml up -d`.
- For the desktop POS: Rust via [rustup](https://rustup.rs) (the repo was set up with
  `--no-modify-path`, so run `source "$HOME/.cargo/env"` or add `~/.cargo/bin` to `PATH`) and,
  on macOS, the Xcode command-line tools.

## First run

```bash
pnpm install
cp infrastructure/.env.example .env          # then adjust DATABASE_URL / TEST_DATABASE_URL
createdb pos_kds_dev && createdb pos_kds_test # skip when using docker compose
pnpm db:deploy                                # apply migrations
pnpm db:seed                                  # demo tenants + users from SEED_* variables
pnpm build
```

The seed provisions four tenants, one per business type ([ADR 0017](adr/0017-tenant-root-and-isolation.md)):
the demo restaurant `demo-kitchen` (owner, cashier and kitchen accounts from `SEED_OWNER_*`,
`SEED_CASHIER_*`, `SEED_KITCHEN_*`), and in `packages/database/seed/tenants/` the coffee shop
`ramallah-roasters`, the supermarket `al-balad-market` and the clothing store `nablus-style`, whose
owners are created only when `SEED_CAFE_OWNER_*`, `SEED_MARKET_OWNER_*` and `SEED_STYLE_OWNER_*` are
set. All four are in shekels (ILS) in `Asia/Hebron` ([ADR 0020](adr/0020-currency-and-localization.md)).
Re-running the seed updates instead of duplicating, but never changes a tenant's own settings: a
database seeded before M4 keeps `demo-kitchen` in riyals until it is reset (`pnpm db:reset`), or
until `SEED_ALIGN_TENANTS=1 pnpm db:seed` realigns it, which changes the currency only while the
tenant has no orders. The E2E databases realign on every run.

An existing development database from before MADAR is upgraded by `pnpm db:deploy` (the tenant
rename keeps every row). A paired development hub upgrades its SQLite, including its pairing
record, at start-up.

Run the API and admin:

```bash
pnpm --filter @pos/api dev        # http://localhost:3000  (health: /health, /ready)
pnpm --filter @pos/admin dev      # http://localhost:5173  (proxies /api to :3000)
```

Sign in to the admin with `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from your `.env`.

Settings → Branding sets the business's name, logo, colours and look
([ADR 0019](adr/0019-branding-and-theme.md)). Uploaded logos and favicons are kept by the
local-disk tenant file storage in `FILE_STORAGE_DIR` (default `.data/files`, relative to the
API's working directory, git-ignored); a hub keeps its copies in `<HUB_DATA_DIR>/files`. Each
screen's Appearance choice (light, dark, system) is kept in that browser.

Run the location hub (the POS and KDS talk to it, as in a restaurant). Pair it once with the
running API, then start it:

```bash
pnpm --filter @pos/gateway build
pnpm --filter @pos/gateway pair -- --cloud http://localhost:3000 --email owner@demo.local --location MAIN
pnpm --filter @pos/gateway start   # http://localhost:4000; data in apps/gateway/.hub-data/
```

Pairing asks for the owner's password (or reads `HUB_PAIR_PASSWORD`), registers the hub as a
device and downloads the location snapshot. The hub keeps working when the API is stopped. While
the API runs, the sync engine sends the hub's outbox to it and follows its change feed, so menu
and settings changes made in the admin reach the hub within seconds (`HUB_*` sync settings in
`.env`, see [sync.md](sync.md)). To start over, stop it and delete `apps/gateway/.hub-data/`.
`GET http://localhost:4000/api/v1/hub/status` shows the pairing, cloud link and sync state; the
POS shows the same in its footer and on its synchronization screen (`/sync`). In the admin portal,
System → Devices shows the paired hub and its outbox, and System → Synchronization lists the
changes the cloud refused, with both versions side by side and the decision to take
([ADR 0014](adr/0014-admin-portal-and-conflict-resolution.md)).

To try offline operation: stop the API, take orders on the POS (footer: "Offline · N pending"),
start the API again and press "Sync now" on the synchronization screen (or wait up to a minute).

Run the customer website (online ordering; it talks to the cloud API):

```bash
pnpm --filter @pos/customer-web dev        # http://demo-kitchen.localhost:5175 (proxies /api to :3000)
```

One website build serves every tenant: the API finds the tenant from the **host name**
([ADR 0023](adr/0023-multi-tenant-website.md)). The seed gives each demo tenant a verified address
`<slug>.<PLATFORM_WEB_DOMAIN>` (default `localhost`), and browsers resolve every `*.localhost` name
to this machine, so open:

| Tenant               | Website                                 |
| -------------------- | --------------------------------------- |
| Demo restaurant      | http://demo-kitchen.localhost:5175      |
| Coffee shop (Arabic) | http://ramallah-roasters.localhost:5175 |
| Supermarket          | http://al-balad-market.localhost:5175   |
| Clothing store       | http://nablus-style.localhost:5175      |

(The supermarket and clothing store have no online ordering by default: switch the module on in
their admin to see their sites.) A database seeded before M7 needs `pnpm db:seed` once to get
these addresses. Bare `http://localhost:5175` shows the tenant in `DEV_DEFAULT_TENANT_SLUG`
(the `.env` example: `demo-kitchen`), development only; any other host that no tenant verified
shows "This website was not found". The Vite proxy keeps the host (`changeOrigin: false`), so the
API sees `demo-kitchen.localhost:5175`.

To try a custom domain: in the admin, Website → Domains → add e.g. `shop.test`, then Verify. With
`DOMAIN_VERIFIER=mock` (the `.env` example) every TXT record is "found"; with `dns` the
`_madar-verify` record must really exist. Browsers do not resolve `shop.test` by themselves: add
`127.0.0.1 shop.test` to `/etc/hosts`, or use a name under `.localhost` that is not under
`PLATFORM_WEB_DOMAIN` (with the default `localhost` that is every `.localhost` name, so set
`PLATFORM_WEB_DOMAIN=madar.localhost` and re-seed to try `a.localhost`, as the E2E suite does). The
website editor (Website → Website editor) saves a draft, opens a preview on the tenant's own site
and publishes.

A branch takes orders only when online ordering is OPEN (the seed opens `MAIN` when it creates it;
otherwise `PUT /api/v1/locations/:lid/online-ordering { "state": "OPEN" }` as the owner), it is
within its opening hours, and **its hub is running** (a hub silent for 3 minutes makes the
branch "Offline"). The seed gives the demo restaurant a test online provider (Settings → Payment
providers, ADR 0024), so its checkout offers a test card: "Approved" or "Declined" test tokens, no
card details, no money. The other demo businesses take cash only until an administrator adds an
online provider there; with `DEV_PAYMENT_PROVIDERS=mock-online` (the `.env` example) every
business without its own account gets the test card too. Provider secrets are sealed with
`PAYMENT_SECRETS_KEY` (unset: a development key derived from `JWT_ACCESS_SECRET`). To try the whole flow:
order on the website, watch the POS (signed in at the hub) announce it, accept or reject it, and
watch the order page change within a few seconds. Unaccepted orders are cancelled after
`onlineAcceptMinutes` (10).

Run the POS:

```bash
pnpm --filter @pos/pos dev                 # browser at http://localhost:1420 (proxies /api to the hub)
pnpm --filter @pos/pos tauri:dev           # same UI in the native Tauri window
pnpm --filter @pos/pos tauri:build         # installable app; set VITE_API_URL for production
pnpm --filter @pos/pos rust:check          # cargo fmt --check, clippy -D warnings, cargo test
```

Run the kitchen display (KDS):

```bash
pnpm --filter @pos/kds dev        # http://localhost:5174 (proxies /api, incl. the realtime socket)
```

Sign in as the kitchen user (`SEED_KITCHEN_*`). The screen remembers its location, the stations
it shows (none = all, the expo view) and whether to chime for new tickets; browsers only play
sound after one tap on "Turn on sound alerts". Orders placed at the POS appear on the KDS within a
second through the realtime socket.

Run the self-service kiosk (MADAR M6, [ADR 0022](adr/0022-self-service-kiosk.md)), a LAN
client of the hub like the KDS:

```bash
pnpm --filter @pos/kiosk dev      # http://localhost:5176 (proxies /api to the hub)
```

In the admin, System → Devices → Add a device → Self-service kiosk shows a pairing code; type it
on the kiosk's first screen (the hub needs the code from its next snapshot: within seconds while
the API runs). The demo restaurant has `SELF_CHECKOUT` on in its seed; the supermarket gets it from
its business type. Card payments at the kiosk need a kiosk card reader provider: add a "Test card
reader" in Settings → Payment providers, or set `DEV_PAYMENT_PROVIDERS=mock-terminal` in `.env` for
every business without one (the documented test terminal: every card is approved). Staff leave the customer screens with the
corner button, an employee code and PIN, and the `kiosk.attend` permission (the demo cashier has
it). To pair the browser again, unpair it from the attendant menu.

Sign in to the POS as the cashier with employee code `1001` and `SEED_CASHIER_PIN` (or with
`SEED_CASHIER_EMAIL`/`PASSWORD` on the Email tab). The desktop app keeps the session's refresh token in the
operating system's keychain, so it stays signed in across a restart until someone signs out; in a
browser the session lasts until the page is reloaded. To point the POS or KDS at the cloud API
directly, set `VITE_API_PROXY_TARGET=http://localhost:3000`. Keyboard shortcuts: F2 order, F4 orders, F6 tables,
`/` search, Ctrl/⌘+Enter place order. A production Tauri build calls the API cross-origin, so
add its origin (`tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows) to
`CORS_ORIGINS`.

## The platform admin (MADAR M9)

MADAR's own operators use `apps/platform-admin` (http://localhost:5177, `pnpm --filter
@pos/platform-admin dev`), a separate sign-in from the business admin (ADR 0025). There is no
sign-up: create the first owner once, with the password in the environment (12+ characters):

```bash
pnpm --filter @pos/api build
PLATFORM_USER_PASSWORD='choose-a-long-one' pnpm platform:create-owner -- --email ops@madar.local --name "MADAR Ops"
```

`--role OPERATOR|SUPPORT|VIEWER` creates other operators (default OWNER), `--locale ar` an
Arabic-speaking one. Add `http://localhost:5177` to `CORS_ORIGINS` in `.env` (the refresh cookie
checks the origin).

## Everyday commands

| Command                                      | What it does                                                    |
| -------------------------------------------- | --------------------------------------------------------------- |
| `pnpm build`                                 | Builds every package and app (Turborepo, dependency-ordered)    |
| `pnpm typecheck`                             | `tsc --noEmit` everywhere                                       |
| `pnpm lint`                                  | ESLint (type-aware + i18n rule)                                 |
| `pnpm test`                                  | Unit + integration tests (integration uses `TEST_DATABASE_URL`) |
| `pnpm e2e`                                   | Every Playwright suite, one after another (32 critical flows)   |
| `pnpm test:e2e`                              | Playwright end-to-end tests (suites in parallel)                |
| `pnpm test:tools`                            | Tests for repository tools (lint rule, printer decoder)         |
| `pnpm printer:sim`                           | Simulated ESC/POS network printer on port 9100                  |
| `pnpm db:migrate`                            | Create/apply a migration in development (`prisma migrate dev`)  |
| `pnpm --filter @pos/database migrate:status` | Check for drift / pending migrations                            |

## End-to-end tests (Playwright)

```bash
createdb pos_kds_e2e            # once (admin suite; or set E2E_DATABASE_URL)
createdb pos_kds_pos_e2e        # once (POS suite; or set POS_E2E_DATABASE_URL)
createdb pos_kds_kds_e2e        # once (KDS suite; or set KDS_E2E_DATABASE_URL)
createdb pos_kds_web_e2e        # once (customer website suite; or set WEB_E2E_DATABASE_URL)
createdb pos_kds_kiosk_e2e      # once (kiosk suite; or set KIOSK_E2E_DATABASE_URL)
createdb pos_kds_platform_e2e   # once (platform admin suite; or set PLATFORM_E2E_DATABASE_URL)
pnpm build                      # E2E runs the built API and hub
pnpm e2e                        # all six suites, one after another (a few minutes)
```

[testing.md](testing.md) maps the specification's 19 critical scenarios to the tests and explains
the other test layers; `pnpm test:tools` checks that every test named there exists. Run one suite
with `pnpm --filter @pos/pos test:e2e`, one file with
`pnpm --filter @pos/pos exec playwright test e2e/sync.spec.ts`.

The admin suite starts the cloud API (:3100) and the admin UI (:5180). The POS and KDS suites run
like a restaurant: `tools/e2e/prepare-hub.mjs` prepares the app's `*_e2e` cloud database,
starts the cloud API just long enough to pair a fresh hub and give it its snapshot, **stops the
cloud**, and then the hub (POS :4110, KDS :4120) and the web UI (POS :1430, KDS :5190) start.
Every POS and KDS test therefore runs without the cloud. The POS suite also serves the KDS
(:5191) from its hub, and its last file, `sync.spec.ts`, starts and stops the cloud itself: an
order taken offline syncs once, the Internet dropping mid-service still gets the order to the
kitchen, and a resent copy of the hub's push is answered `DUPLICATE`. The customer-website suite runs
everything at once: the cloud (:3130) stays up, `tools/e2e/pair-hub.mjs` pairs a hub (:4130) with
it, and the POS (:1440) and KDS (:5196), both served by that hub, and the website (:5195) start;
a website order then travels cloud → hub → POS and back, and `journey.spec.ts` follows one through
every app to its hand-over. The kiosk suite runs two locations with the cloud off:
`tools/e2e/prepare-kiosk-hubs.mjs` starts the cloud (:3140), creates two kiosks waiting to pair at
the demo restaurant and two at the supermarket (their codes go to a temporary file), pairs a hub
for each (:4140, :4141), stops the cloud and serves both hubs; the kiosks (:5201 restaurant, :5202
supermarket) and the restaurant's KDS (:5203) start. A card-paid kiosk order reaches the KDS, a
pay-at-counter order in Arabic is collected by the cashier, and the supermarket's scanned items
become a completed sale. The platform admin suite starts the cloud (:3150) after creating its
operator with `create-platform-owner`, and the platform admin (:5198): an operator provisions a
coffee shop, suspends it (its owner's sign-in is refused), reactivates it and, in Arabic, corrects
an order's status through the support tools. `tools/e2e/prepare-db.mjs` refuses any database whose name
does not end in `_e2e`.
Locally it uses the installed Google Chrome (`PLAYWRIGHT_CHANNEL`, default `chrome`). In CI, run
`pnpm exec playwright install chromium` first.

## Receipt printers

The POS prints to the browser's print dialog by default. Under **Settings** a terminal can switch
to a network ESC/POS printer (host, port 9100–9109, 58 or 80 mm paper); network printing needs
the Tauri shell, which sends the job over TCP.

Without hardware, run `pnpm printer:sim` and point the POS at `127.0.0.1:9100`. The simulator
decodes each raster job and saves the raw bytes (`.bin`) and the printed image (`.pbm`, open it
with Preview) under `tools/printer-sim/out/`.

## Database migrations

- The schema lives in `packages/database/prisma/schema.prisma`, and migrations are committed
  under `prisma/migrations/`.
- Create migrations with `pnpm db:migrate --name <change>` and review the generated SQL before
  committing. Never edit an applied migration.
- Integration tests run `prisma migrate deploy` against `TEST_DATABASE_URL` (which must contain
  `_test`) and truncate tables between suites. They never touch the development database.
- `prisma migrate reset` is destructive and is intentionally not used by any automated script.
  Run `pnpm db:reset` yourself when you want a clean development database.
- **Every schema change also updates the hub (SQLite).** After a cloud migration, run
  `pnpm --filter @pos/database hub:schema` (regenerates `prisma/hub/schema.prisma`) and
  `pnpm --filter @pos/database hub:migration <name>` (writes the hub migration), then commit
  both. The hub applies its migrations itself at start-up. `pnpm build` and the
  `hub-schema.contract` test fail while the two schemas differ. Avoid PostgreSQL-only Prisma
  features in shared code (`String[]`, `mode: 'insensitive'` outside admin-only modules,
  `skipDuplicates`, raw SQL outside `SqlDialect`).
- **Cloud-only SQL** (the Phase 9 reporting views, ADR 0015) goes in a cloud migration as plain
  SQL that Prisma does not model, and is read only by cloud-only modules (`apps/api`). Views need
  no hub change; a change that alters a Prisma model still does.

## Troubleshooting

- **Homebrew Postgres fails with "postmaster became multithreaded during startup":** start it
  with a valid locale, e.g. `LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@16 start`.
- **`@swc/core` "code signature invalid" on macOS:** some SWC builds ship a badly signed binary.
  The repo pins a working version (1.15.x) for Vitest in `apps/api`.
