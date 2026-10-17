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

Run the POS:

```bash
pnpm --filter @pos/pos dev                 # browser at http://localhost:1420 (proxies /api)
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

Sign in to the POS as the cashier (`SEED_CASHIER_*`). Keyboard shortcuts: F2 order, F4 orders, F6 tables,
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
pnpm --filter @pos/api build    # E2E runs the built API
pnpm test:e2e
```

Each app's `playwright.config.ts` starts the API (admin :3100, POS :3110, KDS :3120) after
`tools/e2e/prepare-db.mjs` migrates the app's `*_e2e` database, clears previous runs' orders and
seeds it. The script refuses any database whose name does not end in `_e2e`. It then starts the
web UI (admin :5180, POS :1430, KDS :5190). The POS and KDS suites drive the other side of the
kitchen flow through the API (the kitchen marks a POS order ready; the POS places orders for the
KDS), using the seeded users.
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

## Troubleshooting

- **Homebrew Postgres fails with "postmaster became multithreaded during startup":** start it
  with a valid locale, e.g. `LC_ALL=en_US.UTF-8 pg_ctl -D /opt/homebrew/var/postgresql@16 start`.
- **`@swc/core` "code signature invalid" on macOS:** some SWC builds ship a badly signed binary.
  The repo pins a working version (1.15.x) for Vitest in `apps/api`.
