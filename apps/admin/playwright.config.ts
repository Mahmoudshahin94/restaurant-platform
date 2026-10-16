import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run the real API (built) and the admin dev server against a dedicated,
 * freshly migrated and seeded database (`pos_kds_e2e`), on ports that do not clash with dev.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const API_PORT = 3100;
const WEB_PORT = 5180;
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_e2e$1');
process.env.E2E_DATABASE_URL = e2eDatabaseUrl;

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
      command: 'node e2e/prepare-db.mjs && node ../api/dist/main.js',
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
