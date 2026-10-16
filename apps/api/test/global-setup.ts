import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { testConfig } from './env';

/**
 * Applies pending migrations to the dedicated test database (non-destructive). Each suite then
 * empties its tables with `resetDatabase()` from helpers.ts.
 */
export default function setup(): void {
  const config = testConfig();
  if (!config.DATABASE_URL.includes('_test')) {
    throw new Error('Refusing to run integration tests against a non-test database');
  }
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '../../../packages/database'),
    env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
    stdio: 'pipe',
  });
}
