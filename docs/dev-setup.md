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
device and downloads the location snapshot. The hub keeps working when the API is stopped; it
refreshes the snapshot every `HUB_SNAPSHOT_INTERVAL_SECONDS` when the API is reachable. To start
over, stop it and delete `apps/gateway/.hub-data/`. `GET http://localhost:4000/api/v1/hub/status`
shows the pairing, cloud link and outbox size.

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
pnpm build                      # E2E runs the built API and hub
pnpm test:e2e
```

The admin suite starts the cloud API (:3100) and the admin UI (:5180). The POS and KDS suites run
like a restaurant: `tools/e2e/prepare-hub.mjs` prepares the app's `*_e2e` cloud database,
starts the cloud API just long enough to pair a fresh hub and give it its snapshot, **stops the
cloud**, and then the hub (POS :4110, KDS :4120) and the web UI (POS :1430, KDS :5190) start.
Every POS and KDS test therefore runs without the cloud. `tools/e2e/prepare-db.mjs` refuses any
database whose name does not end in `_e2e`.
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

## Troubleshooting

- **Homebrew Postgres fails with "postmaster became multithreaded during startup":** start it
  with a valid locale, e.g. `LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@16 start`.
- **`@swc/core` "code signature invalid" on macOS:** some SWC builds ship a badly signed binary.
  The repo pins a working version (1.15.x) for Vitest in `apps/api`.
