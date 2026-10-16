# ADR 0007: Tooling choices

- Status: Accepted (2026-10-17)

## Decision

- **Vitest everywhere**, NestJS included (via `unplugin-swc`, which emits decorator metadata).
  One runner, one assertion API. The specification's "Jest where required by NestJS" is not
  needed.
- **Stable majors:** TypeScript 5.9, NestJS 11, Prisma 6, Zod 4, React 19, Vite 7, Vitest 3,
  ESLint 9. Newer majors existed but carry more ecosystem risk. Upgrade them deliberately later.
- **Prisma configuration** lives in `prisma.config.ts`. Environment variables come from the
  repo-root `.env` through `dotenv-cli`.
- **Local Postgres:** developers may use Homebrew/system Postgres or the provided
  docker-compose file.
- **i18n lint:** the community `eslint-plugin-i18next` rule did not report JSX text under
  ESLint 9 with the TypeScript parser. A small, tested local rule
  (`tools/eslint-rules/no-untranslated-jsx.js`) replaces it.
- **Integration tests** apply migrations with `prisma migrate deploy` and truncate tables, and
  only run against a database whose name ends in `_test`.
