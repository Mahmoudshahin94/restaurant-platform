import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

/**
 * The whole platform in one journey (ADR 0016), every app running against the real cloud and hub:
 * a customer orders on the website (cloud) → the hub receives it through the change feed → the
 * cashier accepts it at the POS → the tickets reach the kitchen display → the kitchen starts and
 * finishes them → the cashier takes the money and hands the order over → the customer's page
 * follows every step.
 */
const POS = process.env.WEB_E2E_POS_URL ?? 'http://localhost:1440';
const KDS = process.env.WEB_E2E_KDS_URL ?? 'http://localhost:5196';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** A fresh browser for one app, with its stored preferences set before the first load. */
async function app(
  browser: Browser,
  baseURL: string,
  storageKey: string,
  state: Record<string, unknown>,
): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } });
  contexts.push(context);
  await context.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('e2e-init')) {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify({ state: value, version: 1 }));
        sessionStorage.setItem('e2e-init', '1');
      }
    },
    [storageKey, state] as const,
  );
  return context.newPage();
}

test('one order through every app: website, cloud, hub, POS, kitchen and back', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const status = page.getByTestId('order-status');

  // The customer orders a burger and fries for pickup, paying when collecting.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'web-preferences',
        JSON.stringify({ state: { locale: 'en' }, version: 1 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'View menu · Main Branch' }).click();
  await page.getByRole('button', { name: 'Add Classic Burger' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to cart/ })
    .click();
  await page.getByRole('button', { name: 'Add Fries' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to cart/ })
    .click();
  await page.getByRole('link', { name: /View cart/ }).click();
  // Seed prices, VAT included: burger (medium) 28.00 + fries 9.00.
  await expect(page.getByTestId('total')).toHaveText(/37\.00/);
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Journey E2E');
  await page.getByLabel('Mobile number').fill('+966500000777');
  await page.getByRole('button', { name: /Place order · SAR\s?37\.00/ }).click();
  const sent = await page.getByText(/Order W-\d+ was sent to Main Branch/).innerText();
  const number = /W-\d+/.exec(sent)?.[0] ?? '';
  expect(number).not.toBe('');
  await page.getByRole('link', { name: 'Follow your order' }).click();
  await expect(status).toHaveText('Waiting for the store');

  // The kitchen display is on, showing every station (expo view).
  const kds = await app(browser, KDS, 'kds-screen-preferences', {
    locale: 'en',
    locationId: null,
    stationIds: [],
    sound: false,
  });
  await kds.goto('/login');
  await kds.getByLabel('Email').fill(process.env.SEED_KITCHEN_EMAIL ?? '');
  await kds.getByLabel('Password').fill(process.env.SEED_KITCHEN_PASSWORD ?? '');
  await kds.getByRole('button', { name: 'Sign in' }).click();
  await expect(kds.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  // Not accepted yet: nothing for the kitchen.
  await expect(kds.getByRole('article', { name: number })).toHaveCount(0);

  // The cashier signs in at the till, opens a shift and accepts the order when it arrives.
  const pos = await app(browser, POS, 'pos-terminal-preferences', {
    locale: 'en',
    locationId: null,
    shiftId: null,
    printer: { kind: 'browser', paper: '80mm' },
  });
  await pos.goto('/login');
  await pos.getByLabel('Employee code').fill('1001');
  await pos.getByLabel('PIN', { exact: true }).fill(process.env.SEED_CASHIER_PIN ?? '');
  await pos.getByRole('button', { name: 'Sign in' }).click();
  await expect(pos).toHaveURL(/\/order$/);
  const incoming = pos.getByRole('dialog');
  await expect(incoming.getByRole('heading', { name: `Online order ${number}` })).toBeVisible({
    timeout: 30_000,
  });
  await incoming.getByRole('button', { name: 'Accept' }).click();
  await expect(pos.getByText(`Order ${number} accepted and sent to the kitchen.`)).toBeVisible();
  await expect(status).toHaveText('Accepted', { timeout: 30_000 });

  // The tickets reach the kitchen display live, one per station.
  const grill = kds.getByRole('article', { name: number }).filter({ hasText: 'Grill' });
  const fryer = kds.getByRole('article', { name: number }).filter({ hasText: 'Fryer' });
  await expect(grill).toContainText('Classic Burger', { timeout: 15_000 });
  await expect(fryer).toContainText('Fries');

  // The kitchen starts: the customer sees the order being prepared. Every station's ticket is
  // started and finished (the burger goes to two stations).
  const tickets = kds.getByRole('article', { name: number });
  await grill.getByRole('button', { name: 'Start' }).click();
  await expect(grill).toContainText('Preparing');
  await expect(status).toHaveText('Being prepared', { timeout: 30_000 });
  const count = await tickets.count();
  for (const action of ['Start', 'Ready']) {
    const buttons = tickets.getByRole('button', { name: action, exact: true });
    for (let left = await buttons.count(); left > 0; left -= 1) {
      await buttons.first().click();
      await expect(buttons).toHaveCount(left - 1);
    }
  }
  await expect(tickets.getByRole('button', { name: 'Bump', exact: true })).toHaveCount(count);

  // The till hears it is ready; the customer pays cash at pickup and collects it.
  await expect(status).toHaveText('Ready', { timeout: 30_000 });
  await expect(page.getByText('Your order is ready to collect.')).toBeVisible();
  await expect(pos.getByText(`Order ${number} is ready`)).toBeVisible({ timeout: 15_000 });
  await pos.keyboard.press('F8');
  const continueOpen = pos.getByRole('button', { name: 'Continue that shift' });
  const openButton = pos.getByRole('button', { name: 'Open shift' });
  await expect(
    continueOpen.or(openButton).or(pos.getByRole('button', { name: 'Close shift' })),
  ).toBeVisible();
  if (await continueOpen.isVisible()) await continueOpen.click();
  else if (await openButton.isVisible()) {
    await pos.getByLabel(/Opening cash/).fill('100');
    await openButton.click();
  }
  await expect(pos.getByRole('button', { name: 'Close shift' })).toBeVisible();
  await pos.keyboard.press('F4');
  await pos
    .getByRole('list', { name: 'Open' })
    .getByRole('button', { name: new RegExp(number) })
    .click();
  await pos.getByRole('button', { name: 'Take payment' }).click();
  const payment = pos.getByRole('dialog');
  await expect(payment.getByTestId('balance-due')).toHaveText(/37\.00/);
  await payment.getByRole('button', { name: /^Confirm/ }).click();
  await expect(payment.getByText(/Order fully paid/)).toBeVisible();
  await pos.keyboard.press('Escape');
  await pos.getByRole('button', { name: 'Complete order' }).click();
  await expect(pos.getByRole('button', { name: 'Complete order' })).toBeHidden();

  // The customer's page shows the order done; the kitchen board is clear of it once bumped.
  await expect(status).toHaveText('Completed', { timeout: 30_000 });
  await expect(page.getByText('Enjoy your meal!')).toBeVisible();
});
