import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Kitchen display end-to-end tests, the way a restaurant runs: the KDS talks to a location hub
 * while the cloud is OFF (it only runs to pair the hub, from `pos_kds_kds_e2e`). Orders are placed
 * through the hub's API, as the POS would, so each test controls what reaches the kitchen.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/** The cloud runs only while the hub is paired, then it is stopped. */
const CLOUD_PORT = 3120;
const HUB_PORT = 4120;
const WEB_PORT = 5190;
process.env.KDS_E2E_API_PORT = String(HUB_PORT);
const e2eDatabaseUrl =
  process.env.KDS_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_kds_e2e$1');
const hubDataDir = resolve(tmpdir(), 'pos-kds-e2e-hub-kds');

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
      // Pair a fresh hub against the cloud, stop the cloud, then serve the KDS from the hub only.
      command: 'node ../../tools/e2e/prepare-hub.mjs && node ../gateway/dist/main.js',
      url: `http://localhost:${HUB_PORT}/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: e2eDatabaseUrl,
        CLOUD_PORT: String(CLOUD_PORT),
        HUB_PORT: String(HUB_PORT),
        HUB_DATA_DIR: hubDataDir,
        HUB_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        HUB_SNAPSHOT_INTERVAL_SECONDS: '3600',
        HUB_CLOUD_TIMEOUT_MS: '1000',
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${HUB_PORT}` },
    },
  ],
});
