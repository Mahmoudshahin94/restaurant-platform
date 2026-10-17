import { type Page, expect, test } from '@playwright/test';

const cashier = {
  email: process.env.SEED_CASHIER_EMAIL ?? '',
  password: process.env.SEED_CASHIER_PASSWORD ?? '',
};

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

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(cashier.email);
  await page.getByLabel('Password').fill(cashier.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // One location: the terminal selects it automatically and opens order entry.
  await expect(page.getByRole('button', { name: 'Place order' })).toBeVisible();
}

async function addBurgerWithCheese(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Classic Burger/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /Extra cheese/ }).click();
  await dialog.getByRole('button', { name: /Add to order/ }).click();
  await expect(dialog).toBeHidden();
}

test('cashier creates a dine-in order for a table', async ({ page }) => {
  await signIn(page);
  await page.getByRole('radio', { name: 'Dine-in' }).click();
  await page.getByLabel('Table').selectOption({ label: 'T2 · Indoor' });
  await addBurgerWithCheese(page);
  await page.getByRole('button', { name: /^Fries/ }).click();
  // Seed prices: burger 28.00 + cheese 3.00 + fries 9.00.
  await expect(page.getByTestId('cart-total')).toHaveText(/40\.00/);

  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText(/Order MAIN-\d+ placed/)).toBeVisible();

  await page.getByRole('link', { name: /Tables/ }).click();
  await expect(page.getByRole('button', { name: /^T2 · MAIN-\d+/ })).toBeVisible();
});

test('cashier creates a takeaway order and the server confirms the same total', async ({
  page,
}) => {
  await signIn(page);
  await page.getByPlaceholder('Customer name').fill('Sara');
  await page.getByRole('button', { name: /Cola/ }).click();
  await page.getByRole('dialog').getByRole('radio', { name: /Large/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to order/ })
    .click();
  await page.getByRole('button', { name: 'Increase quantity of Cola' }).click();
  const previewed = await page.getByTestId('cart-total').innerText();
  expect(previewed).toMatch(/16\.00/);

  await page.keyboard.press('Control+Enter');
  const placed = page.getByText(/Order (MAIN-\d+) placed/);
  await expect(placed).toBeVisible();
  const number = /MAIN-\d+/.exec(await placed.innerText())?.[0] ?? '';

  await page.keyboard.press('F4');
  await page.getByRole('button', { name: new RegExp(number) }).click();
  await expect(page.getByRole('heading', { name: number })).toBeVisible();
  await expect(page.getByText('Takeaway').first()).toBeVisible();
  await expect(
    page
      .locator('dd')
      .filter({ hasText: /16\.00/ })
      .last(),
  ).toBeVisible();
});

test('a retried submit after a lost response never duplicates the order', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: /Kunafa/ }).click();

  // The first request reaches the server and creates the order, but the response is lost.
  const lost = { orderNumber: '' };
  await page.route('**/api/v1/locations/*/orders', async (route) => {
    if (lost.orderNumber === '' && route.request().method() === 'POST') {
      const response = await route.fetch();
      lost.orderNumber = ((await response.json()) as { orderNumber: string }).orderNumber;
      await route.abort('connectionreset');
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText('Cannot reach the server. Check your connection.')).toBeVisible();
  // The cart (and its order id) is kept, so the retry is the same order.
  await page.getByRole('button', { name: 'Place order' }).click();
  // The retry is answered with the order the lost request created, not a new one.
  expect(lost.orderNumber).toMatch(/^MAIN-\d+$/);
  await expect(page.getByText(`Order ${lost.orderNumber} placed`)).toBeVisible();

  await page.keyboard.press('F4');
  await expect(
    page
      .getByRole('list', { name: 'Open' })
      .getByRole('button', { name: new RegExp(lost.orderNumber) }),
  ).toHaveCount(1);
  // No order was numbered after it.
  const next = Number(/\d+$/.exec(lost.orderNumber)?.[0] ?? 0) + 1;
  await expect(page.getByText(`MAIN-${String(next).padStart(3, '0')}`)).toHaveCount(0);
});

test('cashier edits an open order before the kitchen starts it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: /^Fries/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  const placed = page.getByText(/Order (MAIN-\d+) placed/);
  await expect(placed).toBeVisible();
  const number = /MAIN-\d+/.exec(await placed.innerText())?.[0] ?? '';

  await page.keyboard.press('F4');
  await page.getByRole('button', { name: new RegExp(number) }).click();
  await page.getByRole('button', { name: 'Edit items' }).click();
  await expect(page.getByRole('heading', { name: `Editing ${number}` })).toBeVisible();
  await page.getByRole('button', { name: /Kunafa/ }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(`Order ${number} updated`)).toBeVisible();

  await page.keyboard.press('F4');
  await page.getByRole('button', { name: new RegExp(number) }).click();
  await expect(page.getByText(/2 items/).first()).toBeVisible();
});

test('the POS works in Arabic (RTL) and English (LTR)', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'إرسال الطلب' })).toBeVisible();
  await expect(page.getByRole('button', { name: /برجر كلاسيك/ })).toBeVisible();

  // Mirrored: the order panel sits on the left (inline end) in RTL.
  const cart = await page.getByRole('region', { name: 'الطلب الحالي' }).boundingBox();
  const search = await page.getByRole('searchbox').boundingBox();
  expect(cart && search && cart.x < search.x).toBe(true);

  await page.getByRole('combobox', { name: 'اللغة' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
