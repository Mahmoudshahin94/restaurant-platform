import { type Page, expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'pos-terminal-preferences',
        JSON.stringify({ state: { locale: 'en', locationId: null }, version: 1 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

/** The cashier signs in at the till with employee code and PIN, served by the hub. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Employee code').fill('1001');
  await page.getByLabel('PIN', { exact: true }).fill(process.env.SEED_CASHIER_PIN ?? '');
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

test('the top bar fits a 1024px screen in English and Arabic', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await signIn(page);
  for (const [locale, signOut] of [
    ['en', 'Sign out'],
    ['ar', 'تسجيل الخروج'],
  ] as const) {
    await page.locator('header select').selectOption(locale);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    const button = await page.getByRole('button', { name: signOut }).boundingBox();
    expect(button && button.x >= 0 && button.x + button.width <= 1024).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  }
});

test('staff can still sign in with email and password at the hub', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Email' }).click();
  await page.getByLabel('Email').fill(process.env.SEED_CASHIER_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.SEED_CASHIER_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeVisible();
});

test('a wrong PIN is refused without revealing whether the code exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Employee code').fill('1001');
  await page.getByLabel('PIN', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect employee code or PIN.')).toBeVisible();
  await expect(page.getByLabel('PIN', { exact: true })).toHaveValue('');
});

test('the POS shows that it runs on the hub without the cloud', async ({ page }) => {
  await signIn(page);
  // The cloud is stopped: the indicator says so and counts what waits to be sent.
  await expect(
    page.getByRole('status').filter({ hasText: /^Offline · \d+ pending$/ }),
  ).toBeVisible();
});

test('a barcode scan adds the item to the cart, offline at the hub', async ({ page }) => {
  await signIn(page);
  /** A scanner in keyboard mode: the code typed at machine speed, then Enter. */
  const scan = async (code: string) => {
    await page.keyboard.type(code, { delay: 0 });
    await page.keyboard.press('Enter');
  };
  const cart = page.getByRole('region', { name: 'Current order' });

  // The demo restaurant sells its colas by barcode (seed: BARCODE on, a code per size).
  await scan('6291000001010');
  await expect(page.getByTestId('scan-toast')).toHaveText('Added Cola · Regular');
  await scan('6291000001010');
  // Scanned again: the same line, two of them.
  await expect(cart.getByText('Cola · Regular')).toHaveCount(1);
  await expect(page.getByTestId('cart-total')).toHaveText(/12\.00/);

  await scan('4006381333931');
  await expect(page.getByTestId('scan-toast')).toHaveText('No item has the code 4006381333931');

  // A label that will not scan: typed by hand, here by its SKU.
  await page.getByRole('button', { name: 'Enter barcode' }).click();
  await page.getByLabel('Barcode or SKU').fill('DR-COLA-L');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scan-toast')).toHaveText('Added Cola · Large');
  await expect(cart.getByText('Cola · Large')).toBeVisible();

  // Seed prices: two regular colas at 6.00 and a large at 8.00.
  await expect(page.getByTestId('cart-total')).toHaveText(/20\.00/);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText(/Order MAIN-\d+ placed/)).toBeVisible();
});
