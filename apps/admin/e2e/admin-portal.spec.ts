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

/** The owner's bearer token and the seeded tenant and main location, through the API. */
async function ownerContext(request: APIRequestContext) {
  const login = await request.post(`${API}/auth/login`, {
    data: { ...owner, client: 'native' },
  });
  expect(login.ok()).toBe(true);
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  const headers = { authorization: `Bearer ${accessToken}` };
  const locations = (await (
    await request.get(`${API}/tenants/${user.tenantId}/locations`, { headers })
  ).json()) as { id: string; code: string }[];
  const main = locations.find((l) => l.code === 'MAIN');
  if (!main) throw new Error('seeded MAIN location missing');
  return { headers, tenantId: user.tenantId, locationId: main.id };
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
  await page.getByRole('button', { name: /Account/ }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
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
  await expect(page.getByText('أوقفته المنشأة مؤقتًا.')).toBeVisible();

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

  // The administrator compares both versions and applies the hub's, in Arabic.
  await signIn(page);
  await page.getByRole('button', { name: /Account/ }).click();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await page.getByRole('link', { name: 'المزامنة', exact: true }).click();
  const issue = page.getByRole('row', { name: new RegExp(order.orderNumber) });
  await expect(issue).toContainText('تعارض');
  await issue.getByRole('link').click();
  await expect(page.getByRole('columnheader', { name: 'نسخة الفرع' })).toBeVisible();
  await expect(page.getByRole('row', { name: /الإصدار/ })).toContainText('مختلف');
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

test('the owner switches a module off for one location and its pages follow', async ({
  page,
  request,
}) => {
  const { headers, tenantId, locationId } = await ownerContext(request);
  await signIn(page);
  await expect(page.getByRole('link', { name: 'Tables' })).toBeVisible();

  await page.getByRole('link', { name: 'Modules' }).click();
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible();
  await page.getByLabel('Applies to').selectOption(locationId);
  const tables = page.getByRole('region', { name: 'Tables' });
  await expect(tables.getByText('From: Business type default')).toBeVisible();
  await tables.getByRole('radio', { name: 'Off' }).click();
  await expect(tables.getByText('From: Location setting')).toBeVisible();

  // The header's location (the main one) no longer offers its floor plan.
  await expect(page.getByRole('link', { name: 'Tables' })).toBeHidden();
  await page.goto('/settings/tables');
  await expect(page.getByText('This module is off')).toBeVisible();
  const floor = await request.get(`${API}/locations/${locationId}/floor`, { headers });
  expect(floor.status()).toBe(403);
  expect(((await floor.json()) as { code: string }).code).toBe('FEATURE_DISABLED');

  // Back to what the business type gives.
  await page.getByRole('link', { name: 'Open modules' }).click();
  await page.getByLabel('Applies to').selectOption(locationId);
  await tables.getByRole('radio', { name: /Inherit/ }).click();
  await expect(tables.getByText('From: Business type default')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tables' })).toBeVisible();
  const reset = await request.get(`${API}/tenants/${tenantId}/context?locationId=${locationId}`, {
    headers,
  });
  expect(
    ((await reset.json()) as { features: { TABLES: { enabled: boolean } } }).features.TABLES,
  ).toMatchObject({ enabled: true });
});

/** A real 1×1 PNG: the logo the owner uploads. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQTX4NAAIkAXSaGkHUAAAAAElFTkSuQmCC',
  'base64',
);

test('the owner brands the business and its screens follow', async ({ page, request }) => {
  const { headers, tenantId } = await ownerContext(request);
  const reset = () =>
    request.put(`${API}/tenants/${tenantId}/branding`, {
      headers,
      data: {
        displayNameEn: null,
        displayNameAr: null,
        logoFileId: null,
        faviconFileId: null,
        primaryColor: null,
        secondaryColor: null,
        accentColor: null,
        fontFamily: null,
        logoSize: null,
        themeMode: null,
        surfaceStyle: null,
        borderRadius: null,
        surfaces: {},
      },
    });
  expect((await reset()).ok()).toBe(true);
  await signIn(page);
  // MADAR's look until the business has its own: dark, and the platform in the footer.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByText('MADAR Admin · Powered by JudyTech')).toBeVisible();

  await page.getByRole('link', { name: 'Branding' }).click();
  await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();
  await page
    .locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]')
    .first()
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Replace' }).first()).toBeVisible();

  // An unreadable accent is refused before it can be saved.
  await page.getByLabel('Accent colour (hex)').fill('#fde047');
  await expect(page.getByText(/Too light for light screens/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save branding' })).toBeDisabled();
  await page.getByLabel('Accent colour (hex)').fill('');

  await page.getByLabel('Primary colour (hex)').fill('#2563eb');
  await page.getByLabel('Light or dark', { exact: true }).selectOption('LIGHT');
  await page.getByRole('tab', { name: 'Kitchen display' }).click();
  await page.getByLabel('Light or dark · Kitchen display').selectOption('DARK');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText(/Branding saved/)).toBeVisible();

  // The admin itself follows at once: light, the brand colour, the logo.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('style', /--color-primary: #2563eb/);
  await expect(page.locator('aside img').first()).toBeVisible();

  // Every screen reads its own resolution: the kitchen stays dark.
  const context = async (surface: string) =>
    (
      (await (
        await request.get(`${API}/tenants/${tenantId}/context?surface=${surface}`, { headers })
      ).json()) as { branding: { themeMode: string; primaryColor: string; logoFileId: string } }
    ).branding;
  expect(await context('pos')).toMatchObject({ themeMode: 'LIGHT', primaryColor: '#2563eb' });
  expect((await context('kds')).themeMode).toBe('DARK');
  expect((await context('pos')).logoFileId).toBeTruthy();

  expect((await reset()).ok()).toBe(true);
});

test('the owner offers one language and writes the currency their way', async ({
  page,
  request,
}) => {
  const { headers, tenantId } = await ownerContext(request);
  const defaults = {
    defaultLocale: 'en',
    supportedLocales: ['en', 'ar'],
    digits: null,
    currencySymbol: null,
    currencyDisplay: null,
    currencyFormatLocale: null,
  };
  const reset = () =>
    request.put(`${API}/tenants/${tenantId}/localization`, { headers, data: defaults });
  expect((await reset()).ok()).toBe(true);
  // Later tests need both languages back, whatever happens here.
  try {
    await offerArabicOnly(page);
  } finally {
    expect((await reset()).ok()).toBe(true);
  }
  // Context and currency through the API, and both languages again.
  const context = (await (
    await request.get(`${API}/tenants/${tenantId}/context`, { headers })
  ).json()) as { currency: { code: string; symbol: string }; locales: { supported: string[] } };
  expect(context.currency).toMatchObject({ code: 'ILS', symbol: '₪' });
  expect(context.locales.supported).toEqual(['en', 'ar']);
  const refused = await request.put(`${API}/tenants/${tenantId}/localization`, {
    headers,
    data: { ...defaults, currencyCode: 'USD' },
  });
  expect(refused.status()).toBe(400);
  await page.reload();
  await expect(page.getByRole('combobox', { name: /^(Language|اللغة)$/ })).toBeVisible();
});

/** Scenario 22 in the admin: Arabic only, in Arabic-Indic digits; the screens follow at once. */
async function offerArabicOnly(page: Page): Promise<void> {
  await signIn(page);
  // The demo restaurant is in shekels: ₪ by default, two decimals, both languages offered.
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Language and currency' }).click();
  await expect(page.getByRole('heading', { name: 'Language and currency' })).toBeVisible();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('ILS');
  await expect(page.getByLabel('Decimal places')).toHaveValue('2');
  await expect(page.getByTestId('preview-en')).toHaveText('₪1,234.56');

  // Arabic only, in Arabic-Indic digits.
  await page.getByRole('checkbox', { name: 'English' }).click();
  await page.getByLabel('Digits in Arabic').selectOption('arab');
  await page.getByRole('button', { name: 'Save' }).click();

  // The admin follows at once: Arabic, right to left, no switcher, ₪ in Arabic digits.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'اللغة والعملة' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'اللغة', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('preview-ar')).toContainText('١٬٢٣٤٫٥٦');
  await expect(page.getByTestId('preview-ar')).toContainText('₪');
  // Amounts elsewhere follow too: the dashboard's sales in Arabic-Indic digits and ₪.
  await page.getByRole('link', { name: 'لوحة التحكم' }).click();
  await expect(page.getByText(/^\u200f?[٠-٩٬]+٫[٠-٩]{2}\s₪$/).first()).toBeVisible();
}

/** A valid EAN-13 that no earlier run used: the E2E database keeps its products. */
function freshEan13(): string {
  const body = `29${Date.now().toString().slice(-10)}`;
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return `${body}${String((10 - (sum % 10)) % 10)}`;
}

test('the owner builds a size and colour matrix with SKUs and barcodes', async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const code = freshEan13();
  await signIn(page);
  await page.goto('/menu/products');
  await page.getByRole('button', { name: 'New product' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill(`Tee ${suffix}`);
  await dialog.getByLabel('Name (Arabic)').fill(`قميص ${suffix}`);
  await dialog.getByLabel('Price (ILS)', { exact: true }).fill('60.00');

  // Size: S, M.
  await dialog.getByRole('button', { name: 'Add option' }).click();
  await dialog.getByLabel('Option 1 (English)').fill('Size');
  await dialog.getByLabel('Option 1 (Arabic)').fill('المقاس');
  await dialog.getByLabel('Size value 1 (English)').fill('S');
  await dialog.getByLabel('Size value 1 (Arabic)').fill('صغير');
  await dialog.getByRole('button', { name: 'Add value' }).click();
  await dialog.getByLabel('Size value 2 (English)').fill('M');
  await dialog.getByLabel('Size value 2 (Arabic)').fill('وسط');
  // Colour: Red, Blue. The matrix now has four rows.
  await dialog.getByRole('button', { name: 'Add option' }).click();
  await dialog.getByLabel('Option 2 (English)').fill('Colour');
  await dialog.getByLabel('Option 2 (Arabic)').fill('اللون');
  await dialog.getByLabel('Colour value 1 (English)').fill('Red');
  await dialog.getByLabel('Colour value 1 (Arabic)').fill('أحمر');
  await dialog.getByRole('button', { name: 'Add value' }).nth(1).click();
  await dialog.getByLabel('Colour value 2 (English)').fill('Blue');
  await dialog.getByLabel('Colour value 2 (Arabic)').fill('أزرق');
  await expect(dialog.getByRole('checkbox', { name: /^Sell / })).toHaveCount(4);

  // M / Blue is not made; S / Red gets its SKU, barcode and a higher price.
  await dialog.getByRole('checkbox', { name: 'Sell M / Blue' }).click();
  await dialog.getByLabel('SKU of S / Red').fill(`TEE-${suffix}-S-R`);
  await dialog.getByLabel('Price of S / Red').fill('65.00');
  await dialog.getByLabel('Barcode of S / Red').fill('1234567890123');
  await dialog.getByRole('button', { name: 'Save' }).click();
  // A mistyped EAN is caught before it is saved.
  await expect(dialog.getByText('The last digit does not match: check the code.')).toBeVisible();
  await dialog.getByLabel('Barcode of S / Red').fill(code);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole('row', { name: new RegExp(`Tee ${suffix}`) });
  await expect(row.getByText('3 variants')).toBeVisible();

  // The location's menu sells S / Red by its code.
  const { headers, locationId } = await ownerContext(request);
  const lookup = await request.get(`${API}/locations/${locationId}/catalog/lookup`, {
    headers,
    params: { code },
  });
  expect(lookup.ok()).toBe(true);
  const found = (await lookup.json()) as {
    product: { variants: { id: string; nameEn: string; price: number; sku: string | null }[] };
    variantId: string;
  };
  expect(found.product.variants.map((v) => v.nameEn)).toEqual(['S / Red', 'S / Blue', 'M / Red']);
  expect(found.product.variants.find((v) => v.id === found.variantId)).toMatchObject({
    nameEn: 'S / Red',
    price: 6500,
    sku: `TEE-${suffix}-S-R`,
  });
});
