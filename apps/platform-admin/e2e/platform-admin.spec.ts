import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/**
 * The platform admin (ADR 0025): an operator provisions a business, suspends it (its owner is
 * then refused) and reactivates it, then corrects an order's status in Arabic through the support
 * tools' preview → confirm → reason flow, which the business's own audit log records.
 */
const operator = {
  email: process.env.PLATFORM_E2E_OPERATOR_EMAIL ?? '',
  password: process.env.PLATFORM_USER_PASSWORD ?? '',
};
const API = '/api/v1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.setItem(
        'madar-platform-preferences',
        JSON.stringify({ state: { locale: 'en' }, version: 0 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(operator.email);
  await page.getByLabel('Password').fill(operator.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
}

/** The tenant owner's sign-in, through the tenant API. */
function ownerLogin(request: APIRequestContext, email: string, password: string) {
  return request.post(`${API}/auth/login`, { data: { email, password, client: 'native' } });
}

/** A placed, unpaid takeaway order of the new business, made by its owner through its API. */
async function placeOrder(request: APIRequestContext, email: string, password: string) {
  const login = await ownerLogin(request, email, password);
  expect(login.ok()).toBe(true);
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  const headers = { authorization: `Bearer ${accessToken}` };
  const tid = user.tenantId;
  const [location] = (await (
    await request.get(`${API}/tenants/${tid}/locations`, { headers })
  ).json()) as { id: string }[];
  const category = (await (
    await request.post(`${API}/tenants/${tid}/categories`, {
      headers,
      data: { nameEn: 'Coffee', nameAr: 'قهوة' },
    })
  ).json()) as { id: string };
  const productRes = await request.post(`${API}/tenants/${tid}/products`, {
    headers,
    data: { categoryId: category.id, nameEn: 'Espresso', nameAr: 'إسبريسو', price: 900 },
  });
  expect(productRes.ok()).toBe(true);
  const product = (await productRes.json()) as { id: string };
  const orderRes = await request.post(`${API}/locations/${location!.id}/orders`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      channel: 'TAKEAWAY',
      items: [{ id: crypto.randomUUID(), productId: product.id, modifierIds: [], quantity: 1 }],
    },
  });
  expect(orderRes.status()).toBe(201);
  return (await orderRes.json()) as { id: string; orderNumber: string; status: string };
}

test('an operator provisions, suspends and reactivates a tenant, then repairs an order in Arabic', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const ownerEmail = `owner-${suffix}@e2e.test`;
  await signIn(page);

  // Provision a coffee shop with its owner; the temporary password is shown once.
  await page.getByRole('button', { name: 'Provision tenant' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Web address name').fill(`cafe-${suffix}`);
  await dialog.getByLabel('Business type').selectOption('COFFEE_SHOP');
  await dialog.getByLabel('Name (English)').first().fill(`Cafe ${suffix}`);
  await dialog.getByLabel('Name (Arabic)').first().fill(`مقهى ${suffix}`);
  await dialog.getByLabel('Owner email').fill(ownerEmail);
  await dialog.getByLabel('Owner name').fill('Cafe Owner');
  await dialog.getByRole('button', { name: 'Provision', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Tenant provisioned' })).toBeVisible();
  const password = await dialog.getByTestId('temporary-password').inputValue();
  expect(password.length).toBeGreaterThanOrEqual(12);
  await dialog.getByRole('link', { name: 'Open tenant' }).click();
  await expect(page.getByRole('heading', { name: `Cafe ${suffix}` })).toBeVisible();
  expect((await ownerLogin(request, ownerEmail, password)).ok()).toBe(true);

  // Suspend: the owner is refused at sign-in.
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('dialog').getByLabel('New status').selectOption('SUSPENDED');
  await page.getByRole('dialog').getByLabel('Reason').fill('Unpaid invoice, E2E check');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('status-banner')).toBeVisible();
  const refused = await ownerLogin(request, ownerEmail, password);
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { code: string }).code).toBe('TENANT_SUSPENDED');

  // Reactivate: the owner signs in again.
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('dialog').getByLabel('New status').selectOption('ACTIVE');
  await page.getByRole('dialog').getByLabel('Reason').fill('Invoice paid, E2E check');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('status-banner')).toBeHidden();
  const tenantUrl = page.url();

  const order = await placeOrder(request, ownerEmail, password);
  expect(order.status).toBe('PLACED');

  // In Arabic: correct the order's status (PLACED → CANCELLED, a SYSTEM rule) with a reason.
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('link', { name: 'أدوات الدعم' }).click();
  await page.getByLabel('ابحث عن منشأة').fill(`cafe-${suffix}`);
  await page.getByRole('button', { name: new RegExp(`مقهى ${suffix}`) }).click();
  await page.getByLabel('الإصلاح', { exact: true }).selectOption('order.correct_status');
  await page.getByLabel('معرّف الطلب').fill(order.id);
  await page.getByLabel('الحالة الجديدة').selectOption('CANCELLED');
  await page.getByRole('button', { name: 'معاينة', exact: true }).click();
  const preview = page.getByTestId('support-preview');
  await expect(preview.getByTestId('support-changes')).toContainText('CANCELLED');
  await page.getByRole('button', { name: 'متابعة' }).click();
  const apply = page.getByRole('button', { name: 'تطبيق الإصلاح' });
  await expect(apply).toBeDisabled();
  await page.getByLabel('السبب').fill('طلب عالق أبلغ عنه المالك');
  await apply.click();
  await expect(page.getByTestId('support-result')).toBeVisible();

  // The business's own audit log records the repair with before and after.
  await page.goto(`${tenantUrl.replace(/\/(overview)?$/, '')}/audit`);
  const entry = page.getByTestId('tenant-audit-entry').filter({ hasText: 'support.' }).first();
  await expect(entry).toBeVisible();
  await entry.getByRole('button').click();
  await expect(page.getByText('"CANCELLED"').first()).toBeVisible();
});
