import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The platform admin end to end (ADR 0025): the real API (built) and the platform admin's dev
 * server against a dedicated, freshly migrated and seeded database (`pos_kds_platform_e2e`), on
 * ports of their own. The API command first creates the operator the tests sign in as, through
 * the same CLI an installation uses for its first owner.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const API_PORT = 3150;
const WEB_PORT = 5198;
const e2eDatabaseUrl =
  process.env.PLATFORM_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_platform_e2e$1');
process.env.PLATFORM_E2E_DATABASE_URL = e2eDatabaseUrl;
// The operator of this suite (read by the tests too). The database keeps platform users between
// runs, so creating it again is allowed to fail: the e-mail and password stay the same.
process.env.PLATFORM_E2E_OPERATOR_EMAIL ??= 'operator-e2e@platform.test';
process.env.PLATFORM_USER_PASSWORD ??= 'E2E-Platform-Operator-1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Locally use the installed Chrome; CI installs Playwright's Chromium.
    ...(process.env.CI ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' }),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: [
        'node ../../tools/e2e/prepare-db.mjs',
        `(node ../api/dist/create-platform-owner.js --email ${process.env.PLATFORM_E2E_OPERATOR_EMAIL} --name "E2E Operator" --role OPERATOR || echo "operator already exists")`,
        'node ../api/dist/main.js',
      ].join(' && '),
      url: `http://localhost:${API_PORT}/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(API_PORT),
        DATABASE_URL: e2eDatabaseUrl,
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
        PLATFORM_USER_PASSWORD: process.env.PLATFORM_USER_PASSWORD,
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
