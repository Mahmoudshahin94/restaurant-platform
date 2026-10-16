// Migrates and seeds the dedicated E2E database before the API starts (Playwright starts web
// servers before globalSetup, so this runs as part of the API web-server command).
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL ?? '';
if (!/\/[^/?]*_e2e(\?|$)/.test(url)) {
  console.error(`Refusing to prepare a non-E2E database: ${url}`);
  process.exit(1);
}
const cwd = resolve(import.meta.dirname, '../../../packages/database');
execSync('pnpm exec prisma migrate deploy', { cwd, stdio: 'inherit' });
execSync('pnpm seed', { cwd, stdio: 'inherit' });
