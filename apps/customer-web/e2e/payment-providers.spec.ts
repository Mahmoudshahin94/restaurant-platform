import { type APIRequestContext, type Page, expect, request, test } from '@playwright/test';

/**
 * MADAR Phase M8 (ADR 0024): payment providers per business. The coffee shop starts cash only (no
 * ONLINE provider account): its website offers no card and a card checkout is refused. Its owner
 * then adds the test card gateway in the admin, with a secret key that is never shown again, and
 * a card order on its website goes through.
 *
 * The suite's cloud runs without development payment defaults, so only the demo restaurant (whose
 * seed gives it a test gateway) takes cards until the coffee shop configures its own.
 */
const CLOUD = `http://localhost:${process.env.WEB_E2E_CLOUD_PORT ?? '3130'}`;
const PORT = process.env.WEB_E2E_WEB_PORT ?? '5195';
const ADMIN = process.env.WEB_E2E_ADMIN_URL ?? 'http://localhost:5197';
const CAFE_SITE = `http://ramallah-roasters.madar.localhost:${PORT}`;
const SECRET = 'sk_test_CafeE2ESecretKey42';
const owner = {
  email: process.env.SEED_CAFE_OWNER_EMAIL ?? '',
  password: process.env.SEED_CAFE_OWNER_PASSWORD ?? '',
};

let api: APIRequestContext;
let cafe: { token: string; tenantId: string; locationId: string };

async function call(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  return api.fetch(`${CLOUD}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${cafe.token}` },
    ...(data === undefined ? {} : { data }),
  });
}

