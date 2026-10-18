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
pnpm db:seed                                  # demo restaurant + users from SEED_* variables
pnpm build
```

Run the API and admin:

```bash
pnpm --filter @pos/api dev        # http://localhost:3000  (health: /health, /ready)
pnpm --filter @pos/admin dev      # http://localhost:5173  (proxies /api to :3000)
```

Sign in to the admin with `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from your `.env`.

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
pnpm --filter @pos/customer-web dev        # http://localhost:5175 (proxies /api to :3000)
```

It sells for the restaurant in `VITE_RESTAURANT_SLUG` (default `demo-kitchen`, the seed). A
branch takes orders only when online ordering is OPEN (the seed opens `MAIN` when it creates it;
otherwise `PUT /api/v1/locations/:lid/online-ordering { "state": "OPEN" }` as the owner), it is
within its opening hours, and **its hub is running** (a hub silent for 3 minutes makes the
branch "Offline"). With `ONLINE_PAYMENT_PROVIDER=mock` (the `.env` example) the checkout offers a
test card: "Approved" or "Declined" test tokens, no card details, no money. To try the whole flow:
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

Sign in to the POS as the cashier with employee code `1001` and `SEED_CASHIER_PIN` (or with
`SEED_CASHIER_EMAIL`/`PASSWORD` on the Email tab). To point the POS or KDS at the cloud API
directly, set `VITE_API_PROXY_TARGET=http://localhost:3000`. Keyboard shortcuts: F2 order, F4 orders, F6 tables,
`/` search, Ctrl/⌘+Enter place order. A production Tauri build calls the API cross-origin, so
add its origin (`tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows) to
`CORS_ORIGINS`.

## Everyday commands

| Command                                      | What it does                                                    |
| -------------------------------------------- | --------------------------------------------------------------- |
| `pnpm build`                                 | Builds every package and app (Turborepo, dependency-ordered)    |
| `pnpm typecheck`                             | `tsc --noEmit` everywhere                                       |
| `pnpm lint`                                  | ESLint (type-aware + i18n rule)                                 |
| `pnpm test`                                  | Unit + integration tests (integration uses `TEST_DATABASE_URL`) |
| `pnpm test:e2e`                              | Playwright end-to-end tests                                     |
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
pnpm build                      # E2E runs the built API and hub
pnpm test:e2e
```

The admin suite starts the cloud API (:3100) and the admin UI (:5180). The POS and KDS suites run
like a restaurant: `tools/e2e/prepare-hub.mjs` prepares the app's `*_e2e` cloud database,
starts the cloud API just long enough to pair a fresh hub and give it its snapshot, **stops the
cloud**, and then the hub (POS :4110, KDS :4120) and the web UI (POS :1430, KDS :5190) start.
Every POS and KDS test therefore runs without the cloud. The customer-website suite runs
everything at once: the cloud (:3130) stays up, `tools/e2e/pair-hub.mjs` pairs a hub (:4130) with
it, and the POS (:1440, served by that hub) and the website (:5195) start; a website order then
travels cloud → hub → POS and back. `tools/e2e/prepare-db.mjs` refuses any database whose name
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
