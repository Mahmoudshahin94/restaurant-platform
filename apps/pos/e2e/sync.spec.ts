import { type ChildProcess, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type APIRequestContext, type Browser, type Page, expect, test } from '@playwright/test';

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
const KDS = process.env.POS_E2E_KDS_URL ?? 'http://localhost:5191';
let cloud: ChildProcess | null = null;

test.describe.configure({ mode: 'serial' });

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

/** The Internet drops: the cloud goes away while the tenant keeps working. */
async function stopCloud(): Promise<void> {
  const running = cloud;
  if (!running || running.exitCode !== null) return;
  const exited = new Promise((done) => running.once('exit', done));
  running.kill('SIGTERM');
  await exited;
}

/** The kitchen display, signed in at the same hub. */
async function kitchenScreen(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: KDS,
    viewport: { width: 1366, height: 900 },
  });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'kds-screen-preferences',
        JSON.stringify({
          state: { locale: 'en', locationId: null, stationIds: [], sound: false },
          version: 1,
        }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
  const kds = await context.newPage();
  await kds.goto('/login');
  await kds.getByLabel('Email').fill(process.env.SEED_KITCHEN_EMAIL ?? '');
  await kds.getByLabel('Password').fill(process.env.SEED_KITCHEN_PASSWORD ?? '');
  await kds.getByRole('button', { name: 'Sign in' }).click();
  await expect(kds.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  return kds;
}

/**
 * Sends the cloud, again, exactly what the hub already pushed for an order (its newest order
 * operation and its kitchen tickets'), with the hub's own credential — as a network retry whose
 * first answer was lost would. Returns the cloud's answer per operation.
 */
async function resendHubPush(request: APIRequestContext, orderNumber: string): Promise<string[]> {
  const db = new DatabaseSync(resolve(process.env.POS_E2E_HUB_DATA_DIR ?? '', 'hub.db'), {
    readOnly: true,
  });
  try {
    const pairing = db.prepare("SELECT value FROM hub_state WHERE key = 'pairing'").get() as {
      value: string;
    };
    const { credential } = JSON.parse(pairing.value) as { credential: string };
    const order = db
      .prepare('SELECT id FROM orders WHERE order_number = ? ORDER BY created_at DESC LIMIT 1')
      .get(orderNumber) as { id: string };
    const rows = db
      .prepare(
        `SELECT operation_id, entity_type, entity_id, operation_type, entity_version, payload
         FROM sync_operations s
         WHERE status = 'COMPLETED' AND (entity_id = ? OR (entity_type = 'KitchenTicket'
           AND json_extract(payload, '$.orderId') = ?))
           AND entity_version = (SELECT max(entity_version) FROM sync_operations t
             WHERE t.entity_type = s.entity_type AND t.entity_id = s.entity_id)
         ORDER BY entity_type DESC`,
      )
      .all(order.id, order.id) as {
      operation_id: string;
      entity_type: string;
      entity_id: string;
      operation_type: string;
      entity_version: number;
      payload: string;
    }[];
    expect(rows.map((r) => r.entity_type)).toContain('Order');
    const res = await request.post(`${CLOUD}/api/v1/sync/push`, {
      headers: { authorization: `Device ${credential}` },
      data: {
        operations: rows.map((r) => ({
          operationId: r.operation_id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          operationType: r.operation_type,
          entityVersion: r.entity_version,
          payload: JSON.parse(r.payload) as unknown,
        })),
      },
    });
    expect(res.ok()).toBe(true);
    return ((await res.json()) as { results: { status: string }[] }).results.map((r) => r.status);
  } finally {
    db.close();
  }
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

test('the Internet drops during service: the kitchen still gets the order, and it syncs once', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(150_000);
  if (cloud?.exitCode !== null) await startCloud();
  await signIn(page);
  const indicator = page.getByRole('status').filter({ hasText: /^(Offline|Online|Syncing)/ });
  await expect(indicator).toHaveText(/^Online · \d+ synchronized$/, { timeout: 60_000 });
  const kds = await kitchenScreen(browser);

  // 8. The Internet disconnects in the middle of service.
  await stopCloud();
  await expect(indicator).toHaveText(/^Offline · \d+ pending$/, { timeout: 60_000 });

  // 9. The cashier still takes an order: a burger for the grill and fries for the fryer.
  await page.keyboard.press('F2');
  await page.getByRole('button', { name: /^Classic Burger/ }).click();
  const options = page.getByRole('dialog');
  await options.getByRole('button', { name: /Add to order/ }).click();
  await expect(options).toBeHidden();
  await page.getByRole('button', { name: /^Fries/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  const placed = page.getByText(/Order (MAIN-\d+) placed/);
  await expect(placed).toBeVisible();
  const number = /MAIN-\d+/.exec(await placed.innerText())?.[0] ?? '';

  // 10. It appears on the tenant's kitchen display at once, without the cloud.
  const tickets = kds.getByRole('article', { name: number });
  await expect(tickets.filter({ hasText: 'Fries' })).toBeVisible();
  await expect(tickets.filter({ hasText: 'Classic Burger' }).first()).toBeVisible();
  await tickets.filter({ hasText: 'Fries' }).getByRole('button', { name: 'Start' }).click();
  await expect(tickets.filter({ hasText: 'Fries' })).toContainText('Preparing');

  // 11. The Internet reconnects; 12. the order reaches the cloud exactly once.
  await startCloud();
  await indicator.click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Everything is synchronized with the cloud.')).toBeVisible({
    timeout: 60_000,
  });
  await expect(indicator).toHaveText(/^Online · \d+ synchronized$/);
  expect(await cloudOrders(request, number)).toBe(1);

  // 13. The same push arriving again (a retry after a lost answer) changes nothing.
  const answers = await resendHubPush(request, number);
  expect(answers.length).toBeGreaterThan(1);
  expect(new Set(answers)).toEqual(new Set(['DUPLICATE']));
  expect(await cloudOrders(request, number)).toBe(1);
  await kds.context().close();
});
