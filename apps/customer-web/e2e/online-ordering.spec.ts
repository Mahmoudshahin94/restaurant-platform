import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  expect,
  test,
} from '@playwright/test';

/**
 * The specification's acceptance steps 14–17: a customer creates an online order → the cloud
 * order reaches the store → the store accepts it → the customer sees the updated status.
 * The website talks to the cloud; the POS talks to the location's hub; the hub follows the
 * cloud's change feed and hands accepted orders back with its push.
 */
const CLOUD = `http://localhost:${process.env.WEB_E2E_CLOUD_PORT ?? '3130'}`;
const HUB = `http://localhost:${process.env.WEB_E2E_HUB_PORT ?? '4130'}`;
const POS = process.env.WEB_E2E_POS_URL ?? 'http://localhost:1440';

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** The customer's browser, in a language, with an empty cart. */
async function customer(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page.addInitScript((lng) => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'web-preferences',
        JSON.stringify({ state: { locale: lng }, version: 1 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  }, locale);
}

/** A till at the store: the POS served by the hub, in its own browser and language. */
async function till(browser: Browser, locale: 'en' | 'ar' = 'en'): Promise<Page> {
  const context = await browser.newContext({
    baseURL: POS,
    viewport: { width: 1366, height: 900 },
  });
  contexts.push(context);
  await context.addInitScript((lng) => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'pos-terminal-preferences',
        JSON.stringify({ state: { locale: lng, locationId: null }, version: 1 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  }, locale);
  return context.newPage();
}

async function cashierSignsIn(pos: Page): Promise<void> {
  await pos.goto('/login');
  await pos.getByLabel('Employee code').fill('1001');
  await pos.getByLabel('PIN', { exact: true }).fill(process.env.SEED_CASHIER_PIN ?? '');
  await pos.getByRole('button', { name: 'Sign in' }).click();
  // Order entry opens (a waiting website order may already cover it with its dialog).
  await expect(pos).toHaveURL(/\/order$/);
}

/** Rejecting needs `orders.cancel`: the owner signs in with email and password (in Arabic). */
async function managerSignsInArabic(pos: Page): Promise<void> {
  await pos.goto('/login');
  await pos.getByRole('tab', { name: 'البريد الإلكتروني' }).click();
  await pos.getByLabel('البريد الإلكتروني').fill(process.env.SEED_OWNER_EMAIL ?? '');
  await pos.getByLabel('كلمة المرور').fill(process.env.SEED_OWNER_PASSWORD ?? '');
  await pos.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await expect(pos).toHaveURL(/\/order$/);
}

async function ownerToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${CLOUD}/api/v1/auth/login`, {
    data: {
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
      client: 'native',
    },
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function setOrdering(request: APIRequestContext, state: 'OPEN' | 'PAUSED'): Promise<void> {
  const { locationId } = (await (await request.get(`${HUB}/api/v1/hub/status`)).json()) as {
    locationId: string;
  };
  const res = await request.put(`${CLOUD}/api/v1/locations/${locationId}/online-ordering`, {
    headers: { authorization: `Bearer ${await ownerToken(request)}` },
    data: { state },
  });
  expect(res.ok()).toBe(true);
}

/** Kitchen tickets of an order at the hub (what the KDS shows), seen by the owner. */
async function hubTickets(request: APIRequestContext, orderNumber: string): Promise<number> {
  const { locationId } = (await (await request.get(`${HUB}/api/v1/hub/status`)).json()) as {
    locationId: string;
  };
  const login = await request.post(`${HUB}/api/v1/auth/login`, {
    data: {
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
      client: 'native',
    },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await request.get(`${HUB}/api/v1/locations/${locationId}/kitchen/tickets`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.ok()).toBe(true);
  const tickets = (await res.json()) as { orderNumber: string }[];
  return tickets.filter((t) => t.orderNumber === orderNumber).length;
}

test('a website order reaches the store, is accepted, and the customer sees it', async ({
  page,
  browser,
  request,
}) => {
  await customer(page, 'en');
  // 14. The customer orders on the website.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Order from Demo Kitchen' })).toBeVisible();
  await expect(page.getByText('Open for orders')).toBeVisible();
  await page.getByRole('link', { name: 'View menu · Main Branch' }).click();
  await page.getByRole('button', { name: 'Add Classic Burger' }).click();
  const options = page.getByRole('dialog');
  await expect(options.getByRole('radio', { name: 'Medium' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await options.getByRole('checkbox', { name: /Extra cheese/ }).click();
  await options.getByRole('button', { name: /Add to cart/ }).click();
  await page.getByRole('button', { name: 'Add Fries' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to cart/ })
    .click();
  await page.getByRole('link', { name: /View cart/ }).click();
  // Seed prices: burger 28.00 + cheese 3.00 + fries 9.00 (VAT included).
  await expect(page.getByTestId('total')).toHaveText(/40\.00/);
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sara E2E');
  await page.getByLabel('Mobile number').fill('+966500000123');
  await page.getByLabel('Order notes (optional)').fill('Ring the bell');
  await page.getByRole('button', { name: /Place order · SAR\s?40\.00/ }).click();

  await expect(page.getByRole('heading', { name: 'Thank you, Sara E2E!' })).toBeVisible();
  const sent = await page.getByText(/Order W-\d+ was sent to Main Branch/).innerText();
  const number = /W-\d+/.exec(sent)?.[0] ?? '';
  expect(number).not.toBe('');
  await page.getByRole('link', { name: 'Follow your order' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('Waiting for the store');

  // 15. The cloud order reaches the tenant: the till announces it.
  const pos = await till(browser);
  await cashierSignsIn(pos);
  const incoming = pos.getByRole('dialog');
  await expect(incoming.getByRole('heading', { name: `Online order ${number}` })).toBeVisible({
    timeout: 30_000,
  });
  await expect(incoming.getByText('Pays at pickup')).toBeVisible();
  await expect(incoming.getByText('Ring the bell')).toBeVisible();
  await expect(incoming.getByTestId('accept-countdown')).toHaveText(/Accept within \d\d:\d\d/);

  // 16. The tenant accepts it: it goes to the kitchen.
  await incoming.getByRole('button', { name: 'Accept' }).click();
  await expect(pos.getByText(`Order ${number} accepted and sent to the kitchen.`)).toBeVisible();
  await expect(incoming).toBeHidden();
  await expect.poll(() => hubTickets(request, number)).toBeGreaterThan(0);

  // 17. The customer sees the new status (the page refreshes itself).
  await expect(page.getByTestId('order-status')).toHaveText('Accepted', { timeout: 30_000 });
  await expect(page.getByText('The tenant accepted your order.')).toBeVisible();
});

test('in Arabic, right to left: a paid delivery order is rejected and the payment voided', async ({
  page,
  browser,
}) => {
  await customer(page, 'ar');
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'اطلب من مطبخ تجريبي' })).toBeVisible();
  await page.getByRole('link', { name: 'عرض القائمة · الفرع الرئيسي' }).click();
  await page.getByRole('button', { name: 'أضف بطاطس' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /أضف إلى السلة/ })
    .click();
  await page.getByRole('link', { name: /عرض السلة/ }).click();
  await page.getByRole('link', { name: 'إتمام الطلب' }).click();

  await page.getByLabel('الاسم', { exact: true }).fill('ليلى');
  await page.getByLabel('رقم الجوال').fill('+966500000124');
  await page.getByText('توصيل', { exact: true }).click();
  await page.getByLabel('الشارع والمبنى').fill('شارع العليا 12');
  // Delivery fee 10.00 (seed) is added to the 9.00 fries.
  await expect(page.getByTestId('total-fees')).toContainText('10.00');
  await expect(page.getByTestId('total')).toContainText('19.00');
  await page.getByText('الدفع بالبطاقة عبر الإنترنت').click();
  await page.getByRole('button', { name: /تقديم الطلب/ }).click();

  await expect(page.getByRole('heading', { name: 'شكرًا لك يا ليلى!' })).toBeVisible();
  const sent = await page.getByText(/أُرسل الطلب W-\d+/).innerText();
  const number = /W-\d+/.exec(sent)?.[0] ?? '';
  await page.getByRole('link', { name: 'تابع طلبك' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('بانتظار المتجر');
  await expect(page.getByText('مدفوع عبر الإنترنت')).toBeVisible();

  // The manager, working in Arabic, rejects it because the kitchen is too busy.
  const pos = await till(browser, 'ar');
  await managerSignsInArabic(pos);
  const incoming = pos.getByRole('dialog');
  await expect(incoming.getByRole('heading', { name: `طلب عبر الإنترنت ${number}` })).toBeVisible({
    timeout: 30_000,
  });
  await expect(pos.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(incoming.getByText('مدفوع عبر الإنترنت')).toBeVisible();
  await expect(incoming.getByText(/التوصيل إلى شارع العليا 12/)).toBeVisible();
  await incoming.getByRole('button', { name: 'رفض' }).click();
  await incoming.getByRole('radio', { name: 'مشغولون جدًا الآن' }).check();
  await incoming.getByRole('button', { name: 'رفض الطلب' }).click();
  await expect(pos.getByText(`رُفض الطلب ${number}.`)).toBeVisible();

  // The customer sees the cancellation, the reason and that the card was not charged.
  await expect(page.getByTestId('order-status')).toHaveText('ملغى', { timeout: 30_000 });
  await expect(page.getByText('المتجر مشغول جدًا ولا يستطيع استقبال طلبك الآن.')).toBeVisible();
  await expect(
    page.getByText('أُلغيت عملية الدفع عبر الإنترنت: لن يُخصم منك أي مبلغ.'),
  ).toBeVisible({
    timeout: 30_000,
  });
});

test('a paused branch shows why and takes no order', async ({ page, request }) => {
  await customer(page, 'en');
  await setOrdering(request, 'PAUSED');
  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'View menu · Main Branch' }).click();
    await expect(page.getByText('Paused').first()).toBeVisible();
    await expect(page.getByText(/The tenant paused online orders for a moment/)).toBeVisible();
    // Browsing and filling the cart still work; placing the order does not.
    await page.getByRole('button', { name: 'Add Fries' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Add to cart/ })
      .click();
    await page.getByRole('link', { name: /View cart/ }).click();
    await page.getByRole('link', { name: 'Checkout' }).click();
    await expect(page.getByRole('button', { name: /Place order/ })).toBeDisabled();
    await expect(
      page.getByText('Orders cannot be placed right now.', { exact: true }),
    ).toBeVisible();
  } finally {
    await setOrdering(request, 'OPEN');
  }
});
