import { type Page, expect, test } from '@playwright/test';

/**
 * Organizations (E1): an organization owner signs in once, sees every brand of the organization on
 * its dashboard (the demo seed gives each branch thirty days of sales), switches to one brand and
 * finds only that brand's menu, then reads the dashboard in Arabic.
 */
// The same defaults tools/e2e/prepare-db.mjs seeds the member with when the .env has no values.
const owner = {
  email: process.env.SEED_ORG_OWNER_EMAIL || 'owner@group.local',
  password: process.env.SEED_ORG_OWNER_PASSWORD || 'Dev-Only-Group-Owner-Pass-1',
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.setItem(
        'pos-admin-preferences',
        JSON.stringify({ state: { locale: 'en', locationId: null }, version: 0 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** The amount in a formatted money cell ("₪20,000.00"), as a number. */
function amount(text: string): number {
  return Number(text.replace(/[^\d.]/g, ''));
}

test('an organization owner sees both brands and switches to one', async ({ page }) => {
  await signIn(page);

  // The switcher offers the organization's overview and its brands; the overview shows both
  // brands with sales behind them.
  await page.getByRole('button', { name: /Switch brand or organization/ }).click();
  await page.getByRole('menuitemradio', { name: 'Organization overview' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Foods Group' })).toBeVisible();
  const brands = page.getByRole('region', { name: 'By brand' });
  for (const brand of ['Burger House', 'Pizza Point']) {
    const row = brands.getByRole('row', { name: new RegExp(brand) });
    await expect(row).toBeVisible();
    // Columns: brand, sales, orders, average, share.
    const sales = amount(await row.getByRole('cell').nth(1).innerText());
    expect(sales, `${brand} has sales`).toBeGreaterThan(0);
  }

  // Switching to Pizza Point signs into that brand: its menu, and none of Burger House's.
  await page.getByRole('button', { name: /Switch brand or organization/ }).click();
  await page.getByRole('menuitemradio', { name: 'Pizza Point' }).click();
  await expect(page.getByRole('button', { name: /Switch brand or organization/ })).toContainText(
    'Pizza Point',
  );
  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Margherita/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Classic Burger/ })).toHaveCount(0);

  // The organization dashboard in Arabic: right to left, with the organization's Arabic name.
  await page.getByRole('button', { name: /Switch brand or organization/ }).click();
  await page.getByRole('menuitemradio', { name: 'Organization overview' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Foods Group' })).toBeVisible();
  await page.getByRole('button', { name: /Account/ }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'مجموعة ديمو فودز' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'حسب العلامة التجارية' }).getByRole('row', {
      name: /بيت البرغر/,
    }),
  ).toBeVisible();
});
