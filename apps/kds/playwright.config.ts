import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Kitchen display end-to-end tests: the built API plus the KDS web UI, against a dedicated,
 * freshly migrated and seeded database (`pos_kds_kds_e2e`). Orders are placed through the API
 * (as the POS would) so each test controls exactly what reaches the kitchen.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const API_PORT = 3120;
const WEB_PORT = 5190;
process.env.KDS_E2E_API_PORT = String(API_PORT);
const e2eDatabaseUrl =
  process.env.KDS_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_kds_e2e$1');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1366, height: 900 },
    ...(process.env.CI ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' }),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../../tools/e2e/prepare-db.mjs && node ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(API_PORT),
        DATABASE_URL: e2eDatabaseUrl,
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
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
