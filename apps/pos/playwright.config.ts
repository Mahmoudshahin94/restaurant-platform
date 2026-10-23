import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * POS end-to-end tests, the way a tenant runs: the POS web UI (the same UI the Tauri shell
 * hosts) talks to a location hub, and the cloud is OFF. The hub is paired and provisioned from a
 * freshly seeded cloud database (`pos_kds_pos_e2e`) just before the tests start.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/** The cloud runs only while the hub is paired (port below), then it is stopped. */
const CLOUD_PORT = 3110;
const HUB_PORT = 4110;
const WEB_PORT = 1430;
/** The kitchen display, served from the same hub (the sync test checks offline orders reach it). */
const KDS_PORT = 5191;
process.env.POS_E2E_KDS_URL = `http://localhost:${String(KDS_PORT)}`;
// The kitchen helper (e2e/kitchen-api.ts) talks to the hub directly.
process.env.POS_E2E_API_PORT = String(HUB_PORT);
const e2eDatabaseUrl =
  process.env.POS_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_pos_e2e$1');
const hubDataDir = resolve(tmpdir(), 'pos-kds-e2e-hub-pos');
// The sync test reads the hub's outbox to resend one of its pushes, as a network retry would.
process.env.POS_E2E_HUB_DATA_DIR = hubDataDir;
// The sync test (e2e/sync.spec.ts) brings the cloud back on this port and database.
process.env.POS_E2E_CLOUD_PORT = String(CLOUD_PORT);
process.env.POS_E2E_CLOUD_DATABASE_URL = e2eDatabaseUrl;

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
      // Pair a fresh hub against the cloud, stop the cloud, then serve the POS from the hub only.
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
        HUB_CORS_ORIGINS: `http://localhost:${String(WEB_PORT)},http://localhost:${String(KDS_PORT)}`,
        // Tries the (stopped) cloud at start-up, so the POS shows it is offline.
        HUB_SNAPSHOT_INTERVAL_SECONDS: '3600',
        HUB_CLOUD_TIMEOUT_MS: '1000',
        // Reconnect quickly once the sync test starts the cloud again.
        HUB_SYNC_RETRY_MAX_MS: '3000',
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
    {
      command: `pnpm --filter @pos/kds exec vite --port ${String(KDS_PORT)} --strictPort`,
      url: `http://localhost:${String(KDS_PORT)}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${String(HUB_PORT)}` },
    },
  ],
});
