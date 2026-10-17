import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/**
 * The Phase 8 admin portal: staff and permission changes (audited), location and online-ordering
 * settings in Arabic, the order list and detail, and an administrator resolving a refused hub
 * change. Runs against the seeded E2E database (see playwright.config.ts).
 */
const owner = {
  email: process.env.SEED_OWNER_EMAIL ?? '',
  password: process.env.SEED_OWNER_PASSWORD ?? '',
};
const API = '/api/v1';

async function signIn(page: Page, email = owner.email, password = owner.password): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** The owner's bearer token and the seeded restaurant and main location, through the API. */
async function ownerContext(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { ...owner, client: 'native' },
  });
  expect(login.ok()).toBe(true);
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { restaurantId: string };
  };
  const headers = { authorization: `Bearer ${accessToken}` };
  const locations = (await (
    await request.get(`${API}/restaurants/${user.restaurantId}/locations`, { headers })
  ).json()) as { id: string; code: string }[];
  const main = locations.find((l) => l.code === 'MAIN');
  if (!main) throw new Error('seeded MAIN location missing');
  return { headers, restaurantId: user.restaurantId, locationId: main.id };
}

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

test('owner creates a role and a user with it; the change is audited and enforced', async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString(36);
  await signIn(page);

  // A role from the permission matrix.
  await page.getByRole('link', { name: 'Roles' }).click();
  await page.getByRole('button', { name: 'New role' }).click();
  const roleDialog = page.getByRole('dialog');
  await roleDialog.getByLabel('Name').fill(`Floor lead ${suffix}`);
  for (const permission of ['View orders', 'View locations', 'View payments']) {
    await roleDialog.getByRole('checkbox', { name: permission, exact: true }).check();
  }
  await roleDialog.getByRole('button', { name: 'Save' }).click();
  await expect(roleDialog).toBeHidden();
  await expect(
    page.getByRole('row', { name: new RegExp(`Floor lead ${suffix}`) }).first(),
  ).toContainText('3 of');

  // A user holding it at the main branch.
  const email = `lead-${suffix}@e2e.local`;
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'New user' }).click();
  const userDialog = page.getByRole('dialog');
  await userDialog.getByLabel('Email').fill(email);
  await userDialog.getByLabel('Name').fill(`Lead ${suffix}`);
  await userDialog.getByLabel('Password').fill('Lead-Password-1');
  await userDialog.getByRole('button', { name: 'Add role' }).click();
  await userDialog.getByLabel('Role').selectOption({ label: `Floor lead ${suffix}` });
  await userDialog.getByLabel('Where').selectOption({ label: 'Main Branch' });
  await userDialog.getByRole('button', { name: 'Create' }).click();
  await expect(userDialog).toBeHidden();
  const row = page.getByRole('row', { name: new RegExp(`Lead ${suffix}`) });
  await expect(row).toContainText(`Floor lead ${suffix} · Main Branch`);

  // The permission change is in the audit log, without the password.
  await page.getByRole('link', { name: 'Audit log' }).click();
  await page.getByLabel('Action', { exact: true }).fill('user.');
  await page.getByRole('button', { name: 'Search' }).click();
  const rolesChanged = page.getByRole('row', { name: /user\.roles_changed/ }).first();
  await expect(rolesChanged).toBeVisible();
  await rolesChanged.getByRole('button', { name: 'Show details' }).click();
  await expect(page.getByText(`Floor lead ${suffix}`).first()).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Lead-Password-1');

  // The new user sees only what the role allows.
  const context = await browser.newContext();
  const second = await context.newPage();
  await second.addInitScript(() => {
    localStorage.setItem(
      'pos-admin-preferences',
      JSON.stringify({ state: { locale: 'en', locationId: null }, version: 0 }),
    );
  });
  await signIn(second, email, 'Lead-Password-1');
  const nav = second.getByRole('navigation');
  await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Payments' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
  await second.goto('/staff/users');
  await expect(second.getByText('No access')).toBeVisible();
  await context.close();
});