test.beforeAll(async () => {
  api = await request.newContext();
  const login = await api.post(`${CLOUD}/api/v1/auth/login`, {
    data: { ...owner, client: 'native' },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  cafe = { token: accessToken, tenantId: user.tenantId, locationId: '' };
  const locations = (await (await call('GET', `/tenants/${user.tenantId}/locations`)).json()) as {
    id: string;
    code: string;
  }[];
  cafe.locationId = locations.find((l) => l.code === 'RMH')?.id ?? '';
  // The coffee shop takes pickup orders, with its hub online (one call with a hub credential
  // stands for its heartbeat).
  expect(
    (
      await call('PUT', `/locations/${cafe.locationId}/online-ordering`, {
        state: 'OPEN',
        pickupEnabled: true,
      })
    ).ok(),
  ).toBe(true);
  const hub = (await (
    await call('POST', `/locations/${cafe.locationId}/devices`, {
      name: 'E2E cafe hub (payments)',
      type: 'GATEWAY',
    })
  ).json()) as { credential: string };
  await api.get(`${CLOUD}/api/v1/sync/orders/00000000-0000-7000-8000-000000000000`, {
    headers: { authorization: `Device ${hub.credential}` },
  });
});

test.afterAll(async () => {
  await api.dispose();
});

/** A visitor of the coffee shop's site in English, with an espresso in the cart, at checkout. */
async function checkout(page: Page): Promise<void> {
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
  await page.goto(CAFE_SITE);
  await page.getByRole('link', { name: /View menu · Al-Tireh/ }).click();
  await page.getByRole('button', { name: 'Add Espresso' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Add to cart/ })
    .click();
  await page.getByRole('link', { name: /View cart/ }).click();
  await page.getByRole('link', { name: 'Checkout' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Nadia E2E');
  await page.getByLabel('Mobile number').fill('+970599000123');
}

test('a business without an online provider offers no card, and a card checkout is refused', async ({
  page,
}) => {
  await checkout(page);
  await expect(page.getByText('Pay at pickup')).toBeVisible();
  await expect(page.getByText('Pay online by card')).toHaveCount(0);

  // A card checkout sent anyway is refused before anything is charged.
  const menu = (await (
    await api.get(`${CLOUD}/api/v1/public/site/locations/${cafe.locationId}/menu`, {
      headers: { host: `ramallah-roasters.madar.localhost:${PORT}` },
    })
  ).json()) as { categories: { products: { id: string }[] }[] };
  const productId = menu.categories[0]?.products[0]?.id ?? '';
  const refused = await api.post(`${CLOUD}/api/v1/orders`, {
    headers: { host: `ramallah-roasters.madar.localhost:${PORT}` },
    data: {
      id: crypto.randomUUID(),
      locationId: cafe.locationId,
      fulfillment: 'PICKUP',
      customer: { name: 'Direct', phone: '+970599000124' },
      items: [{ id: crypto.randomUUID(), productId, quantity: 1 }],
      payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' },
    },
  });
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe('ONLINE_PAYMENT_UNAVAILABLE');
});

test('the owner adds a test card gateway, its secret is never shown again, and a card order goes through', async ({
  browser,
}) => {
  // The coffee shop's owner, in the admin, in English.
  const admin = await (await browser.newContext({ baseURL: ADMIN })).newPage();
  await admin.addInitScript(() => {
    localStorage.setItem(
      'pos-admin-preferences',
      JSON.stringify({ state: { locale: 'en', locationId: null }, version: 0 }),
    );
  });
  await admin.goto('/login');
  await admin.getByLabel('Email').fill(owner.email);
  await admin.getByLabel('Password').fill(owner.password);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await admin.getByRole('link', { name: 'Payment providers' }).click();
  await expect(admin.getByRole('heading', { name: 'Payment providers' })).toBeVisible();
  await expect(admin.getByText('None: pay at pickup or on delivery').first()).toBeVisible();

  await admin.getByRole('button', { name: 'Add provider' }).click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog.getByLabel('Takes')).toHaveValue('ONLINE');
  await expect(dialog.getByLabel('Provider')).toHaveValue('mock-online');
  await expect(dialog.getByLabel('Mode')).toHaveValue('TEST');
  await dialog.getByLabel('Statement descriptor').fill('ROASTERS');
  const secret = dialog.getByLabel('Secret key');
  await expect(secret).toHaveAttribute('type', 'password');
  await secret.fill(SECRET);
  const saved = admin.waitForResponse(
    (r) => r.url().endsWith('/payment-providers') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save' }).click();
  const answer = await saved;
  expect(answer.status()).toBe(201);
  expect(await answer.text()).not.toContain(SECRET);
  await expect(dialog).toBeHidden();

  // The account: test mode, a stored secret shown by its fingerprint only.
  // The account's row (the table below also names the gateway, for what is in effect where).
  const row = admin.getByRole('row', { name: /Test card gateway/ }).filter({ hasText: 'Stored' });
  await expect(row.getByText('Test mode')).toBeVisible();
  await expect(row.getByText('Stored')).toBeVisible();
  await expect(admin.getByText('Business-wide').first()).toBeVisible();
  await expect(admin.locator('body')).not.toContainText(SECRET);
  // Editing it shows an empty secret field: what was typed is never sent back.
  await row.getByRole('button', { name: 'Edit Test card gateway' }).click();
  await expect(dialog.getByLabel('Secret key')).toHaveValue('');
  await expect(dialog.getByLabel('Secret key')).toHaveAttribute(
    'placeholder',
    'Stored — leave empty to keep',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const overview = await call('GET', `/tenants/${cafe.tenantId}/payment-providers`);
  expect(await overview.text()).not.toContain(SECRET);

  // The website now offers the card, and a card order goes through.
  const page = await (await browser.newContext()).newPage();
  await checkout(page);
  await page.getByText('Pay online by card').click();
  await expect(page.getByLabel('Test card')).toHaveValue('tok_mock_visa');
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.getByRole('heading', { name: 'Thank you, Nadia E2E!' })).toBeVisible();
  await page.getByRole('link', { name: 'Follow your order' }).click();
  await expect(page.getByText('Paid online')).toBeVisible();
});
