import { type Page, expect, test } from '@playwright/test';
import { cancelOrder, placeOrder, posSession } from './pos-api';

const kitchen = {
  email: process.env.SEED_KITCHEN_EMAIL ?? '',
  password: process.env.SEED_KITCHEN_PASSWORD ?? '',
};

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
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
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(kitchen.email);
  await page.getByLabel('Password').fill(kitchen.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // One location: the screen selects it and opens the board, connected live.
  await expect(page.getByRole('link', { name: 'Active' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
}

const ticket = (page: Page, orderNumber: string, station: string) =>
  page.getByRole('article', { name: orderNumber }).filter({ hasText: station });

test('a POS order reaches each station live and moves through the kitchen', async ({
  page,
  request,
}) => {
  await signIn(page);
  const pos = await posSession(request);
  const order = await placeOrder(request, pos, [
    { product: 'Classic Burger', quantity: 2, notes: 'No onions' },
    { product: 'Fries' },
  ]);

  // No reload: the realtime socket brings the new tickets to the screen.
  const grill = ticket(page, order.orderNumber, 'Grill');
  await expect(grill).toBeVisible();
  await expect(grill).toContainText('Classic Burger');
  await expect(grill).toContainText('No onions');
  await expect(ticket(page, order.orderNumber, 'Fryer')).toContainText('Fries');
  await expect(page.getByRole('article', { name: order.orderNumber })).toHaveCount(3);

  // The grill cook works only their station (single-station screens omit the station name).
  await page.getByRole('button', { name: 'Grill', exact: true }).click();
  const grillOnly = page.getByRole('article', { name: order.orderNumber });
  await expect(grillOnly).toHaveCount(1);
  await expect(grillOnly).toContainText('Classic Burger');
  await grillOnly.getByRole('button', { name: 'Start' }).click();
  await expect(grillOnly).toContainText('Preparing');
  await grillOnly.getByRole('button', { name: 'Mark Classic Burger done' }).click();
  await expect(
    grillOnly.getByRole('button', { name: 'Mark Classic Burger not done' }),
  ).toBeVisible();
  await grillOnly.getByRole('button', { name: 'Ready' }).click();
  await expect(grillOnly).toContainText('Ready');
  await grillOnly.getByRole('button', { name: 'Bump' }).click();
  await expect(grillOnly).toBeHidden();

  // A bumped ticket can be recalled.
  await page.getByRole('link', { name: 'Bumped' }).click();
  await grillOnly.getByRole('button', { name: 'Recall' }).click();
  await page.getByRole('link', { name: 'Active' }).click();
  await expect(grillOnly).toContainText('Ready');
});

test('a cancelled order tells the kitchen to stop until acknowledged', async ({
  page,
  request,
}) => {
  await signIn(page);
  const pos = await posSession(request);
  const order = await placeOrder(request, pos, [{ product: 'Fries', quantity: 3 }]);
  const fryer = ticket(page, order.orderNumber, 'Fryer');
  await fryer.getByRole('button', { name: 'Start' }).click();
  await expect(fryer).toContainText('Preparing');

  await cancelOrder(request, await posSession(request, 'OWNER'), order, 'Customer left');
  await expect(fryer).toContainText('Cancelled — stop');
  await expect(fryer.getByRole('button', { name: 'Ready' })).toBeHidden();
  await fryer.getByRole('button', { name: 'Got it' }).click();
  await expect(fryer).toBeHidden();
});

test('rush orders jump the queue on every screen', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Fryer', exact: true }).click();
  const pos = await posSession(request);
  const first = await placeOrder(request, pos, [{ product: 'Fries' }]);
  const second = await placeOrder(request, pos, [{ product: 'Fries' }]);
  const cards = page.getByRole('article');
  const secondCard = page.getByRole('article', { name: second.orderNumber });
  await expect(secondCard).toBeVisible();
  const order = async () =>
    cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const before = await order();
  expect(before.indexOf(first.orderNumber)).toBeLessThan(before.indexOf(second.orderNumber));

  await secondCard.getByRole('button', { name: 'Rush' }).click();
  await expect(secondCard.getByRole('button', { name: 'Normal' })).toBeVisible();
  await expect.poll(async () => (await order())[0]).toBe(second.orderNumber);
});

test('the kitchen screen works in Arabic (RTL)', async ({ page, request }) => {
  await signIn(page);
  const pos = await posSession(request);
  const order = await placeOrder(request, pos, [{ product: 'Kunafa' }]);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('link', { name: 'النشطة' }).click();
  const card = page.getByRole('article', { name: order.orderNumber });
  await expect(card).toContainText('كنافة');
  await expect(card.getByRole('button', { name: 'ابدأ' })).toBeVisible();
  // Mirrored: the order number ends at the card's right edge (in LTR it starts at the left).
  const cardBox = await card.boundingBox();
  const numberBox = await card.getByRole('heading', { name: order.orderNumber }).boundingBox();
  if (!cardBox || !numberBox) throw new Error('not rendered');
  expect(cardBox.x + cardBox.width - (numberBox.x + numberBox.width)).toBeLessThan(40);
});