test('Arabic: branch settings, online ordering and payment setup in RTL', async ({ page }) => {
  const suffix = Date.now().toString(36);
  await signIn(page);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // Location: kitchen thresholds and cash rounding.
  await page.getByRole('link', { name: 'الفروع' }).click();
  const branch = page.getByRole('row', { name: /MAIN/ });
  await branch.getByRole('button', { name: /تعديل/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('تنبيه المطبخ بعد (دقائق)').fill('20');
  await dialog.getByLabel('تأخر المطبخ بعد (دقائق)').fill('10');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog.getByText('يجب أن يكون أكبر من وقت التنبيه')).toBeVisible();
  await dialog.getByLabel('تأخر المطبخ بعد (دقائق)').fill('30');
  await dialog.getByLabel(/تقريب النقد/).fill('0.05');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toBeHidden();
  await expect(branch).toContainText('20 / 30');

  // Online ordering: pause it.
  await page.getByRole('link', { name: 'الطلب عبر الإنترنت' }).click();
  await page.getByRole('radio', { name: 'متوقف مؤقتًا' }).click();
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ التغييرات.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'متوقف مؤقتًا' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByText('أوقفه المطعم مؤقتًا.')).toBeVisible();

  // Payment method and cash drawer.
  await page.getByRole('link', { name: 'طرق الدفع' }).click();
  await page.getByRole('button', { name: 'طريقة دفع جديدة' }).click();
  const method = page.getByRole('dialog');
  await method.getByLabel('الاسم (بالإنجليزية)').fill(`Visa ${suffix}`);
  await method.getByLabel('الاسم (بالعربية)').fill(`فيزا ${suffix}`);
  await method.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('cell', { name: `فيزا ${suffix}` })).toBeVisible();

  await page.getByRole('link', { name: 'أدراج النقد' }).click();
  await page.getByRole('button', { name: 'درج نقد جديد' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('الاسم (بالإنجليزية)').fill(`Drawer ${suffix}`);
  await drawer.getByLabel('الاسم (بالعربية)').fill(`درج ${suffix}`);
  await drawer.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByRole('cell', { name: `درج ${suffix}` })).toBeVisible();

  // The layout is mirrored.
  const nav = await page.getByRole('navigation').boundingBox();
  const main = await page.getByRole('main').boundingBox();
  expect(nav && main && nav.x > main.x).toBe(true);

  // Put online ordering back for other suites.
  await page.getByRole('link', { name: 'الطلب عبر الإنترنت' }).click();
  await page.getByRole('radio', { name: 'مفتوح' }).click();
  await page.getByRole('button', { name: 'حفظ' }).click();
  await expect(page.getByText('تم حفظ التغييرات.')).toBeVisible();
});

