import { type Page, expect, test } from '@playwright/test';

const email = process.env.SEED_OWNER_EMAIL ?? '';
const password = process.env.SEED_OWNER_PASSWORD ?? '';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Start every test in English, whatever the browser locale.
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

test('owner creates a category and a product, and the session survives a reload', async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  await signIn(page);

  await page.getByRole('link', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'New category' }).click();
  const categoryDialog = page.getByRole('dialog');
  await categoryDialog.getByLabel('Name (English)').fill(`Grills ${suffix}`);
  await categoryDialog.getByLabel('Name (Arabic)').fill(`مشويات ${suffix}`);
  await categoryDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: `Grills ${suffix}` })).toBeVisible();

  await page.getByRole('link', { name: 'Products' }).click();
  await page.getByRole('button', { name: 'New product' }).click();
  const productDialog = page.getByRole('dialog');
  await productDialog.getByLabel('Category').selectOption({ label: `Grills ${suffix}` });
  await productDialog.getByLabel('Name (English)').fill(`Mixed Grill ${suffix}`);
  await productDialog.getByLabel('Name (Arabic)').fill(`مشاوي مشكلة ${suffix}`);
  await productDialog.getByLabel(/^Price/).fill('45.5');
  await productDialog.getByLabel('Grill').check();
  await productDialog.getByRole('button', { name: 'Save' }).click();
  await expect(productDialog).toBeHidden();

  const row = page.getByRole('row', { name: new RegExp(`Mixed Grill ${suffix}`) });
  await expect(row).toContainText('45.50');
  await expect(row).toContainText('Grill');

  // A full reload restores the session from the httpOnly refresh cookie.
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(`Mixed Grill ${suffix}`) })).toBeVisible();
});

test('Arabic switches the whole UI to RTL and back to LTR', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.getByRole('button', { name: /Account/ }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'المنتجات' })).toBeVisible();

  // Mirrored layout: navigation sits on the right of the main content.
  const nav = await page.getByRole('navigation').boundingBox();
  const main = await page.getByRole('main').boundingBox();
  expect(nav && main && nav.x > main.x).toBe(true);

  // Arabic menu data is shown in Arabic.
  await expect(page.getByRole('cell', { name: 'برجر كلاسيك' })).toBeVisible();

  // The choice persists across reloads.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByRole('combobox', { name: 'اللغة' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const navLtr = await page.getByRole('navigation').boundingBox();
  const mainLtr = await page.getByRole('main').boundingBox();
  expect(navLtr && mainLtr && navLtr.x < mainLtr.x).toBe(true);
});

test('a role without catalog permissions does not see menu management', async ({ page }) => {
  // The seeded cashier has products.view only at their location: they can browse, not edit.
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.SEED_CASHIER_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.SEED_CASHIER_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('cell', { name: 'Classic Burger' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New product' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});
