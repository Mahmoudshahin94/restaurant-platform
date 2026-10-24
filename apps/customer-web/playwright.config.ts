import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Customer website end-to-end tests: the specification's acceptance steps 14–17. A customer orders
 * on the website (cloud API, `pos_kds_web_e2e`), the order reaches the location's hub through the
 * change feed, the POS (served from the hub) accepts or rejects it, and the customer sees the new
 * status. Everything runs: cloud, hub, POS, kitchen display and website; journey.spec.ts follows
 * one order through all of them.
 *
 * The website is reached on its tenant's own host (ADR 0023): MADAR's web domain is
 * `madar.localhost` here, so the demo restaurant answers on `demo-kitchen.madar.localhost`, and
 * tenant-websites.spec.ts adds `a.localhost` and `b.localhost` as two businesses' own domains.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const CLOUD_PORT = 3130;
const HUB_PORT = 4130;
const POS_PORT = 1440;
const WEB_PORT = 5195;
const KDS_PORT = 5196;
process.env.WEB_E2E_KDS_URL = `http://localhost:${String(KDS_PORT)}`;
process.env.WEB_E2E_CLOUD_PORT = String(CLOUD_PORT);
process.env.WEB_E2E_HUB_PORT = String(HUB_PORT);
process.env.WEB_E2E_POS_URL = `http://localhost:${String(POS_PORT)}`;
process.env.WEB_E2E_WEB_PORT = String(WEB_PORT);
// The coffee shop's owner (an optional demo account) runs the second business.
process.env.SEED_CAFE_OWNER_EMAIL ??= 'cafe-owner@demo.local';
process.env.SEED_CAFE_OWNER_PASSWORD ??= 'Dev-Only-Cafe-Pass-1';
const WEB_DOMAIN = 'madar.localhost';
const e2eDatabaseUrl =
  process.env.WEB_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_web_e2e$1');
const hubDataDir = resolve(tmpdir(), 'pos-kds-e2e-hub-web');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: `http://demo-kitchen.${WEB_DOMAIN}:${String(WEB_PORT)}`,
    viewport: { width: 1280, height: 900 },
    ...(process.env.CI ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' }),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // The cloud, on a freshly migrated and seeded database; it stays up for the whole suite.
      command: 'node ../../tools/e2e/prepare-db.mjs && node ../api/dist/main.js',
      url: `http://localhost:${String(CLOUD_PORT)}/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: e2eDatabaseUrl,
        API_PORT: String(CLOUD_PORT),
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
        WEB_ORDER_RATE_LIMIT_PER_MINUTE: '1000',
        TRACKING_RATE_LIMIT_PER_MINUTE: '10000',
        ONLINE_PAYMENT_PROVIDER: 'mock',
        WEB_ORDER_TIMEOUT_SWEEP_SECONDS: '5',
        // Websites by host (ADR 0023); the seed gives each tenant `<slug>.madar.localhost`.
        PLATFORM_WEB_DOMAIN: WEB_DOMAIN,
        DOMAIN_VERIFIER: 'mock',
        WEBSITE_URL: `http://{domain}:${String(WEB_PORT)}`,
      },
    },
    {
      // A hub paired with that cloud, following its change feed.
      command: 'node ../../tools/e2e/pair-hub.mjs && node ../gateway/dist/main.js',
      url: `http://localhost:${String(HUB_PORT)}/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        NODE_ENV: 'test',
        CLOUD_PORT: String(CLOUD_PORT),
        HUB_PORT: String(HUB_PORT),
        HUB_DATA_DIR: hubDataDir,
        HUB_CORS_ORIGINS: `http://localhost:${String(POS_PORT)},http://localhost:${String(KDS_PORT)}`,
        HUB_CLOUD_TIMEOUT_MS: '3000',
        HUB_SYNC_RETRY_MAX_MS: '3000',
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
    {
      command: `pnpm --filter @pos/pos exec vite --port ${String(POS_PORT)} --strictPort`,
      url: `http://localhost:${String(POS_PORT)}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${String(HUB_PORT)}` },
    },
    {
      // The kitchen display, served like the POS from the hub (journey.spec.ts).
      command: `pnpm --filter @pos/kds exec vite --port ${String(KDS_PORT)} --strictPort`,
      url: `http://localhost:${String(KDS_PORT)}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${String(HUB_PORT)}` },
    },
    {
      command: `pnpm exec vite --port ${String(WEB_PORT)} --strictPort`,
      url: `http://localhost:${String(WEB_PORT)}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${String(CLOUD_PORT)}` },
    },
  ],
});