test('orders are searchable, with history and payments in the detail', async ({
  page,
  request,
}) => {
  const { headers, locationId } = await ownerContext(request);
  const menu = (await (
    await request.get(`${API}/locations/${locationId}/menu`, { headers })
  ).json()) as {
    categories: { products: { id: string; nameEn: string; variants: unknown[] }[] }[];
  };
  const product = menu.categories
    .flatMap((c) => c.products)
    .find((p) => p.variants.length === 0 && p.nameEn === 'Fries');
  if (!product) throw new Error('seeded fries missing');
  const phone = `05${String(Date.now()).slice(-8)}`;
  const created = await request.post(`${API}/locations/${locationId}/orders`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      channel: 'PHONE',
      status: 'CONFIRMED',
      customerName: 'Huda E2E',
      customerPhone: phone,
      items: [{ id: crypto.randomUUID(), productId: product.id, quantity: 2 }],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const order = (await created.json()) as { id: string; orderNumber: string };

  await signIn(page);
  await page.getByRole('link', { name: 'Orders' }).click();
  await page.getByRole('searchbox').fill(phone);
  const row = page.getByRole('row', { name: new RegExp(order.orderNumber) });
  await expect(row).toContainText('Huda E2E');
  await expect(row).toContainText('Phone');
  await row.getByRole('link', { name: order.orderNumber }).click();
  await expect(page.getByRole('heading', { name: `Order ${order.orderNumber}` })).toBeVisible();
  await expect(page.getByText('Status history')).toBeVisible();
  await expect(page.getByText('No payments yet')).toBeVisible();
  await expect(page.getByRole('cell', { name: /Fries/ })).toBeVisible();

  // The customer appears, grouped by phone number.
  await page.getByRole('link', { name: 'Customers' }).click();
  await page.getByRole('searchbox').fill(phone);
  await page.getByRole('link', { name: 'Huda E2E' }).click();
  await expect(page.getByRole('link', { name: order.orderNumber })).toBeVisible();
});

test('an administrator resolves a change the cloud refused from the hub', async ({
  page,
  request,
}) => {
  const { headers, locationId } = await ownerContext(request);
  // A hub for the main branch, and an order the cloud already has (taken in the cloud).
  const paired = (await (
    await request.post(`${API}/locations/${locationId}/devices`, {
      headers,
      data: { name: `E2E hub ${Date.now().toString(36)}`, type: 'GATEWAY' },
    })
  ).json()) as { credential: string };
  const hub = { authorization: `Device ${paired.credential}` };
  const menu = (await (
    await request.get(`${API}/locations/${locationId}/menu`, { headers })
  ).json()) as {
    categories: { products: { id: string; nameEn: string; variants: unknown[] }[] }[];
  };
  const product = menu.categories.flatMap((c) => c.products).find((p) => p.nameEn === 'Fries');
  const order = (await (
    await request.post(`${API}/locations/${locationId}/orders`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        channel: 'TAKEAWAY',
        status: 'CONFIRMED',
        notes: 'As taken in the cloud',
        items: [{ id: crypto.randomUUID(), productId: product?.id, quantity: 1 }],
      },
    })
  ).json()) as { id: string; orderNumber: string };

  // The hub pushes its own version of that order: the cloud refuses it (never synchronized
  // from this hub) and keeps it for an administrator.
  const aggregate = (await (
    await request.get(`${API}/sync/orders/${order.id}`, { headers: hub })
  ).json()) as Record<string, unknown>;
  const operationId = crypto.randomUUID();
  const push = await request.post(`${API}/sync/push`, {
    headers: hub,
    data: {
      operations: [
        {
          operationId,
          entityType: 'Order',
          entityId: order.id,
          operationType: 'ORDER_UPSERT',
          entityVersion: 1,
          payload: { ...aggregate, notes: 'Changed at the till', version: 2 },
        },
      ],
    },
  });
  expect(((await push.json()) as { results: { status: string }[] }).results[0]?.status).toBe(
    'CONFLICT',
  );

  // The administrator compares both versions and applies the restaurant's, in Arabic.
  await signIn(page);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await page.getByRole('link', { name: 'المزامنة' }).click();
  const issue = page.getByRole('row', { name: new RegExp(order.orderNumber) });
  await expect(issue).toContainText('تعارض');
  await issue.getByRole('link').click();
  await expect(page.getByText('نسخة الفرع')).toBeVisible();
  await page.getByRole('radio', { name: /اعتماد نسخة الفرع/ }).click();
  await page.getByLabel('ملاحظة للسجل').fill('أكد الفرع أن هذه هي الحالة الصحيحة');
  await page.getByRole('button', { name: 'تأكيد القرار' }).click();
  await expect(page.getByText('تم تسجيل القرار. يتبعه الخادم خلال دقيقة.')).toBeVisible();
  await expect(page.getByText('طُبّقت نسخة الفرع').first()).toBeVisible();

  // The cloud now has the hub's version, and the hub is told to resend (a duplicate).
  const after = (await (
    await request.get(`${API}/locations/${locationId}/orders/${order.id}`, { headers })
  ).json()) as { notes: string };
  expect(after.notes).toBe('Changed at the till');
  const decision = (await (
    await request.get(`${API}/sync/resolutions/${operationId}`, { headers: hub })
  ).json()) as { action: string };
  expect(decision.action).toBe('RESEND');
});
