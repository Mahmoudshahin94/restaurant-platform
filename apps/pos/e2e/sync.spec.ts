import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/**
 * The specification's offline acceptance flow, end to end against the real cloud API:
 * the Internet is down, the cashier takes an order, it reaches the kitchen through the hub; the
 * Internet returns, the order synchronizes exactly once, and syncing again duplicates nothing.
 *
 * Runs last (files run in name order): it starts the cloud, which also uploads everything the
 * other suites recorded offline — any operation the cloud refused would show as a sync error.
 */
const CLOUD = `http://localhost:${process.env.POS_E2E_CLOUD_PORT ?? '3110'}`;
const HUB = `http://localhost:${process.env.POS_E2E_API_PORT ?? '4110'}`;
let cloud: ChildProcess | null = null;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'pos-terminal-preferences',
        JSON.stringify({ state: { locale: 'en', locationId: null }, version: 0 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

test.afterAll(() => {
  if (cloud?.exitCode === null) cloud.kill('SIGTERM');
});

async function startCloud(): Promise<void> {
  cloud = spawn('node', [resolve(import.meta.dirname, '../../api/dist/main.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: process.env.POS_E2E_CLOUD_DATABASE_URL,
      API_PORT: process.env.POS_E2E_CLOUD_PORT ?? '3110',
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    },
    stdio: 'ignore',
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${CLOUD}/ready`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Employee code').fill('1001');
  await page.getByLabel('PIN', { exact: true }).fill(process.env.SEED_CASHIER_PIN ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeVisible();
}

/** The owner's view of the cloud: how many orders carry this number at the location. */
async function cloudOrders(request: APIRequestContext, orderNumber: string): Promise<number> {
  const login = await request.post(`${CLOUD}/api/v1/auth/login`, {
    data: {
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
      client: 'native',
    },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const { locationId } = (await (await request.get(`${HUB}/api/v1/hub/status`)).json()) as {
    locationId: string;
  };
  const orders = (await (
    await request.get(`${CLOUD}/api/v1/locations/${locationId}/orders?limit=200`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  ).json()) as { orderNumber: string }[];
  return orders.filter((o) => o.orderNumber === orderNumber).length;
}

test('an order taken offline synchronizes exactly once when the Internet returns', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page);

  // The cloud is down: the indicator says so, and the order is still taken.
  const indicator = page.getByRole('status').filter({ hasText: /^(Offline|Online|Syncing)/ });
  await expect(indicator).toHaveText(/^Offline · \d+ pending$/);
  await page.getByRole('button', { name: /^Fries/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  const placed = page.getByText(/Order (MAIN-\d+) placed/);
  await expect(placed).toBeVisible();
  const number = /MAIN-\d+/.exec(await placed.innerText())?.[0] ?? '';

  // The synchronization screen lists it as waiting.
  await indicator.click();
  await expect(page.getByRole('heading', { name: 'Synchronization' })).toBeVisible();
  await expect(page.getByText('The cloud cannot be reached.', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: `Order ${number}` }).first()).toBeVisible();

  // The Internet returns.
  await startCloud();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Everything is synchronized with the cloud.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText('Nothing is waiting to be sent.')).toBeVisible();
  await page.getByRole('tab', { name: 'Failed' }).click();
  await expect(page.getByText('No failed changes.')).toBeVisible();
  await expect(indicator).toHaveText(/^Online · \d+ synchronized$/);

  expect(await cloudOrders(request, number)).toBe(1);

  // Syncing again sends nothing new and duplicates nothing.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Everything is synchronized with the cloud.')).toBeVisible();
  expect(await cloudOrders(request, number)).toBe(1);
});
