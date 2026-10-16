# Development setup

## Prerequisites

- Node.js ≥ 22 (see `.nvmrc`) and pnpm 10 (`npm i -g pnpm@10`, or `corepack enable` on Node
  versions that ship corepack).
- PostgreSQL 16, either local (e.g. Homebrew) or via Docker:
  `docker compose -f infrastructure/docker-compose.yml up -d`.
- From Phase 2: Rust (`rustup`) and the Tauri 2 prerequisites for the desktop POS.

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

## Everyday commands

| Command                                      | What it does                                                    |
| -------------------------------------------- | --------------------------------------------------------------- |
| `pnpm build`                                 | Builds every package and app (Turborepo, dependency-ordered)    |
| `pnpm typecheck`                             | `tsc --noEmit` everywhere                                       |
| `pnpm lint`                                  | ESLint (type-aware + i18n rule)                                 |
| `pnpm test`                                  | Unit + integration tests (integration uses `TEST_DATABASE_URL`) |
| `pnpm test:e2e`                              | Playwright end-to-end tests                                     |
| `pnpm test:tools`                            | Tests for repository-local lint rules                           |
| `pnpm db:migrate`                            | Create/apply a migration in development (`prisma migrate dev`)  |
| `pnpm --filter @pos/database migrate:status` | Check for drift / pending migrations                            |

## End-to-end tests (Playwright)

```bash
createdb pos_kds_e2e            # once (or set E2E_DATABASE_URL)
pnpm --filter @pos/api build    # E2E runs the built API
pnpm test:e2e
```

`apps/admin/playwright.config.ts` starts the API on :3100, after migrating and seeding the
`*_e2e` database (`e2e/prepare-db.mjs` refuses any other database), and the admin on :5180.
Locally it uses the installed Google Chrome (`PLAYWRIGHT_CHANNEL`, default `chrome`). In CI, run
`pnpm exec playwright install chromium` first.

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
