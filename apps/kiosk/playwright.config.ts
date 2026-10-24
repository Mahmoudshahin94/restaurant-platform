import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Kiosk end-to-end tests (ADR 0022), the way a business runs them: two location hubs with the
 * cloud OFF (it only runs to create the kiosks and pair the hubs, from `pos_kds_kiosk_e2e`). The
 * demo restaurant's kiosk sends paid orders to its kitchen screen (the KDS app, on the same hub);
 * the supermarket's kiosk is a self-checkout.
 */
const ROOT_ENV = resolve(import.meta.dirname, '../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const CLOUD_PORT = 3140;
const RESTAURANT_HUB = 4140;
const MARKET_HUB = 4141;
const RESTAURANT_KIOSK = 5201;
const MARKET_KIOSK = 5202;
const KITCHEN = 5203;

const e2eDatabaseUrl =
  process.env.KIOSK_E2E_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/[^/?]+(\?|$)/, '/pos_kds_kiosk_e2e$1');
const codesFile = resolve(tmpdir(), 'pos-kds-e2e-kiosk-codes.json');
process.env.KIOSK_E2E_CODES = codesFile;
process.env.KIOSK_E2E_KITCHEN_URL = `http://localhost:${KITCHEN}`;
process.env.KIOSK_E2E_RESTAURANT_HUB = `http://localhost:${RESTAURANT_HUB}`;
process.env.KIOSK_E2E_MARKET_HUB = `http://localhost:${MARKET_HUB}`;

/** The supermarket's staff exist only when their seed variables are set (optional demo tenant). */
const market = {
  SEED_MARKET_OWNER_EMAIL: 'market-owner@e2e.local',
  SEED_MARKET_OWNER_PASSWORD: 'E2e-Market-Owner-1',
  SEED_MARKET_CASHIER_EMAIL: 'market-cashier@e2e.local',
  SEED_MARKET_CASHIER_PASSWORD: 'E2e-Market-Cashier-1',
  SEED_MARKET_CASHIER_PIN: '1357',
};
Object.assign(process.env, market);

const kiosk = (port: number, hub: number) => ({
  command: `pnpm exec vite --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { VITE_API_PROXY_TARGET: `http://localhost:${hub}` },
});

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1366, height: 900 },
    ...(process.env.CI ? {} : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' }),
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'restaurant',
      testMatch: /restaurant\.spec\.ts/,
      use: { baseURL: `http://localhost:${RESTAURANT_KIOSK}` },
    },
    {
      name: 'self-checkout',
      testMatch: /self-checkout\.spec\.ts/,
      use: { baseURL: `http://localhost:${MARKET_KIOSK}` },
    },
  ],
  webServer: [
    {
      command: 'node ../../tools/e2e/prepare-kiosk-hubs.mjs',
      url: `http://localhost:${MARKET_HUB}/ready`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: e2eDatabaseUrl,
        CLOUD_PORT: String(CLOUD_PORT),
        KIOSK_E2E_CODES: codesFile,
        HUB_CORS_ORIGINS: [RESTAURANT_KIOSK, MARKET_KIOSK, KITCHEN]
          .map((p) => `http://localhost:${p}`)
          .join(','),
        ...market,
        KIOSK_E2E_HUBS: JSON.stringify([
          {
            key: 'restaurant',
            email: process.env.SEED_OWNER_EMAIL ?? '',
            password: process.env.SEED_OWNER_PASSWORD ?? '',
            location: 'MAIN',
            port: RESTAURANT_HUB,
            dataDir: resolve(tmpdir(), 'pos-kds-e2e-hub-kiosk-restaurant'),
          },
          {
            key: 'market',
            email: market.SEED_MARKET_OWNER_EMAIL,
            password: market.SEED_MARKET_OWNER_PASSWORD,
            location: 'BLD',
            port: MARKET_HUB,
            dataDir: resolve(tmpdir(), 'pos-kds-e2e-hub-kiosk-market'),
          },
        ]),
      },
    },
    kiosk(RESTAURANT_KIOSK, RESTAURANT_HUB),
    kiosk(MARKET_KIOSK, MARKET_HUB),
    {
      // The restaurant's kitchen screen, on the same hub.
      command: `pnpm --filter @pos/kds exec vite --port ${KITCHEN} --strictPort`,
      url: `http://localhost:${KITCHEN}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://localhost:${RESTAURANT_HUB}` },
    },
  ],
});
